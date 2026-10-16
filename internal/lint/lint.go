// Package lint checks the crux graph. Graph checks need only the markdown: references resolve,
// flow hops are real connections, contracts have both sides, code paths exist. Code checks
// compare what the crux files declare with facts from the code (internal/scan): imports between
// elements, routes, gRPC services, topics, technologies, and code no element describes.
package lint

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/abtinokhovat/crux/internal/adr"
	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/scan"
)

type Finding struct {
	Rule    string `json:"rule"`
	Level   string `json:"level"` // error | warn | info
	File    string `json:"file,omitempty"`
	Line    int    `json:"line,omitempty"`
	Element string `json:"element,omitempty"`
	Message string `json:"message"`
	Fix     string `json:"fix,omitempty"`
}

// connectivity: which element reaches which, counted through containers (a call to a service
// reaches its modules, and a call from a module counts for its service). sync holds calls and
// data access; async holds publisher → consumer; code holds dependencies that justify imports.
type graph struct {
	s     *adr.Store
	sync  map[string]bool
	async map[string]bool
	code  map[string]bool
}

func newGraph(s *adr.Store) *graph {
	g := &graph{s: s, sync: map[string]bool{}, async: map[string]bool{}, code: map[string]bool{}}
	up := func(id string) []string {
		out := []string{id}
		seen := map[string]bool{id: true}
		for d := s.ByID[id]; d != nil && d.Parent != "" && !seen[d.Parent]; d = s.ByID[d.Parent] {
			seen[d.Parent] = true
			out = append(out, d.Parent)
		}
		return out
	}
	add := func(m map[string]bool, from, to string) {
		for _, a := range up(from) {
			for _, b := range up(to) {
				m[a+">"+b] = true
			}
		}
	}
	providers := map[string][]string{}
	for _, l := range s.Links {
		if l.Type == "exposes" || l.Type == "publishes" {
			if c := s.ByID[l.To]; c != nil && c.Kind == "contract" {
				providers[l.To] = append(providers[l.To], l.From)
			}
		}
	}
	for _, l := range s.Links {
		to := s.ByID[l.To]
		isContract := to != nil && to.Kind == "contract"
		switch l.Type {
		case "calls", "reads", "writes":
			add(g.sync, l.From, l.To)
			if l.Type == "calls" {
				add(g.code, l.From, l.To)
			}
		case "uses":
			if isContract {
				for _, p := range providers[l.To] {
					add(g.sync, l.From, p)
					add(g.code, l.From, p)
				}
			} else {
				add(g.sync, l.From, l.To)
				add(g.code, l.From, l.To)
			}
		case "depends_on", "implements":
			add(g.sync, l.From, l.To)
			add(g.code, l.From, l.To)
		case "publishes":
			if !isContract {
				add(g.async, l.From, l.To) // derived publisher → consumer
			}
		}
	}
	return g
}

// hop: is a step from a to b a declared connection? async hops need a publisher → consumer
// pair; sync hops a call, client → provider through a contract, or data access.
func (g *graph) hop(a, b string, async bool) bool {
	if a == b {
		return true
	}
	if async {
		return g.async[a+">"+b] || g.sync[a+">"+b]
	}
	// a sync hop back is the reply to a call the other way
	return g.sync[a+">"+b] || g.sync[b+">"+a] || g.async[a+">"+b]
}

// connected in any direction or way (used where direction does not matter).
func (g *graph) connected(a, b string) bool {
	return a == b || g.sync[a+">"+b] || g.sync[b+">"+a] || g.async[a+">"+b] || g.async[b+">"+a]
}

func (g *graph) declares(from, typ, to string) bool {
	for _, l := range g.s.Links {
		if l.From == from && l.Type == typ && l.To == to {
			return true
		}
	}
	return false
}

// Graph runs the checks that need only the crux files.
func Graph(cfg *config.Config, s *adr.Store) []Finding {
	var out []Finding
	for _, p := range s.Problems {
		lvl := p.Level
		if lvl == "" {
			lvl = "error"
		}
		out = append(out, Finding{Rule: "graph", Level: lvl, File: p.File, Line: p.Line, Message: p.Message})
	}
	for _, d := range s.Adrs {
		if d.Date == "" {
			out = append(out, Finding{Rule: "adr-date", Level: "warn", File: d.File, Message: "missing date"})
		}
		if (d.StatusKey == "accepted" || d.StatusKey == "proposed") && (d.Facts.Decision == nil || *d.Facts.Decision == "") {
			out = append(out, Finding{Rule: "adr-decision", Level: "warn", File: d.File, Message: `no "## Decision" panel with a callout — the UI cannot show the decision`})
		}
		if d.StatusKey == "open" && (d.Facts.Question == nil || *d.Facts.Question == "") {
			out = append(out, Finding{Rule: "adr-question", Level: "warn", File: d.File, Message: `open ADR without a "## Question" callout`})
		}
		if len(d.Tags) == 0 {
			out = append(out, Finding{Rule: "adr-tags", Level: "warn", File: d.File, Message: "no tags"})
		}
	}
	for _, a := range s.Anchors {
		if a.Err != "" {
			where := a.Element
			if a.Where != "" {
				where += " " + a.Where
			}
			out = append(out, Finding{Rule: "anchor", Level: "warn", File: a.Doc, Line: a.DocLine, Element: a.Element, Message: fmt.Sprintf("%s: anchor %s does not resolve — %s", where, a.Ref, a.Err), Fix: "point it at the symbol that does this now (path#Symbol), or remove it"})
		}
	}
	g := newGraph(s)
	cat := s.Catalog
	for _, e := range s.Elements {
		switch e.Kind {
		case "flow":
			if len(e.Steps) == 0 {
				out = append(out, Finding{Rule: "flow-steps", Level: "warn", File: e.File, Element: e.ID, Message: fmt.Sprintf("flow %s has no ```steps block", e.ID)})
			}
			for _, st := range e.Steps {
				if st.FromID == "" || st.ToID == "" {
					continue // reported by the graph already
				}
				if !g.hop(st.FromID, st.ToID, st.Async) {
					fix := fmt.Sprintf("add to %s: calls: [%s]", st.FromID, st.ToID)
					if st.Contract != "" {
						c := s.ByID[st.Contract]
						if c != nil && (c.Transport == "topic" || c.Transport == "queue") {
							fix = fmt.Sprintf("add publishes: [\"%s\"] to %s and consumes: [\"%s\"] to %s", st.Contract, st.FromID, st.Contract, st.ToID)
						} else {
							fix = fmt.Sprintf("add to %s: calls: [\"%s via %s\"]", st.FromID, st.ToID, st.Contract)
						}
					}
					out = append(out, Finding{Rule: "flow-hop", Level: "warn", File: e.File, Line: st.Line, Element: e.ID, Message: fmt.Sprintf("flow %s step %s: %s → %s is not a declared connection", e.ID, st.ID, st.FromID, st.ToID), Fix: fix})
					continue
				}
				if c := s.ByID[st.Contract]; c != nil && (c.Transport == "topic" || c.Transport == "queue") {
					if !g.declares(st.FromID, "publishes", c.ID) && !childDeclares(s, g, st.FromID, "publishes", c.ID) {
						out = append(out, Finding{Rule: "flow-contract", Level: "warn", File: e.File, Line: st.Line, Element: e.ID, Message: fmt.Sprintf("flow %s step %s: %s does not publish %s", e.ID, st.ID, st.FromID, c.Name), Fix: fmt.Sprintf("add to %s: publishes: [\"%s\"]", st.FromID, c.ID)})
					}
					if !g.declares(st.ToID, "consumes", c.ID) && !childDeclares(s, g, st.ToID, "consumes", c.ID) {
						out = append(out, Finding{Rule: "flow-contract", Level: "warn", File: e.File, Line: st.Line, Element: e.ID, Message: fmt.Sprintf("flow %s step %s: %s does not consume %s", e.ID, st.ID, st.ToID, c.Name), Fix: fmt.Sprintf("add to %s: consumes: [\"%s\"]", st.ToID, c.ID)})
					}
				}
			}
			if e.Trigger == "" || e.Outcome == "" {
				out = append(out, Finding{Rule: "flow-ends", Level: "info", File: e.File, Element: e.ID, Message: fmt.Sprintf("flow %s has no trigger: or outcome:", e.ID)})
			}
		case "contract":
			prod, cons := 0, 0
			for _, l := range s.Links {
				if l.To == e.ID && (l.Type == "exposes" || l.Type == "publishes") {
					prod++
				}
				if l.To == e.ID && (l.Type == "uses" || l.Type == "consumes") {
					cons++
				}
			}
			if prod == 0 {
				out = append(out, Finding{Rule: "contract-provider", Level: "warn", File: e.File, Element: e.ID, Message: fmt.Sprintf("contract %s: nobody exposes or publishes it", e.ID), Fix: "add it to a service's exposes: or publishes:"})
			}
			if cons == 0 && !e.Implied {
				out = append(out, Finding{Rule: "contract-consumer", Level: "info", File: e.File, Element: e.ID, Message: fmt.Sprintf("contract %s: nobody uses or consumes it", e.ID)})
			}
		case "question":
			if e.RaisedFrom != "" {
				ref := strings.TrimPrefix(e.RaisedFrom, "flow:")
				if fid, step, ok := strings.Cut(ref, "#"); ok {
					f := s.ByID[fid]
					found := false
					for _, st := range stepsOf(f) {
						found = found || st.ID == step
					}
					if f != nil && !found {
						out = append(out, Finding{Rule: "question-step", Level: "warn", File: e.File, Element: e.ID, Message: fmt.Sprintf("raised_from: flow %s has no step %q", fid, step)})
					}
				}
			}
		case "entity":
			if e.Parent == "" {
				out = append(out, Finding{Rule: "entity-owner", Level: "info", File: e.File, Element: e.ID, Message: fmt.Sprintf("entity %s has no owner (owns: on a service, or in:)", e.ID)})
			}
			// a relation into another service's entity means two services share that data
			for _, l := range s.Links {
				if l.From != e.ID || (l.Type != "references" && l.Type != "has") {
					continue
				}
				if a, b := serviceOf(s, e.ID), serviceOf(s, l.To); a != "" && b != "" && a != b {
					out = append(out, Finding{Rule: "entity-boundary", Level: "info", File: e.File, Element: e.ID, Message: fmt.Sprintf("entity %s (%s) %s %s (%s) across a service boundary — keep only the id, or move one of them", e.ID, a, l.Type, l.To, b)})
				}
			}
			if e.Store == "" && e.Parent != "" {
				out = append(out, Finding{Rule: "entity-store", Level: "info", File: e.File, Element: e.ID, Message: fmt.Sprintf("entity %s: no store found — its owner writes no store (or several); add stored_in:", e.ID)})
			}
		}
		if e.Origin == "inferred" {
			out = append(out, Finding{Rule: "inferred", Level: "info", File: e.File, Element: e.ID, Message: fmt.Sprintf("%s %s was inferred from code — confirm it (remove origin: inferred) or correct it", e.Kind, e.ID)})
		}
		if !e.CodeImplied {
			for _, c := range e.Code {
				if !pathExists(cfg, c) {
					out = append(out, Finding{Rule: "code-path", Level: "warn", File: e.File, Element: e.ID, Message: fmt.Sprintf("code: %q matches no file", c)})
				}
			}
		}
		for _, t := range e.Tech {
			if cat != nil && cat.Tech[t] == nil {
				out = append(out, Finding{Rule: "tech-unknown", Level: "info", File: e.File, Element: e.ID, Message: fmt.Sprintf("tech %q is not in the catalog — add it to .crux/catalog.yaml for an icon and color", t)})
			}
		}
	}
	return filter(cfg, out)
}

// serviceOf is the deployable an element belongs to: itself or its nearest service, app or job.
func serviceOf(s *adr.Store, id string) string {
	for d := s.ByID[id]; d != nil; d = s.ByID[d.Parent] {
		if d.Kind == "service" || d.Kind == "app" || d.Kind == "job" {
			return d.ID
		}
	}
	return ""
}

func stepsOf(d *adr.Doc) []adr.Step {
	if d == nil {
		return nil
	}
	return d.Steps
}

// childDeclares: a module inside a service may declare the publish for it.
func childDeclares(s *adr.Store, g *graph, parent, typ, to string) bool {
	for _, e := range s.Elements {
		for p := e; p != nil && p.Parent != ""; p = s.ByID[p.Parent] {
			if p.Parent == parent && g.declares(e.ID, typ, to) {
				return true
			}
			if p.Parent == p.ID {
				break
			}
		}
	}
	return false
}

func pathExists(cfg *config.Config, glob string) bool {
	g := strings.TrimSuffix(strings.TrimSuffix(glob, "/**"), "/*")
	if !strings.ContainsAny(g, "*?[") {
		_, err := os.Stat(cfg.Abs(g))
		return err == nil
	}
	m, _ := filepath.Glob(cfg.Abs(g))
	return len(m) > 0
}

// ── code checks ───────────────────────────────────────────────────

// owners maps code folders to the element that covers them (the most specific code: glob).
type owners struct {
	s     *adr.Store
	roots []struct {
		prefix string
		id     string
	}
}

func newOwners(s *adr.Store) *owners {
	o := &owners{s: s}
	for _, e := range s.Elements {
		if !adr.IsStructural(e.Kind) {
			continue
		}
		for _, c := range e.Code {
			p := strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(c, "/**"), "/*"), "/")
			if i := strings.IndexAny(p, "*?["); i >= 0 {
				p = strings.TrimSuffix(p[:i], "/")
			}
			o.roots = append(o.roots, struct {
				prefix string
				id     string
			}{p, e.ID})
		}
	}
	sort.Slice(o.roots, func(i, j int) bool { return len(o.roots[i].prefix) > len(o.roots[j].prefix) })
	return o
}

func (o *owners) of(dir string) string {
	for _, r := range o.roots {
		if r.prefix == "" || r.prefix == "." || dir == r.prefix || strings.HasPrefix(dir, r.prefix+"/") {
			return r.id
		}
	}
	return ""
}

// related: same element, or one contains the other.
func (o *owners) related(a, b string) bool {
	if a == b {
		return true
	}
	for _, pair := range [][2]string{{a, b}, {b, a}} {
		seen := map[string]bool{}
		for d := o.s.ByID[pair[0]]; d != nil && d.Parent != "" && !seen[d.ID]; d = o.s.ByID[d.Parent] {
			seen[d.ID] = true
			if d.Parent == pair[1] {
				return true
			}
		}
	}
	return false
}

var paramRe = regexp.MustCompile(`\{[^}]*\}|:[A-Za-z_]\w*|<[^>]*>|\*\w*`)

func normPath(p string) string {
	p = paramRe.ReplaceAllString(strings.TrimRight(p, "/"), "{}")
	if p == "" {
		return "/"
	}
	return p
}

// Code compares the crux files with facts from the code.
func Code(cfg *config.Config, s *adr.Store, f *scan.Facts) []Finding {
	var out []Finding
	o := newOwners(s)
	g := newGraph(s)
	// L2: imports between elements must be declared
	type pair struct{ a, b string }
	seen := map[pair][]string{}
	var order []pair
	for _, m := range f.Modules {
		a := o.of(m.Dir)
		if a == "" {
			continue
		}
		for _, imp := range m.Imports {
			b := o.of(imp)
			if b == "" || o.related(a, b) || g.code[a+">"+b] {
				continue
			}
			k := pair{a, b}
			if _, ok := seen[k]; !ok {
				order = append(order, k)
			}
			seen[k] = append(seen[k], m.Dir+" → "+imp)
		}
	}
	for _, k := range order {
		ea, eb := s.ByID[k.a], s.ByID[k.b]
		lvl := "warn"
		if eb != nil && (eb.Kind == "library" || eb.Kind == "module") {
			lvl = "info"
		}
		ex := seen[k]
		msg := fmt.Sprintf("%s imports code of %s (%s%s) but declares no connection", k.a, k.b, ex[0], more(len(ex)-1))
		out = append(out, Finding{Rule: "code-import", Level: lvl, File: fileOf(ea), Element: k.a, Message: msg, Fix: fmt.Sprintf("add to %s: depends_on: [%s] — or remove the import if the boundary should hold", k.a, k.b)})
	}
	// L3: routes and gRPC services
	byEl := map[string][]scan.Route{}
	for _, r := range f.Routes {
		if id := o.of(r.Dir); id != "" {
			byEl[id] = append(byEl[id], r)
		}
	}
	for _, e := range s.Elements {
		if !adr.IsStructural(e.Kind) || len(e.Code) == 0 {
			continue
		}
		routes := routesUnder(s, o, e.ID, byEl)
		var declared []*adr.Doc
		for _, l := range s.Links {
			if l.From == e.ID && l.Type == "exposes" {
				if c := s.ByID[l.To]; c != nil && (c.Transport == "http" || c.Transport == "grpc") {
					declared = append(declared, c)
				}
			}
		}
		matched := map[int]bool{}
		for _, c := range declared {
			found := false
			for i, r := range routes {
				if routeMatches(c, r) {
					found, matched[i] = true, true
				}
			}
			if !found && len(routes) > 0 && !onlyImplied(s, e.ID, c.ID) {
				out = append(out, Finding{Rule: "code-route", Level: "warn", File: e.File, Element: e.ID, Message: fmt.Sprintf("%s exposes %s, but no such %s route is in its code", e.ID, c.ID, c.Transport)})
			}
		}
		var undeclared []string
		for i, r := range routes {
			if !matched[i] && !boringRoute(r) {
				undeclared = append(undeclared, strings.TrimSpace(r.Method+" "+r.Path))
			}
		}
		if n := len(undeclared); n > 0 {
			out = append(out, Finding{Rule: "code-route-undeclared", Level: "info", File: e.File, Element: e.ID, Message: fmt.Sprintf("%s serves %d route%s it does not declare: %s%s", e.ID, n, plural(n), strings.Join(first(uniq(undeclared), 4), ", "), more(n-4)), Fix: "add the public ones to exposes:"})
		}
	}
	// L4: topics and queues
	pubs, subs := map[string]map[string]scan.Topic{}, map[string]map[string]scan.Topic{}
	any := map[string]map[string]scan.Topic{}
	for _, t := range f.Topics {
		id := o.of(t.Mod)
		if id == "" {
			continue
		}
		add := func(m map[string]map[string]scan.Topic) {
			if m[id] == nil {
				m[id] = map[string]scan.Topic{}
			}
			m[id][t.Name] = t
		}
		add(any)
		switch t.Dir {
		case "pub":
			add(pubs)
		case "sub":
			add(subs)
		}
	}
	for _, e := range s.Elements {
		if !adr.IsStructural(e.Kind) || len(e.Code) == 0 {
			continue
		}
		seenAny := topicsUnder(s, o, e.ID, any)
		if len(seenAny) == 0 {
			continue
		}
		for _, l := range s.Links {
			if l.From != e.ID || (l.Type != "publishes" && l.Type != "consumes") || l.Implied {
				continue
			}
			c := s.ByID[l.To]
			if c == nil || c.Kind != "contract" {
				continue
			}
			if _, ok := seenAny[c.Name]; !ok {
				out = append(out, Finding{Rule: "code-topic", Level: "warn", File: e.File, Element: e.ID, Message: fmt.Sprintf("%s %s %s, but its code never names %q", e.ID, l.Type, c.ID, c.Name)})
			}
		}
		for typ, m := range map[string]map[string]map[string]scan.Topic{"publishes": pubs, "consumes": subs} {
			var missing []string
			for name, t := range topicsUnder(s, o, e.ID, m) {
				if !declaresTopic(s, e.ID, typ, name) {
					missing = append(missing, fmt.Sprintf("%s (%s:%d)", name, t.File, t.Line))
				}
			}
			sort.Strings(missing)
			if len(missing) > 0 {
				out = append(out, Finding{Rule: "code-topic-undeclared", Level: "info", File: e.File, Element: e.ID, Message: fmt.Sprintf("%s code %s %s but the crux file does not declare it", e.ID, map[string]string{"publishes": "publishes to", "consumes": "consumes"}[typ], strings.Join(first(missing, 4), ", ")+more(len(missing)-4)), Fix: fmt.Sprintf("add to %s: %s: [\"topic:…\"]", e.ID, typ)})
			}
		}
	}
	// tech found in an element's code that its tech: list misses
	techBy := map[string]map[string]string{}
	for _, t := range f.Tech {
		if id := o.of(t.Dir); id != "" {
			if techBy[id] == nil {
				techBy[id] = map[string]string{}
			}
			techBy[id][t.ID] = t.Via
		}
	}
	for id, ts := range techBy {
		e := s.ByID[id]
		if e == nil {
			continue
		}
		var miss []string
		for t, via := range ts {
			if !contains(e.Tech, t) && !reachesTech(s, e.ID, t) {
				miss = append(miss, fmt.Sprintf("%s (%s)", t, via))
			}
		}
		sort.Strings(miss)
		if len(miss) > 0 {
			out = append(out, Finding{Rule: "code-tech", Level: "info", File: e.File, Element: id, Message: fmt.Sprintf("%s code uses %s — not in its tech: list", id, strings.Join(first(miss, 5), ", ")+more(len(miss)-5))})
		}
	}
	// connections the code makes that no crux file declares (lint.Merge added them)
	for _, l := range s.Links {
		if l.Source != "scan" || l.Implied {
			continue
		}
		e := s.ByID[l.From]
		if e == nil {
			continue
		}
		label := ""
		if l.Label != "" {
			label = " (" + l.Label + ")"
		}
		out = append(out, Finding{Rule: "code-link-undeclared", Level: "info", File: e.File, Element: e.ID, Message: fmt.Sprintf("code: %s %s %s%s at %s — not in its crux file", l.From, l.Type, l.To, label, l.At), Fix: fmt.Sprintf("add to %s: %s: [{to: %q, at: %s}]", l.From, l.Type, l.To, l.At)})
	}
	// coverage: deployables no element describes
	for _, c := range f.Services {
		if c.Kind == "app" && c.Lang == "go" {
			continue // tools, tests, playgrounds
		}
		if o.of(c.Dir) == "" {
			out = append(out, Finding{Rule: "coverage", Level: "info", Message: fmt.Sprintf("%s %q at %s is not described by any crux file (%s)", c.Kind, c.Name, c.Dir, strings.Join(first(c.Evidence, 2), ", ")), Fix: fmt.Sprintf("crux new %s %q --dir %s", c.Kind, c.Name, c.Dir)})
		}
	}
	return filter(cfg, out)
}

func routesUnder(s *adr.Store, o *owners, id string, by map[string][]scan.Route) []scan.Route {
	var out []scan.Route
	for el, rs := range by {
		if el == id || o.related(el, id) && isDescendant(s, el, id) {
			out = append(out, rs...)
		}
	}
	return out
}

func topicsUnder(s *adr.Store, o *owners, id string, by map[string]map[string]scan.Topic) map[string]scan.Topic {
	out := map[string]scan.Topic{}
	for el, ts := range by {
		if el == id || isDescendant(s, el, id) {
			for k, v := range ts {
				out[k] = v
			}
		}
	}
	return out
}

func isDescendant(s *adr.Store, child, parent string) bool {
	seen := map[string]bool{}
	for d := s.ByID[child]; d != nil && d.Parent != "" && !seen[d.ID]; d = s.ByID[d.Parent] {
		seen[d.ID] = true
		if d.Parent == parent {
			return true
		}
	}
	return false
}

func declaresTopic(s *adr.Store, id, typ, name string) bool {
	for _, l := range s.Links {
		if l.Type != typ || (l.From != id && !isDescendant(s, l.From, id)) {
			continue
		}
		if c := s.ByID[l.To]; c != nil && c.Name == name {
			return true
		}
	}
	return false
}

// reachesTech: the element connects to something with that tech (a service "uses" redis by
// reading the sessions cache) — then not listing it is fine.
func reachesTech(s *adr.Store, id, tech string) bool {
	for _, l := range s.Links {
		if l.From != id {
			continue
		}
		if t := s.ByID[l.To]; t != nil && contains(t.Tech, tech) {
			return true
		}
	}
	return false
}

func onlyImplied(s *adr.Store, from, to string) bool {
	for _, l := range s.Links {
		if l.From == from && l.To == to && l.Type == "exposes" && !l.Implied {
			return false
		}
	}
	return true
}

func routeMatches(c *adr.Doc, r scan.Route) bool {
	switch c.Transport {
	case "grpc":
		if r.Kind != "grpc" {
			return false
		}
		svc := c.Name
		if i := strings.Index(svc, "/"); i >= 0 {
			svc = svc[:i]
		}
		if i := strings.LastIndex(svc, "."); i >= 0 {
			svc = svc[i+1:]
		}
		return strings.EqualFold(svc, r.Path)
	case "http":
		if r.Kind != "http" {
			return false
		}
		method, p := "", c.Name
		if i := strings.Index(c.Name, " "); i > 0 {
			method, p = c.Name[:i], strings.TrimSpace(c.Name[i+1:])
		}
		if method != "" && r.Method != "" && !strings.EqualFold(method, r.Method) {
			return false
		}
		a, b := normPath(p), normPath(r.Path)
		return a == b || strings.HasSuffix(a, b) || strings.HasSuffix(b, a)
	}
	return false
}

func boringRoute(r scan.Route) bool {
	p := strings.ToLower(r.Path)
	return r.Kind == "grpc" && r.Path == "Health" || regexp.MustCompile(`^/(health|healthz|health-check|ready|readyz|live|livez|metrics|ping|debug|swagger|docs)\b`).MatchString(p)
}

func fileOf(d *adr.Doc) string {
	if d == nil {
		return ""
	}
	return d.File
}

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

func uniq(xs []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, x := range xs {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}

func first(xs []string, n int) []string {
	if len(xs) > n {
		return xs[:n]
	}
	return xs
}

func more(n int) string {
	if n > 0 {
		return fmt.Sprintf(" +%d more", n)
	}
	return ""
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// filter drops findings silenced in crux.config.yaml lint.ignore (rule names, element ids, or
// path globs).
func filter(cfg *config.Config, in []Finding) []Finding {
	if len(cfg.Lint.Ignore) == 0 {
		return in
	}
	out := in[:0]
	for _, f := range in {
		skip := false
		for _, ig := range cfg.Lint.Ignore {
			if ig == f.Rule || ig == f.Element || ig == f.Rule+":"+f.Element {
				skip = true
			}
			if ok, _ := path.Match(ig, f.File); ok && f.File != "" {
				skip = true
			}
		}
		if !skip {
			out = append(out, f)
		}
	}
	return out
}
