package flow

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
)

// NewElement writes a crux file for an element from the kind's template and returns its path.
// dir is where it goes: a code folder (written as crux.md) or any docs folder.
type NewOpts struct {
	Kind, Title, ID, In, Dir, Tech, Owner, Phase string
}

func NewElement(cfg *config.Config, s *adr.Store, o NewOpts) (string, error) {
	kind, ok := adr.NormKind(o.Kind)
	if !ok || kind == "adr" || kind == "doc" {
		return "", fmt.Errorf("unknown kind %q (one of: %s)", o.Kind, strings.Join(adr.Kinds, ", "))
	}
	id := o.ID
	if id == "" {
		id = adr.Slug(o.Title)
		if kind == "contract" {
			id = o.Title // "topic:order.created"
		}
	}
	if s.ByID[id] != nil && !s.ByID[id].Implied {
		return "", fmt.Errorf("%s already exists (%s)", id, s.ByID[id].File)
	}
	if o.In != "" && s.ByID[o.In] == nil {
		return "", fmt.Errorf("in: %q is not a known element", o.In)
	}
	dir := o.Dir
	file := ""
	switch {
	case dir != "" && (kind == "service" || kind == "app" || kind == "job" || kind == "library" || kind == "module" || kind == "context" || kind == "system"):
		file = path.Join(dir, "crux.md")
		if _, err := os.Stat(cfg.Abs(file)); err == nil {
			file = path.Join(dir, adr.Slug(o.Title)+".md")
		}
	case dir != "":
		file = path.Join(dir, safeName(id, o.Title)+".md")
	default:
		base := map[string]string{"flow": "docs/flows", "question": "docs/questions", "session": "docs/sessions", "convention": "docs/conventions", "contract": "docs/contracts", "entity": "docs/entities"}[kind]
		if base == "" {
			base = "docs/system"
		}
		name := safeName(id, o.Title)
		if kind == "session" {
			name = today() + "-" + name
		}
		file = path.Join(base, name+".md")
	}
	if _, err := os.Stat(cfg.Abs(file)); err == nil {
		return "", fmt.Errorf("%s exists", file)
	}
	tpl := map[string]string{
		"service": "el-service.md", "app": "el-service.md", "job": "el-service.md", "library": "el-service.md", "module": "el-service.md",
		"store": "el-infra.md", "cache": "el-infra.md", "broker": "el-infra.md", "gateway": "el-infra.md", "infra": "el-infra.md", "external": "el-infra.md",
		"contract": "el-contract.md", "entity": "el-entity.md", "flow": "el-flow.md", "question": "el-question.md", "session": "el-session.md", "convention": "el-convention.md",
	}[kind]
	if tpl == "" {
		tpl = "el-generic.md"
	}
	// a project can override any template in .crux/templates/<name>
	text := Template(tpl)
	if b, err := os.ReadFile(cfg.Abs(filepath.Join(".crux", "templates", tpl))); err == nil {
		text = string(b)
	}
	in := ""
	if o.In != "" {
		in = "in: " + o.In + "\n"
	}
	phase := o.Phase
	if phase == "" {
		phase = map[string]string{"question": "build", "session": "design"}[kind]
	}
	vars := map[string]string{"kind": kind, "id": id, "title": o.Title, "in": in, "tech": strings.Join(splitList(o.Tech), ", "), "owner": firstNonEmptyStr(o.Owner, cfg.Me), "phase": phase, "date": today(), "dir": firstNonEmptyStr(path.Clean(o.Dir), "src")}
	text = regexp.MustCompile(`\{\{(\w+)\}\}`).ReplaceAllStringFunc(text, func(m string) string { return vars[m[2:len(m)-2]] })
	text = strings.Replace(text, "owner: \"\"\n", "", 1)
	if err := os.MkdirAll(filepath.Dir(cfg.Abs(file)), 0o755); err != nil {
		return "", err
	}
	return file, os.WriteFile(cfg.Abs(file), []byte(text), 0o644)
}

func safeName(id, title string) string {
	if n := adr.Slug(title); n != "" {
		return n
	}
	return adr.Slug(id)
}

func splitList(s string) []string {
	var out []string
	for _, x := range strings.Split(s, ",") {
		if x = strings.TrimSpace(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

func firstNonEmptyStr(v ...string) string {
	for _, s := range v {
		if s != "" && s != "." {
			return s
		}
	}
	return ""
}

// ── trace ─────────────────────────────────────────────────────────

type Hop struct {
	Type      string `json:"type"`
	Dir       string `json:"dir"` // out | in
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	Via       string `json:"via,omitempty"`
	Transport string `json:"transport,omitempty"`
	Mode      string `json:"mode,omitempty"`
	Implied   bool   `json:"implied,omitempty"`
}

type FlowRef struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Steps []string `json:"steps"`
}

type Trace struct {
	ID        string     `json:"id"`
	Kind      string     `json:"kind"`
	Title     string     `json:"title"`
	Summary   string     `json:"summary,omitempty"`
	File      string     `json:"file,omitempty"`
	Parent    []string   `json:"in"`
	Tech      []string   `json:"tech"`
	Code      []string   `json:"code"`
	Origin    string     `json:"origin,omitempty"`
	Hops      []Hop      `json:"connections"`
	Flows     []FlowRef  `json:"flows"`
	Steps     []adr.Step `json:"steps,omitempty"`
	Decisions []Decision `json:"decisions"`
	Questions []string   `json:"questions"`
	Inside    []string   `json:"inside"`
	Rules     []string   `json:"conventions"`
}

// TraceOf collects everything around an element: its connections both ways, the flows it is in
// (with the steps), the decisions that govern it, open questions, children and conventions.
func TraceOf(cfg *config.Config, s *adr.Store, id string) (*Trace, error) {
	e := s.ByID[id]
	if e == nil {
		for _, x := range s.Elements {
			if adr.Slug(x.Title) == adr.Slug(id) || strings.EqualFold(x.Name, id) {
				e = x
				break
			}
		}
	}
	if e == nil || e.Kind == "adr" || e.Kind == "doc" {
		return nil, fmt.Errorf("no element %q. Run \"crux list --kind all\"", id)
	}
	t := &Trace{ID: e.ID, Kind: e.Kind, Title: e.Title, Summary: e.Subtitle, File: e.File, Tech: orEmpty(e.Tech), Code: orEmpty(e.Code), Origin: e.Origin, Steps: e.Steps, Hops: []Hop{}, Flows: []FlowRef{}, Decisions: []Decision{}, Questions: []string{}, Inside: []string{}, Rules: []string{}, Parent: []string{}}
	seen := map[string]bool{}
	for p := s.ByID[e.Parent]; p != nil && !seen[p.ID]; p = s.ByID[p.Parent] {
		seen[p.ID] = true
		t.Parent = append([]string{p.ID}, t.Parent...)
	}
	skip := map[string]bool{"mentions": true, "flows": true, "decided_by": true, "produced": true}
	for _, l := range s.Links {
		if skip[l.Type] {
			continue
		}
		var other string
		dir := ""
		switch {
		case l.From == e.ID:
			other, dir = l.To, "out"
		case l.To == e.ID:
			other, dir = l.From, "in"
		default:
			continue
		}
		o := s.ByID[other]
		if o == nil {
			continue
		}
		t.Hops = append(t.Hops, Hop{Type: l.Type, Dir: dir, ID: o.ID, Kind: o.Kind, Title: firstNonEmptyStr(o.Name, o.Title), Via: l.Via, Transport: l.Transport, Mode: l.Mode, Implied: l.Implied})
		if o.Kind == "question" && o.State != "answered" {
			t.Questions = append(t.Questions, o.ID+" — "+o.Title)
		}
	}
	t.Questions = uniqStr(t.Questions)
	sort.SliceStable(t.Hops, func(i, j int) bool { return t.Hops[i].Dir > t.Hops[j].Dir })
	for _, f := range s.Elements {
		if f.Kind != "flow" {
			continue
		}
		var steps []string
		for i, st := range f.Steps {
			if st.FromID == e.ID || st.ToID == e.ID || st.Contract == e.ID {
				steps = append(steps, fmt.Sprintf("%d. %s: %s → %s %s", i+1, st.ID, st.FromID, st.ToID, strings.TrimSpace(st.Transport+" "+st.Name)))
			}
		}
		if len(steps) > 0 {
			t.Flows = append(t.Flows, FlowRef{ID: f.ID, Title: f.Title, Steps: steps})
		}
	}
	var adrs []string
	for _, l := range s.Links {
		if l.Type == "decided_by" && (l.From == e.ID || contains(t.Parent, l.From)) {
			adrs = append(adrs, l.To)
		}
	}
	if len(adrs) > 0 {
		for _, d := range Context(cfg, s, nil) {
			if contains(adrs, d.ID) {
				t.Decisions = append(t.Decisions, d)
			}
		}
	}
	for _, x := range s.Elements {
		if x.Parent == e.ID {
			t.Inside = append(t.Inside, x.Kind+" "+x.ID)
		}
		if x.Kind == "convention" && codeOverlaps(x.Code, e.Code) {
			t.Rules = append(t.Rules, x.ID+" — "+firstNonEmptyStr(x.Subtitle, x.Title))
		}
	}
	return t, nil
}

func codeOverlaps(globs, code []string) bool {
	for _, g := range globs {
		gp := globPrefix(g)
		for _, c := range code {
			cp := globPrefix(c)
			if strings.HasPrefix(cp, gp) || strings.HasPrefix(gp, cp) {
				return true
			}
		}
	}
	return false
}

// ── system context for agents ─────────────────────────────────────

type ElementHit struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind"`
	Title     string   `json:"title"`
	Summary   string   `json:"summary,omitempty"`
	File      string   `json:"file"`
	Origin    string   `json:"origin,omitempty"`
	Matched   []string `json:"matched"`
	Exposes   []string `json:"exposes"`
	Publishes []string `json:"publishes"`
	Consumes  []string `json:"consumes"`
	Calls     []string `json:"calls"`
	Data      []string `json:"data"`
	Flows     []string `json:"flows"`
	Questions []string `json:"open_questions"`
}

// SystemContext finds elements whose code covers the given paths or whose id, name or tags match
// the terms, plus conventions that apply to the paths.
func SystemContext(s *adr.Store, inputs []string) (els []ElementHit, conventions []ElementHit) {
	var paths, terms []string
	for _, x := range inputs {
		if strings.ContainsAny(x, "/.") && !strings.Contains(x, ":") {
			paths = append(paths, strings.TrimPrefix(x, "./"))
		} else {
			terms = append(terms, strings.ToLower(x))
		}
	}
	els, conventions = []ElementHit{}, []ElementHit{}
	for _, e := range s.Elements {
		if e.Implied || e.Kind == "session" {
			continue
		}
		var why []string
		for _, p := range paths {
			for _, g := range e.Code {
				if globRe(g).MatchString(p) || strings.HasPrefix(p, globPrefix(g)) {
					why = append(why, "path "+p+" ~ "+g)
					break
				}
			}
		}
		for _, t := range terms {
			switch {
			case strings.EqualFold(e.ID, t) || adr.Slug(e.Title) == adr.Slug(t):
				why = append(why, "name "+t)
			case contains(e.Tags, t) || contains(e.Tech, t):
				why = append(why, "tag "+t)
			case strings.Contains(strings.ToLower(e.Title+" "+e.Name), t):
				why = append(why, "title "+t)
			}
		}
		if len(why) == 0 {
			continue
		}
		h := ElementHit{ID: e.ID, Kind: e.Kind, Title: e.Title, Summary: e.Subtitle, File: e.File, Origin: e.Origin, Matched: why, Exposes: []string{}, Publishes: []string{}, Consumes: []string{}, Calls: []string{}, Data: []string{}, Flows: []string{}, Questions: []string{}}
		for _, l := range s.Links {
			if l.From != e.ID {
				if l.To == e.ID && l.Type == "blocks" {
					if q := s.ByID[l.From]; q != nil && q.State != "answered" {
						h.Questions = append(h.Questions, q.ID+" — "+q.Title)
					}
				}
				continue
			}
			switch l.Type {
			case "exposes":
				h.Exposes = append(h.Exposes, l.To)
			case "publishes":
				if !l.Implied {
					h.Publishes = append(h.Publishes, l.To)
				}
			case "consumes":
				h.Consumes = append(h.Consumes, l.To)
			case "calls":
				if !l.Implied {
					h.Calls = append(h.Calls, strings.TrimSpace(l.To+" "+viaText(l.Via)))
				}
			case "reads", "writes":
				h.Data = append(h.Data, l.Type+" "+l.To)
			case "blocked_by":
				if q := s.ByID[l.To]; q != nil && q.State != "answered" {
					h.Questions = append(h.Questions, q.ID+" — "+q.Title)
				}
			}
		}
		for _, f := range s.Elements {
			if f.Kind != "flow" {
				continue
			}
			for _, st := range f.Steps {
				if st.FromID == e.ID || st.ToID == e.ID {
					h.Flows = append(h.Flows, f.ID)
					break
				}
			}
		}
		h.Questions = uniqStr(h.Questions)
		if e.Kind == "convention" {
			conventions = append(conventions, h)
		} else {
			els = append(els, h)
		}
	}
	// conventions apply by path even when nothing else matched
	for _, e := range s.Elements {
		if e.Kind != "convention" {
			continue
		}
		already := false
		for _, c := range conventions {
			already = already || c.ID == e.ID
		}
		if already {
			continue
		}
		for _, p := range paths {
			for _, g := range e.Code {
				if globRe(g).MatchString(p) || strings.HasPrefix(p, globPrefix(g)) {
					conventions = append(conventions, ElementHit{ID: e.ID, Kind: e.Kind, Title: e.Title, Summary: e.Subtitle, File: e.File, Matched: []string{"path " + p + " ~ " + g}})
					already = true
					break
				}
			}
			if already {
				break
			}
		}
	}
	return els, conventions
}

func viaText(v string) string {
	if v == "" {
		return ""
	}
	return "via " + v
}

func uniqStr(xs []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, x := range xs {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}
