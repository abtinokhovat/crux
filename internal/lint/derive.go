package lint

// Derive turns code facts into connections, deterministically: a connection is made only when
// both ends resolve exactly — a manifest or code names a host that is an element (by id, by a
// scan.names hint, by a compose alias or a Kubernetes Service selector), an env var a scan.env
// hint maps, a gRPC client whose service one element serves, a topic read or written through an
// API whose direction is certain. What does not resolve exactly becomes a gap (gaps.go) for an
// agent, never a guess.

import (
	"fmt"
	"sort"
	"strings"

	"github.com/abtinokhovat/crux/internal/adr"
	"github.com/abtinokhovat/crux/internal/code"
	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/scan"
)

// Derived is what the code says, mapped onto the model.
type Derived struct {
	Links    []adr.Link          `json:"links"`  // found in code; Source scan or both
	ElemAt   map[string][]string `json:"at"`     // element → anchors found for it (entity → its table)
	StepAt   map[string]string   `json:"stepAt"` // flow#step → anchor of the code that performs it
	Owners   map[string][]string `json:"owners"` // element → CODEOWNERS owners
	Tables   map[string]string   `json:"tables"` // table → entity
	Contract []*adr.Doc          `json:"-"`      // contracts the code uses that no file declares
	names    *names
}

// names resolves a host or manifest name to an element.
type names struct {
	s      *adr.Store
	cfg    *config.Config
	f      *scan.Facts
	o      *owners
	alias  map[string]string
	byHost map[string]*adr.Doc // external hosts (host: on elements)
}

func newNames(cfg *config.Config, s *adr.Store, f *scan.Facts, o *owners) *names {
	n := &names{s: s, cfg: cfg, f: f, o: o, alias: map[string]string{}, byHost: map[string]*adr.Doc{}}
	for _, a := range f.Aliases {
		n.alias[a[0]] = a[1]
	}
	for _, e := range s.Elements {
		for _, h := range e.Hosts {
			n.byHost[strings.ToLower(h)] = e
		}
	}
	return n
}

// element finds the elements a name points at. A Kubernetes Service resolves to every workload
// its selector matches.
func (n *names) element(name string) []*adr.Doc {
	name = scan.NormHost(name)
	if a, ok := n.alias[name]; ok {
		name = a
	}
	if id, ok := n.cfg.Scan.Names[name]; ok {
		if d := n.s.ByID[id]; d != nil {
			return []*adr.Doc{d}
		}
		return nil
	}
	if d := n.byID(name); d != nil {
		return []*adr.Doc{d}
	}
	// a compose service built from source: the element covering its folder
	for _, c := range n.f.Services {
		if c.Name == name && len(c.Labels) == 0 && c.Dir != "" {
			if id := n.o.of(c.Dir); id != "" {
				return []*adr.Doc{n.s.ByID[id]}
			}
		}
	}
	// a Kubernetes Service: the workloads it selects
	for _, ks := range n.f.K8sServices {
		if ks.Name != name || len(ks.Selector) == 0 {
			continue
		}
		var out []*adr.Doc
		for _, w := range n.workloads(ks.Selector) {
			if w != name {
				out = append(out, n.element(w)...)
			}
		}
		return out
	}
	// an external API by its host (or a parent domain of it)
	for h := name; h != ""; {
		if d := n.byHost[h]; d != nil {
			return []*adr.Doc{d}
		}
		i := strings.Index(h, ".")
		if i < 0 || !strings.Contains(h[i+1:], ".") {
			break
		}
		h = h[i+1:]
	}
	return nil
}

func (n *names) byID(name string) *adr.Doc {
	if d := n.s.ByID[name]; d != nil && d.Kind != "adr" && d.Kind != "contract" {
		return d
	}
	for _, e := range n.s.Elements {
		if adr.IsStructural(e.Kind) && (adr.Slug(e.Title) == name || adr.Slug(e.ID) == name) {
			return e
		}
	}
	return nil
}

func (n *names) workloads(sel map[string]string) []string {
	var out []string
	match := func(name string, labels map[string]string) {
		for k, v := range sel {
			if labels[k] != v {
				return
			}
		}
		out = append(out, name)
	}
	for _, c := range n.f.Services {
		match(c.Name, c.Labels)
	}
	for _, x := range n.f.Infra {
		match(x.Name, x.Labels)
	}
	return out
}

// deployable resolves the source end of a manifest wire: by its code folder when built from
// source, else by name.
func (n *names) deployable(name, dir string) *adr.Doc {
	if dir != "" {
		if id := n.o.of(dir); id != "" {
			return n.s.ByID[id]
		}
	}
	if es := n.element(name); len(es) == 1 {
		return es[0]
	}
	return nil
}

// connType is how a connection to an element reads: calls for something that answers requests,
// depends_on for infrastructure it reads and writes through.
func connType(to *adr.Doc) (typ, mode string) {
	switch to.Kind {
	case "store", "cache":
		return "depends_on", "data"
	case "broker":
		return "depends_on", "async"
	case "service", "app", "job", "external", "gateway":
		return "calls", "sync"
	}
	return "depends_on", ""
}

// Derive maps facts onto the store's elements.
func Derive(cfg *config.Config, s *adr.Store, f *scan.Facts) *Derived {
	o := newOwners(s)
	n := newNames(cfg, s, f, o)
	d := &Derived{ElemAt: map[string][]string{}, StepAt: map[string]string{}, Owners: map[string][]string{}, Tables: map[string]string{}, names: n}
	seen := map[string]bool{}
	add := func(l adr.Link) {
		if l.From == "" || l.To == "" || l.From == l.To {
			return
		}
		if c := s.ByID[l.To]; (c == nil || c.Kind != "contract") && o.related(l.From, l.To) {
			return // inside one element: not a connection on the map
		}
		k := l.From + ">" + l.To + ">" + l.Type + ">" + l.Via
		if seen[k] {
			return
		}
		seen[k] = true
		l.Source = "scan"
		d.Links = append(d.Links, l)
	}
	// manifests: depends_on, links and env values that name a host
	for _, w := range f.Wires {
		from := n.deployable(w.From, w.FromDir)
		if from == nil {
			continue
		}
		for _, to := range n.element(w.Host) {
			typ, mode := connType(to)
			label := w.How
			if w.Env != "" {
				label = "env " + w.Env
			}
			add(adr.Link{From: from.ID, To: to.ID, Type: typ, Mode: mode, Label: label, At: fmt.Sprintf("%s:%d", w.File, w.Line)})
		}
	}
	// hints: an env var → its element, wherever it is set or read
	if len(cfg.Scan.Env) > 0 {
		for _, e := range f.Env {
			if id, ok := cfg.Scan.Env[e.Name]; ok {
				if to, from := s.ByID[id], o.of(e.Mod); to != nil && from != "" {
					typ, mode := connType(to)
					add(adr.Link{From: from, To: to.ID, Type: typ, Mode: mode, Label: "env " + e.Name, At: fmt.Sprintf("%s:%d", e.File, e.Line)})
				}
			}
		}
		for _, e := range f.EnvSet {
			if id, ok := cfg.Scan.Env[e.Name]; ok {
				if to, from := s.ByID[id], n.deployable(e.From, e.FromDir); to != nil && from != nil {
					typ, mode := connType(to)
					add(adr.Link{From: from.ID, To: to.ID, Type: typ, Mode: mode, Label: "env " + e.Name, At: fmt.Sprintf("%s:%d", e.File, e.Line)})
				}
			}
		}
	}
	// hosts named in code
	for _, h := range f.Hosts {
		from := o.of(h.Mod)
		if from == "" {
			continue
		}
		for _, to := range n.element(h.Host) {
			typ, mode := connType(to)
			add(adr.Link{From: from, To: to.ID, Type: typ, Mode: mode, Label: h.Text, At: fmt.Sprintf("%s:%d", h.File, h.Line)})
		}
	}
	// gRPC: a client of service X → the one element that registers a server for X
	servers := map[string]map[string]bool{}
	for _, r := range f.Routes {
		if r.Kind == "grpc" {
			if id := o.of(r.Dir); id != "" {
				if servers[r.Path] == nil {
					servers[r.Path] = map[string]bool{}
				}
				servers[r.Path][id] = true
			}
		}
	}
	full := map[string]string{} // Orders → orders.v1.Orders
	for _, p := range f.Protos {
		if p.Package != "" {
			full[p.Name] = p.Package + "." + p.Name
		} else {
			full[p.Name] = p.Name
		}
	}
	for _, c := range f.Clients {
		if len(servers[c.Service]) != 1 {
			continue
		}
		from := o.of(c.Mod)
		for to := range servers[c.Service] {
			add(adr.Link{From: from, To: to, Type: "calls", Transport: "grpc", Mode: "sync", Label: firstNonEmpty(full[c.Service], c.Service), At: fmt.Sprintf("%s:%d", c.File, c.Line)})
		}
	}
	// topics and queues read or written through an API (never a guessed direction)
	cat := s.Catalog
	for _, t := range f.Topics {
		if t.Guess || t.Dir == "" {
			continue
		}
		from := o.of(t.Mod)
		if from == "" {
			continue
		}
		id, _, _, ok := adr.ContractID(cat, t.Kind+":"+t.Name)
		if !ok {
			continue
		}
		c := s.ByID[id]
		if c == nil {
			c = d.contract(id, t.Kind, t.Name)
		}
		typ := map[string]string{"pub": "publishes", "sub": "consumes"}[t.Dir]
		add(adr.Link{From: from, To: c.ID, Type: typ, Transport: c.Transport, Mode: "async", At: fmt.Sprintf("%s:%d", t.File, t.Line)})
	}
	// routes that serve a contract in the model: anchor exposes to the handler
	impls := map[string]scan.GRPCImpl{}
	for _, im := range f.GRPCImpls {
		impls[im.Service] = im
	}
	for _, r := range f.Routes {
		from := o.of(r.Dir)
		if from == "" {
			continue
		}
		for _, c := range s.Elements {
			if c.Kind != "contract" || (c.Transport != "http" && c.Transport != "grpc") || !routeMatches(c, r) {
				continue
			}
			at := firstNonEmpty(r.At, fmt.Sprintf("%s:%d", r.File, r.Line))
			if r.Kind == "grpc" {
				if im, ok := impls[r.Path]; ok {
					method := c.Name[strings.LastIndex(c.Name, "/")+1:]
					at = firstNonEmpty(im.Methods[method], im.At)
				}
			}
			add(adr.Link{From: from, To: c.ID, Type: "exposes", Transport: c.Transport, Mode: "sync", At: at})
		}
	}
	// ingress: the one gateway element routes a path to a service
	var gw *adr.Doc
	for _, e := range s.Elements {
		if e.Kind == "gateway" {
			if gw != nil {
				gw = nil
				break
			}
			gw = e
		}
	}
	if gw != nil {
		for _, in := range f.Ingress {
			for _, to := range n.element(in.Service) {
				add(adr.Link{From: gw.ID, To: to.ID, Type: "calls", Transport: "http", Mode: "sync", Label: strings.TrimSpace(in.Host + " " + in.Path), At: fmt.Sprintf("%s:%d", in.File, in.Line)})
			}
		}
	}
	// tables ↔ entities
	ents := map[string][]*adr.Doc{}
	for _, e := range s.Elements {
		if e.Kind != "entity" {
			continue
		}
		if e.Table != "" {
			ents[strings.ToLower(e.Table)] = append(ents[strings.ToLower(e.Table)], e)
			continue
		}
		for _, k := range tableNames(e.ID) {
			ents[k] = append(ents[k], e)
		}
	}
	for _, t := range f.Tables {
		if es := ents[t.Name]; len(es) == 1 {
			d.Tables[t.Name] = es[0].ID
			d.ElemAt[es[0].ID] = append(d.ElemAt[es[0].ID], t.File+"#"+t.Name)
		}
	}
	// CODEOWNERS → owners of elements that name none
	if len(f.Owners) > 0 {
		for _, e := range s.Elements {
			if e.Owner != "" || len(e.Code) == 0 || e.CodeImplied && !adr.IsStructural(e.Kind) {
				continue
			}
			p := strings.TrimSuffix(strings.TrimSuffix(e.Code[0], "/**"), "/*")
			if ow := f.OwnerOf(p); len(ow) > 0 {
				d.Owners[e.ID] = ow
			}
		}
	}
	// flow steps: the code that performs a step over a contract — the provider's handler for a
	// sync call, the publisher's write for an event — when exactly one anchor fits
	byPair := map[string][]string{}
	for _, l := range append(append([]adr.Link{}, s.Links...), d.Links...) {
		if l.At != "" && (l.Type == "exposes" || l.Type == "publishes") {
			byPair[l.From+">"+l.To] = append(byPair[l.From+">"+l.To], l.At)
		}
	}
	for _, fl := range s.Elements {
		for _, st := range fl.Steps {
			if st.At != "" || st.Contract == "" {
				continue
			}
			key := st.ToID + ">" + st.Contract
			if st.Async {
				key = st.FromID + ">" + st.Contract
			}
			if ats := uniq(byPair[key]); len(ats) == 1 {
				d.StepAt[fl.ID+"#"+st.ID] = ats[0]
			}
		}
	}
	return d
}

func (d *Derived) contract(id, transport, name string) *adr.Doc {
	for _, c := range d.Contract {
		if c.ID == id {
			return c
		}
	}
	c := &adr.Doc{Kind: "contract", ID: id, Title: name, Name: name, Transport: transport, Implied: true, Origin: "scan", Rel: map[string][]string{}, Tags: []string{}, Components: []string{}, Reopen: []string{}, Applies: []string{}, Mentions: []string{}, Sections: []adr.Section{}, Tech: []string{}, Code: []string{}}
	d.Contract = append(d.Contract, c)
	return c
}

// tableNames: the table names an entity id matches exactly — itself and its regular plurals,
// in snake_case.
func tableNames(id string) []string {
	b := strings.ReplaceAll(strings.ToLower(id), "-", "_")
	out := []string{b, b + "s", b + "es"}
	if strings.HasSuffix(b, "y") {
		out = append(out, b[:len(b)-1]+"ies")
	}
	return out
}

// Index loads the model and adds what the code says: the graph agents and the app read.
func Index(cfg *config.Config) (*adr.Store, *scan.Facts, *Derived) {
	s := adr.Load(cfg)
	f := scan.Run(cfg, s.Catalog, nil)
	d := Derive(cfg, s, f)
	Merge(cfg, s, d)
	return s, f, d
}

// Merge adds what the code says to the store: scanned connections (marking declared ones the
// code confirms as both), contracts only the code names, step and entity anchors, and owners.
func Merge(cfg *config.Config, s *adr.Store, d *Derived) {
	for _, c := range d.Contract {
		if s.ByID[c.ID] == nil {
			s.Elements = append(s.Elements, c)
			s.ByID[c.ID] = c
		}
	}
	anc := func(id string) map[string]bool {
		out := map[string]bool{id: true}
		for x := s.ByID[id]; x != nil && x.Parent != "" && !out[x.Parent]; x = s.ByID[x.Parent] {
			out[x.Parent] = true
		}
		return out
	}
	// a declared link confirms a scanned one when it joins the same elements (or their
	// containers) the same way: the same contract for exposes/publishes/consumes, any call or
	// data access otherwise
	family := func(t string) string {
		switch t {
		case "exposes", "publishes", "consumes":
			return t
		}
		return "conn"
	}
	for _, sl := range d.Links {
		af, at := anc(sl.From), anc(sl.To)
		confirmed := false
		for i := range s.Links {
			l := &s.Links[i]
			if l.Implied || l.Source == "scan" || family(l.Type) != family(sl.Type) {
				continue
			}
			if family(sl.Type) == "conn" && !connTypes[l.Type] {
				continue
			}
			if (af[l.From] || anc(l.From)[sl.From]) && (at[l.To] || anc(l.To)[sl.To]) {
				confirmed = true
				l.Source = "both"
				if l.At == "" || isManifest(l.At) && !isManifest(sl.At) { // code beats a manifest
					l.At = sl.At
				}
			}
		}
		if !confirmed {
			s.Links = append(s.Links, sl)
		}
	}
	// derived publisher → consumer and client → provider through contracts the scan added to
	providers := map[string][]adr.Link{}
	for _, l := range s.Links {
		if l.Type == "exposes" || l.Type == "publishes" {
			providers[l.To] = append(providers[l.To], l)
		}
	}
	have := map[string]bool{}
	for _, l := range s.Links {
		have[l.From+">"+l.To+">"+l.Type+">"+l.Via] = true
	}
	for _, l := range append([]adr.Link{}, s.Links...) {
		if l.Type != "consumes" && l.Type != "uses" {
			continue
		}
		for _, p := range providers[l.To] {
			if l.Source != "scan" && p.Source != "scan" {
				continue // linkElements already derived it
			}
			c := s.ByID[l.To]
			typ, from, to := "calls", l.From, p.From
			if l.Type == "consumes" {
				typ, from, to = "publishes", p.From, l.From
			}
			k := from + ">" + to + ">" + typ + ">" + c.ID
			if have[k] || from == to {
				continue
			}
			have[k] = true
			mode := s.Catalog.Mode(c.Transport)
			if mode == "" {
				mode = "sync"
			}
			s.Links = append(s.Links, adr.Link{From: from, To: to, Type: typ, Via: c.ID, Transport: c.Transport, Mode: mode, Label: c.Name, Implied: true, Source: "scan"})
		}
	}
	for _, e := range s.Elements {
		for i := range e.Steps {
			if at, ok := d.StepAt[e.ID+"#"+e.Steps[i].ID]; ok {
				e.Steps[i].At = at
			}
		}
		if ow := d.Owners[e.ID]; len(ow) > 0 && e.Owner == "" {
			e.Owner = strings.Join(ow, " ")
		}
	}
	ids := make([]string, 0, len(d.ElemAt))
	for id := range d.ElemAt {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if e := s.ByID[id]; e != nil {
			for _, a := range d.ElemAt[id] {
				if !contains(e.At, a) {
					e.At = append(e.At, a)
				}
			}
		}
	}
	// with the new connections, topics find their broker and entities their store
	s.Place(cfg)
	// scanned anchors join the anchor list so every reader resolves them to file:line
	r := code.NewResolver(cfg.Root)
	known := map[string]bool{}
	for _, a := range s.Anchors {
		known[a.Ref] = true
	}
	addAnchor := func(ref, el, where string) {
		if ref == "" || known[ref] {
			return
		}
		known[ref] = true
		s.Anchors = append(s.Anchors, adr.AnchorUse{Anchor: r.Resolve(ref), Element: el, Where: where, Scanned: true})
	}
	for _, l := range s.Links {
		if l.Source != "" {
			addAnchor(l.At, l.From, l.Type+":"+l.To)
		}
	}
	for _, e := range s.Elements {
		for _, st := range e.Steps {
			addAnchor(st.At, e.ID, "step:"+st.ID)
		}
		for _, a := range e.At {
			addAnchor(a, e.ID, "")
		}
	}
}

func isManifest(at string) bool {
	f, _, _ := code.Split(at)
	return strings.HasSuffix(f, ".yaml") || strings.HasSuffix(f, ".yml") || strings.HasSuffix(f, ".json") || strings.HasSuffix(f, ".tf")
}

var connTypes = map[string]bool{"calls": true, "uses": true, "reads": true, "writes": true, "depends_on": true, "stored_in": true}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}
