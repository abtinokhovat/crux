package adr

// Elements: any markdown file with a "crux: <kind>" header. Services, stores, contracts,
// entities, flows, questions, sessions and conventions are all elements; they connect through
// typed frontmatter lists (calls, publishes, reads, decided_by, …) that resolve into one graph.

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/abtinokhovat/crux/internal/catalog"
	"github.com/abtinokhovat/crux/internal/config"
)

// ── vocabulary ────────────────────────────────────────────────────

// Kinds are the values of the crux: header. Aliases map common words onto them.
var Kinds = []string{
	"system", "context", "service", "app", "module", "library", "job", "actor", "external",
	"store", "broker", "cache", "gateway", "infra",
	"contract", "entity", "flow", "question", "session", "convention", "doc", "adr",
}

var kindAlias = map[string]string{
	"platform": "system", "domain": "context", "bounded-context": "context", "boundedcontext": "context", "area": "context",
	"svc": "service", "microservice": "service", "binary": "service", "function": "service", "lambda": "service",
	"client": "app", "frontend": "app", "web": "app", "mobile": "app", "ui": "app", "cli": "app",
	"package": "module", "pkg": "module", "component": "module", "layer": "module", "port": "module", "adapter": "module",
	"lib": "library", "sdk": "library", "shared": "library",
	"worker": "job", "cron": "job", "batch": "job", "consumer": "job",
	"person": "actor", "user": "actor", "role": "actor",
	"saas": "external", "third-party": "external", "thirdparty": "external", "partner": "external", "provider": "external",
	"database": "store", "db": "store", "datastore": "store", "storage": "store", "bucket": "store", "index": "store",
	"bus": "broker", "stream": "broker", "mq": "broker", "eventbus": "broker",
	"proxy": "gateway", "lb": "gateway", "loadbalancer": "gateway", "ingress": "gateway", "cdn": "gateway",
	"infrastructure": "infra", "platform-service": "infra",
	"api": "contract", "endpoint": "contract", "interface": "contract", "rpc": "contract", "topic": "contract", "event": "contract", "queue": "contract", "webhook": "contract",
	"model": "entity", "aggregate": "entity", "table": "entity", "schema": "entity", "type": "entity",
	"process": "flow", "journey": "flow", "usecase": "flow", "use-case": "flow", "scenario": "flow",
	"open-question": "question", "unknown": "question",
	"log": "session", "meeting": "session",
	"rule": "convention", "standard": "convention", "guideline": "convention", "style": "convention",
	"note": "doc", "page": "doc", "readme": "doc",
	"decision": "adr", "record": "adr",
}

// Containers can hold other elements on the map. Lower rank holds higher rank.
var containerRank = map[string]int{
	"system": 0, "context": 1,
	"service": 2, "app": 2, "job": 2, "library": 2, "external": 2, "store": 2, "broker": 2, "cache": 2, "gateway": 2, "infra": 2, "actor": 2,
	"module": 3,
}

// Kinds whose folder is code: code: defaults to the folder of the file.
var codeKinds = map[string]bool{"service": true, "app": true, "job": true, "library": true, "module": true}

// IsStructural: the element draws as a box on the architecture map.
func IsStructural(kind string) bool { _, ok := containerRank[kind]; return ok }

// NormKind maps a header value onto a kind. Unknown words come back as-is (lint reports them).
func NormKind(v string) (string, bool) {
	k := strings.ToLower(strings.TrimSpace(v))
	for _, x := range Kinds {
		if x == k {
			return k, true
		}
	}
	if a, ok := kindAlias[k]; ok {
		return a, true
	}
	return k, false
}

// EdgeTypes: frontmatter keys that declare connections, with how each reads both ways.
var EdgeTypes = map[string]map[string]string{
	"calls":      {"label": "calls", "inverse": "called by"},
	"exposes":    {"label": "exposes", "inverse": "exposed by"},
	"uses":       {"label": "uses", "inverse": "used by"},
	"publishes":  {"label": "publishes", "inverse": "published by"},
	"consumes":   {"label": "consumes", "inverse": "consumed by"},
	"reads":      {"label": "reads", "inverse": "read by"},
	"writes":     {"label": "writes", "inverse": "written by"},
	"owns":       {"label": "owns", "inverse": "owned by"},
	"depends_on": {"label": "depends on", "inverse": "required by"},
	"runs_on":    {"label": "runs on", "inverse": "runs"},
	"implements": {"label": "implements", "inverse": "implemented by"},
	"decided_by": {"label": "decided by", "inverse": "decides"},
	"blocked_by": {"label": "blocked by", "inverse": "blocks"},
	"blocks":     {"label": "blocks", "inverse": "blocked by"},
	"relates":    {"label": "relates to", "inverse": "relates to"},
	"raised_from": {"label": "raised from", "inverse": "raised"},
	"produced":   {"label": "produced", "inverse": "produced in"},
	"applies_to": {"label": "applies to", "inverse": "governed by"},
	"flows":      {"label": "flows through", "inverse": "in flow"},
	"mentions":   {"label": "mentions", "inverse": "mentioned by"},
}

var edgeAlias = map[string]string{
	"call": "calls", "invokes": "calls", "talks_to": "calls", "requests": "calls",
	"provides": "exposes", "serves": "exposes", "offers": "exposes", "expose": "exposes",
	"client_of": "uses", "use": "uses", "requires": "uses",
	"emits": "publishes", "produces": "publishes", "sends": "publishes", "publish": "publishes", "fires": "publishes",
	"subscribes": "consumes", "listens": "consumes", "listens_to": "consumes", "subscribes_to": "consumes", "consume": "consumes", "handles": "consumes",
	"read": "reads", "queries": "reads", "write": "writes", "stores": "writes", "persists": "writes", "readwrite": "readwrite", "reads_writes": "readwrite",
	"own": "owns", "owner_of": "owns", "depends": "depends_on", "depends-on": "depends_on", "dependson": "depends_on", "imports": "depends_on",
	"runs-on": "runs_on", "deployed_to": "runs_on", "deployed_on": "runs_on", "hosted_on": "runs_on",
	"implement": "implements", "decided-by": "decided_by", "decisions": "decided_by", "adrs": "decided_by",
	"blocked-by": "blocked_by", "questions": "blocked_by", "related": "relates", "relates_to": "relates", "see": "relates",
	"raised-from": "raised_from", "creates": "produced", "outputs": "produced",
}

// ── parsing ───────────────────────────────────────────────────────

// Link is one typed connection in the graph. Via names a contract the connection goes through.
type Link struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Type      string `json:"type"`
	Via       string `json:"via,omitempty"`
	Transport string `json:"transport,omitempty"`
	Mode      string `json:"mode,omitempty"` // sync | async | stream | data | trigger
	Label     string `json:"label,omitempty"`
	Implied   bool   `json:"implied,omitempty"` // derived (e.g. publisher → consumer through a topic)
}

type Step struct {
	ID        string   `json:"id"`
	From      string   `json:"from"`
	To        string   `json:"to"`
	FromID    string   `json:"fromId,omitempty"`
	ToID      string   `json:"toId,omitempty"`
	Async     bool     `json:"async,omitempty"`
	Transport string   `json:"transport,omitempty"`
	Name      string   `json:"name,omitempty"`
	Contract  string   `json:"contract,omitempty"`
	Label     string   `json:"label,omitempty"`
	Phase     string   `json:"phase,omitempty"`
	Notes     []string `json:"notes,omitempty"`
	Branches  []Branch `json:"branches,omitempty"`
	Line      int      `json:"line"`
}

type Branch struct {
	When string `json:"when"`
	To   string `json:"to"`
}

type rawRef struct {
	Type, Target, Via, Transport, Label string
}

var (
	viaRe     = regexp.MustCompile(`^(.+?)\s+(?:via|over|through)\s+(.+)$`)
	parenRe   = regexp.MustCompile(`^(.+?)\s*\(([^)]+)\)\s*$`)
	contRe    = regexp.MustCompile(`^([A-Za-z][\w-]*)\s*:\s*(.+)$`)
	wikiRe    = regexp.MustCompile(`\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]`)
	httpVerbs = regexp.MustCompile(`(?i)^(get|post|put|patch|delete|head|options)\s+`)
)

// refsOf reads a frontmatter value as references: "billing", "billing via grpc:Charge",
// "psp (http)", "topic:order.created", or {to, via, transport, label} maps.
func refsOf(typ string, v any) []rawRef {
	var out []rawRef
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		r := rawRef{Type: typ, Target: s}
		if m := viaRe.FindStringSubmatch(s); m != nil {
			r.Target, r.Via = strings.TrimSpace(m[1]), strings.TrimSpace(m[2])
		} else if m := parenRe.FindStringSubmatch(s); m != nil {
			r.Target, r.Transport = strings.TrimSpace(m[1]), strings.TrimSpace(m[2])
		}
		out = append(out, r)
	}
	switch x := v.(type) {
	case nil:
	case []any:
		for _, e := range x {
			if m, ok := e.(map[string]any); ok {
				r := rawRef{Type: typ, Target: Str(firstOf(m["to"], m["id"], m["target"])), Via: Str(firstOf(m["via"], m["contract"])), Transport: Str(m["transport"]), Label: Str(m["label"])}
				if r.Target == "" && len(m) == 1 {
					for k, val := range m { // "- billing: grpc Charge" reads as {billing: "grpc Charge"}
						r.Target, r.Label = k, Str(val)
					}
				}
				out = append(out, r)
				continue
			}
			add(Str(e))
		}
	case map[string]any:
		for k, val := range x {
			out = append(out, rawRef{Type: typ, Target: k, Label: Str(val)})
		}
	default:
		for _, s := range AsList(x) {
			add(s)
		}
	}
	return out
}

// ContractID canonicalizes "event: order.created" → "topic:order.created" and upper-cases HTTP
// verbs. ok is false when the prefix is not a transport (then it is not a contract ref).
func ContractID(cat *catalog.Catalog, ref string) (id, transport, name string, ok bool) {
	m := contRe.FindStringSubmatch(strings.TrimSpace(ref))
	if m == nil {
		return "", "", "", false
	}
	t, known := cat.TransportID(m[1])
	if !known {
		return "", "", "", false
	}
	name = strings.TrimSpace(m[2])
	if t == "http" {
		if v := httpVerbs.FindStringSubmatch(name); v != nil {
			name = strings.ToUpper(strings.TrimSpace(v[1])) + " " + strings.TrimSpace(name[len(v[0]):])
		}
	}
	return t + ":" + name, t, name, true
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func Slug(s string) string {
	return strings.Trim(slugRe.ReplaceAllString(strings.ToLower(s), "-"), "-")
}

func h1(body string) string {
	if m := regexp.MustCompile(`(?m)^#\s+(.+?)\s*$`).FindStringSubmatch(body); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// readElement fills element fields from a parsed file. kind is already normalized.
func readElement(d *Doc, kind string, body string, cfg *config.Config, cat *catalog.Catalog) {
	meta := d.Meta
	d.Kind = kind
	d.Title = firstNonEmpty(Str(meta["title"]), Str(meta["label"]), h1(body))
	d.ID = Str(meta["id"])
	if kind == "contract" {
		t := Str(firstOf(meta["transport"], meta["protocol"]))
		if t == "" {
			if raw := strings.ToLower(Str(meta["crux"])); raw != "contract" {
				t = raw // crux: topic → transport topic
			}
		}
		name := firstNonEmpty(Str(meta["name"]), Str(meta["path"]), Str(meta["topic"]), d.Title)
		if d.ID != "" {
			if id, tt, nm, ok := ContractID(cat, d.ID); ok {
				d.ID, t, name = id, tt, firstNonEmpty(Str(meta["name"]), nm)
			}
		}
		if t != "" {
			if id, tt, nm, ok := ContractID(cat, t+":"+name); ok && (d.ID == "" || !strings.Contains(d.ID, ":")) {
				d.ID, t, name = id, tt, nm
			}
			if tt, ok := cat.TransportID(t); ok {
				t = tt
			}
		}
		d.Transport, d.Name = t, name
		if d.Title == "" {
			d.Title = name
		}
		d.On = Str(firstOf(meta["on"], meta["broker"], meta["host"]))
		d.Schema = Str(meta["schema"])
	}
	if d.ID == "" {
		d.ID = Slug(d.Title)
	}
	if d.ID == "" {
		d.ID = Slug(strings.TrimSuffix(filepath.Base(d.File), ".md"))
		if d.ID == "crux" || d.ID == "readme" || d.ID == "index" {
			d.ID = Slug(filepath.Base(filepath.Dir(d.File)))
		}
	}
	if d.Title == "" {
		d.Title = d.ID
	}
	d.Subtitle = firstNonEmpty(d.Subtitle, Str(meta["summary"]), Str(meta["sub"]), Str(meta["description"]))
	d.Status = Str(meta["status"])
	d.StatusKey = ""
	if d.Status != "" {
		d.StatusKey = StatusKey(d.Status)
	}
	d.Parent = Str(firstOf(meta["in"], meta["parent"], meta["part_of"]))
	for _, t := range AsList(meta["tech"]) {
		id, _ := cat.TechID(t)
		d.Tech = append(d.Tech, id)
	}
	d.Code = AsList(firstOf(meta["code"], meta["paths"]))
	d.Origin = strings.ToLower(Str(meta["origin"]))
	d.Confidence = strings.ToLower(Str(meta["confidence"]))
	d.Evidence = AsList(meta["evidence"])
	d.Trigger = Str(meta["trigger"])
	d.Outcome = Str(meta["outcome"])
	d.Phase = strings.ToLower(Str(meta["phase"]))
	d.RaisedFrom = Str(firstOf(meta["raised_from"], meta["raised-from"], meta["from_step"]))
	d.Answer = Str(meta["answer"])
	if kind == "question" {
		d.State = strings.ToLower(firstNonEmpty(Str(meta["state"]), Str(meta["status"])))
		_, panels := Panels(body)
		for _, p := range panels {
			if regexp.MustCompile(`(?i)^(answer|resolution|decision)\b`).MatchString(p.Title) && d.Answer == "" {
				d.Answer = Plain(paraSplit.Split(strings.TrimSpace(mdText(p.Blocks)), 2)[0])
			}
		}
		if d.State == "" || d.State == "proposed" {
			d.State = "open"
			if d.Answer != "" {
				d.State = "answered"
			}
		}
		d.Status, d.StatusKey = strings.ToUpper(d.State[:1])+d.State[1:], d.State
	}
	if kind == "session" && d.Date == "" {
		d.Date = Str(meta["when"])
	}
	if kind == "flow" {
		d.Steps = ParseSteps(stepsText(body), cat)
	}
	d.Mentions = mentionsIn(body, cfg, d.ID)
	for _, m := range wikiRe.FindAllStringSubmatch(body, -1) {
		d.Wiki = append(d.Wiki, strings.TrimSpace(m[1]))
	}
}

// stepsText joins every ```steps fence in the body.
func stepsText(body string) string {
	intro, panels := Panels(body)
	var parts []string
	all := append([]Block{}, intro...)
	for _, p := range panels {
		all = append(all, p.Blocks...)
	}
	for _, b := range all {
		if b.Type == "fence" && (b.Lang == "steps" || b.Lang == "crux-steps") {
			parts = append(parts, b.Text)
		}
	}
	return strings.Join(parts, "\n")
}

var (
	stepRe   = regexp.MustCompile(`^(?:([\w.-]+)\s*:\s+)?(.+?)\s*(-->|->|~>|=>)\s*(.+?)(?:\s+:\s*(.*)|:\s+(.*))?$`)
	branchRe = regexp.MustCompile(`^\?\s*(.+?)\s*(?:->|=>|→)\s*([\w.-]+)\s*$`)
	phaseRe  = regexp.MustCompile(`^==\s*(.+?)\s*(?:==)?$`)
	noteRe   = regexp.MustCompile(`(?i)^note\s*:\s*(.+)$`)
)

// ParseSteps reads the steps DSL:
//
//	== phase ==
//	id: from -> to : transport name     (--> or ~> async)
//	  ? condition -> step-id | end
//	note: text
func ParseSteps(text string, cat *catalog.Catalog) []Step {
	var out []Step
	phase := ""
	for i, raw := range strings.Split(text, "\n") {
		t := strings.TrimSpace(raw)
		if t == "" || strings.HasPrefix(t, "//") || strings.HasPrefix(t, "#") {
			continue
		}
		if m := phaseRe.FindStringSubmatch(t); m != nil {
			phase = m[1]
			continue
		}
		if m := branchRe.FindStringSubmatch(t); m != nil && len(out) > 0 {
			out[len(out)-1].Branches = append(out[len(out)-1].Branches, Branch{When: m[1], To: m[2]})
			continue
		}
		if m := noteRe.FindStringSubmatch(t); m != nil && len(out) > 0 {
			out[len(out)-1].Notes = append(out[len(out)-1].Notes, m[1])
			continue
		}
		m := stepRe.FindStringSubmatch(t)
		if m == nil {
			continue
		}
		s := Step{ID: m[1], From: strings.TrimSpace(m[2]), To: strings.TrimSpace(m[4]), Async: m[3] == "-->" || m[3] == "~>", Phase: phase, Line: i + 1}
		label := strings.TrimSpace(firstNonEmpty(m[5], m[6]))
		s.Label = label
		if label != "" {
			f := strings.Fields(label)
			if tid, ok := cat.TransportID(f[0]); ok {
				s.Transport = tid
				s.Name = strings.TrimSpace(strings.TrimPrefix(label, f[0]))
				if s.Name != "" {
					if id, _, nm, ok := ContractID(cat, tid+":"+s.Name); ok {
						s.Contract, s.Name = id, nm
					}
				}
				if mode := cat.Mode(tid); mode == "async" || mode == "stream" {
					s.Async = true
				}
			} else if id, tid, nm, ok := ContractID(cat, label); ok {
				s.Transport, s.Name, s.Contract = tid, nm, id
				if cat.Mode(tid) == "async" {
					s.Async = true
				}
			}
		}
		if s.ID == "" {
			s.ID = fmt.Sprintf("s%d", len(out)+1)
		}
		out = append(out, s)
	}
	return out
}

// ── graph ─────────────────────────────────────────────────────────

// resolver finds elements by id, slugged id or title.
type resolver struct {
	byID  map[string]*Doc
	byKey map[string]*Doc
}

func newResolver(all []*Doc) *resolver {
	r := &resolver{byID: map[string]*Doc{}, byKey: map[string]*Doc{}}
	for _, d := range all {
		r.byID[d.ID] = d
	}
	for _, d := range all {
		if d.Kind == "adr" {
			continue
		}
		for _, k := range []string{Slug(d.ID), Slug(d.Title)} {
			if _, taken := r.byKey[k]; k != "" && !taken {
				r.byKey[k] = d
			}
		}
	}
	return r
}

func (r *resolver) find(ref string) *Doc {
	ref = strings.TrimSpace(ref)
	if d := r.byID[ref]; d != nil {
		return d
	}
	return r.byKey[Slug(ref)]
}

// linkElements resolves every element's declared connections, creates implied contracts,
// infers parents, and appends links and problems to the store.
func linkElements(s *Store, cfg *config.Config, cat *catalog.Catalog) {
	els := s.Elements
	// contract refs anywhere create the contract when no file defines it
	implied := map[string]*Doc{}
	contract := func(ref string) *Doc {
		id, t, name, ok := ContractID(cat, ref)
		if !ok {
			return nil
		}
		if d := s.ByID[id]; d != nil {
			return d
		}
		if d := implied[id]; d != nil {
			return d
		}
		d := &Doc{Kind: "contract", ID: id, Title: name, Name: name, Transport: t, Implied: true, Rel: map[string][]string{}, Tags: []string{}, Components: []string{}, Reopen: []string{}, Applies: []string{}, Mentions: []string{}, Sections: []Section{}, Facts: Facts{Options: []OptionGroup{}, Questions: []string{}, Consequences: []string{}, Criteria: []string{}}}
		implied[id] = d
		return d
	}
	type pending struct {
		from *Doc
		r    rawRef
	}
	var refs []pending
	for _, d := range els {
		for k, v := range d.Meta {
			key := strings.ToLower(strings.ReplaceAll(k, "-", "_"))
			if a, ok := edgeAlias[key]; ok {
				key = a
			}
			if key == "readwrite" {
				for _, r := range refsOf("reads", v) {
					refs = append(refs, pending{d, r})
				}
				key = "writes"
			}
			if _, ok := EdgeTypes[key]; !ok || key == "mentions" || key == "flows" {
				continue
			}
			if key == "applies_to" && d.Kind != "convention" {
				continue
			}
			for _, r := range refsOf(key, v) {
				if key == "applies_to" && strings.ContainsAny(r.Target, "/*") {
					d.Code = append(d.Code, r.Target) // a glob: the code this convention governs
					continue
				}
				refs = append(refs, pending{d, r})
			}
		}
		if d.Kind == "question" && d.RaisedFrom != "" {
			refs = append(refs, pending{d, rawRef{Type: "raised_from", Target: d.RaisedFrom}})
		}
		for _, w := range d.Wiki {
			refs = append(refs, pending{d, rawRef{Type: "mentions", Target: w}})
		}
		for _, st := range d.Steps {
			if st.Contract != "" {
				contract(st.Contract)
			}
		}
	}
	// pre-create contracts so the resolver sees them
	for _, p := range refs {
		for _, x := range []string{p.r.Target, p.r.Via} {
			if x != "" {
				contract(x)
			}
		}
	}
	ids := make([]string, 0, len(implied))
	for id := range implied {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		s.Elements = append(s.Elements, implied[id])
		s.ByID[id] = implied[id]
	}
	all := append(append(append([]*Doc{}, s.Adrs...), s.Docs...), s.Elements...)
	res := newResolver(all)
	adrRef := func(x string) *Doc {
		if id := RefID(x, cfg.Digits); id != "" && digitsOnly(x) {
			return s.ByID[id]
		}
		if regexp.MustCompile(`(?i)^`+regexp.QuoteMeta(cfg.Prefix)+`[-\s]?\d+$`).MatchString(strings.TrimSpace(x)) {
			return s.ByID[RefID(x, cfg.Digits)]
		}
		return nil
	}
	find := func(x string) *Doc {
		if d := adrRef(x); d != nil {
			return d
		}
		if id, _, _, ok := ContractID(cat, x); ok {
			return s.ByID[id]
		}
		if i := strings.Index(x, "#"); i > 0 { // flow:checkout#charge, checkout#charge
			x = x[:i]
		}
		x = strings.TrimPrefix(strings.TrimPrefix(x, "flow:"), "el:")
		return res.find(x)
	}
	seen := map[string]bool{}
	addLink := func(l Link) {
		k := l.From + ">" + l.To + ">" + l.Type + ">" + l.Via
		if seen[k] || l.From == l.To {
			return
		}
		seen[k] = true
		s.Links = append(s.Links, l)
	}
	for _, p := range refs {
		from, r := p.from, p.r
		to := find(r.Target)
		if to == nil {
			if r.Type == "mentions" {
				continue
			}
			s.Problems = append(s.Problems, Problem{File: from.File, Message: fmt.Sprintf("%s: %q is not a known element, contract or ADR", r.Type, r.Target), Level: "warn"})
			continue
		}
		l := Link{From: from.ID, To: to.ID, Type: r.Type, Label: r.Label}
		if r.Via != "" {
			if c := find(r.Via); c != nil {
				l.Via = c.ID
				l.Transport = c.Transport
				if l.Label == "" {
					l.Label = c.Name
				}
			} else {
				s.Problems = append(s.Problems, Problem{File: from.File, Message: fmt.Sprintf("%s %s via %q: unknown contract", r.Type, r.Target, r.Via), Level: "warn"})
			}
		}
		if r.Transport != "" {
			if t, ok := cat.TransportID(r.Transport); ok {
				l.Transport = t
			} else {
				l.Label = firstNonEmpty(l.Label, r.Transport)
			}
		}
		if to.Kind == "contract" && l.Transport == "" {
			l.Transport = to.Transport
		}
		switch r.Type {
		case "reads", "writes":
			l.Mode = "data"
			if l.Transport == "" {
				l.Transport = dataTransport(to, cat)
			}
		case "publishes", "consumes":
			l.Mode = "async"
		case "decided_by", "blocked_by", "blocks", "relates", "raised_from", "produced", "mentions", "owns", "applies_to", "implements", "runs_on", "depends_on":
		default:
			l.Mode = cat.Mode(l.Transport)
			if l.Mode == "" {
				l.Mode = "sync"
			}
		}
		if l.Transport != "" && l.Mode == "" && r.Type != "owns" && r.Type != "decided_by" {
			l.Mode = cat.Mode(l.Transport)
		}
		addLink(l)
	}
	// "calls X via C": the caller is a client of contract C, and X provides C unless someone
	// else declares it
	provided := map[string]bool{}
	for _, l := range s.Links {
		if l.Type == "exposes" || l.Type == "publishes" {
			provided[l.To] = true
		}
	}
	for _, l := range append([]Link{}, s.Links...) {
		if l.Type == "calls" && l.Via != "" && !l.Implied {
			addLink(Link{From: l.From, To: l.Via, Type: "uses", Transport: l.Transport, Mode: l.Mode, Implied: true})
			if !provided[l.Via] {
				addLink(Link{From: l.To, To: l.Via, Type: "exposes", Transport: l.Transport, Mode: l.Mode, Implied: true})
				provided[l.Via] = true
			}
		}
	}
	// ADR components: an ADR about an element decides it
	for _, a := range s.Adrs {
		for _, c := range a.Components {
			if e := res.find(c); e != nil && e.Kind != "adr" {
				addLink(Link{From: e.ID, To: a.ID, Type: "decided_by"})
			}
		}
	}
	// contract placement: hosted on a broker (on:), else under its provider
	for _, d := range s.Elements {
		if d.Kind != "contract" || d.Parent != "" {
			continue
		}
		if d.On != "" {
			if b := find(d.On); b != nil {
				d.Parent = b.ID
				continue
			}
		}
		for _, l := range s.Links {
			if l.To == d.ID && (l.Type == "exposes" || (l.Type == "publishes" && d.Transport == "webhook")) {
				d.Parent = l.From
				break
			}
		}
	}
	// a topic everybody publishes to on one broker: put it on that broker when the publisher runs on it
	for _, d := range s.Elements {
		if d.Kind == "contract" && d.Parent == "" && (d.Transport == "topic" || d.Transport == "queue") {
			brokers := map[string]bool{}
			for _, l := range s.Links {
				if l.To != d.ID || (l.Type != "publishes" && l.Type != "consumes") {
					continue
				}
				for _, l2 := range s.Links {
					if l2.From == l.From && (l2.Type == "uses" || l2.Type == "depends_on" || l2.Type == "calls") {
						if b := s.ByID[l2.To]; b != nil && b.Kind == "broker" {
							brokers[b.ID] = true
						}
					}
				}
			}
			if len(brokers) == 1 {
				for b := range brokers {
					d.Parent = b
				}
			} else if n := onlyBroker(s.Elements); n != "" {
				d.Parent = n
			}
		}
	}
	// derived: publisher → consumer through a topic, client → provider through an endpoint
	providers := map[string][]Link{}
	for _, l := range s.Links {
		if l.Type == "exposes" || l.Type == "publishes" {
			providers[l.To] = append(providers[l.To], l)
		}
	}
	for _, l := range append([]Link{}, s.Links...) {
		if l.Type != "consumes" && l.Type != "uses" {
			continue
		}
		for _, p := range providers[l.To] {
			c := s.ByID[l.To]
			typ := "calls"
			from, to := l.From, p.From
			if l.Type == "consumes" {
				typ = "publishes"
				from, to = p.From, l.From
			}
			addLink(Link{From: from, To: to, Type: typ, Via: c.ID, Transport: c.Transport, Mode: firstNonEmpty(cat.Mode(c.Transport), "sync"), Label: c.Name, Implied: true})
		}
	}
	// parents: explicit in:, else the nearest container in an enclosing folder
	inferParents(s, res, cfg)
	// code defaults and owned entities
	for _, d := range s.Elements {
		if len(d.Code) == 0 && codeKinds[d.Kind] && d.File != "" && dirHasCode(cfg.Abs(path.Dir(d.File))) {
			if dir := path.Dir(d.File); dir != "." {
				d.Code = []string{dir + "/**"}
				d.CodeImplied = true
			}
		}
		if d.Kind == "entity" && d.Parent == "" {
			for _, l := range s.Links {
				if l.Type == "owns" && l.To == d.ID {
					d.Parent = l.From
				}
			}
		}
	}
	// questions: blocked_by on X is "blocks X" on the question
	for _, d := range s.Elements {
		if d.Tech == nil {
			d.Tech = []string{}
		}
		if d.Code == nil {
			d.Code = []string{}
		}
	}
	// flow steps: resolve participants
	for _, d := range s.Elements {
		for i := range d.Steps {
			st := &d.Steps[i]
			if e := find(st.From); e != nil {
				st.FromID = e.ID
			} else {
				s.Problems = append(s.Problems, Problem{File: d.File, Line: st.Line, Message: fmt.Sprintf("flow %s step %s: %q is not a known element", d.ID, st.ID, st.From), Level: "warn"})
			}
			if e := find(st.To); e != nil {
				st.ToID = e.ID
			} else {
				s.Problems = append(s.Problems, Problem{File: d.File, Line: st.Line, Message: fmt.Sprintf("flow %s step %s: %q is not a known element", d.ID, st.ID, st.To), Level: "warn"})
			}
			if st.FromID != "" {
				addLink(Link{From: d.ID, To: st.FromID, Type: "flows"})
			}
			if st.ToID != "" {
				addLink(Link{From: d.ID, To: st.ToID, Type: "flows"})
			}
			if st.Contract != "" {
				addLink(Link{From: d.ID, To: st.Contract, Type: "flows"})
			}
			stepIDs := map[string]bool{"end": true, "done": true}
			for _, x := range d.Steps {
				stepIDs[x.ID] = true
			}
			for _, b := range st.Branches {
				if !stepIDs[b.To] {
					s.Problems = append(s.Problems, Problem{File: d.File, Line: st.Line, Message: fmt.Sprintf("flow %s step %s: branch goes to unknown step %q", d.ID, st.ID, b.To), Level: "warn"})
				}
			}
		}
	}
}

func digitsOnly(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func onlyBroker(els []*Doc) string {
	id := ""
	for _, d := range els {
		if d.Kind == "broker" {
			if id != "" {
				return ""
			}
			id = d.ID
		}
	}
	return id
}

func dataTransport(to *Doc, cat *catalog.Catalog) string {
	for _, t := range to.Tech {
		if tech := cat.Tech[t]; tech != nil {
			switch tech.Category {
			case "store":
				return "sql"
			case "kv", "cache":
				return "kv"
			case "blob":
				return "blob"
			case "search":
				return "search"
			}
		}
	}
	switch to.Kind {
	case "cache":
		return "kv"
	case "store":
		return "sql"
	}
	return ""
}

func dirHasCode(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		n := e.Name()
		if strings.HasPrefix(n, ".") {
			continue
		}
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(n), ".md") {
			return true
		}
	}
	return false
}

func inferParents(s *Store, res *resolver, cfg *config.Config) {
	byDir := map[string][]*Doc{}
	for _, d := range s.Elements {
		if d.File != "" && IsStructural(d.Kind) {
			byDir[path.Dir(d.File)] = append(byDir[path.Dir(d.File)], d)
		}
	}
	rankOf := func(k string) int {
		if r, ok := containerRank[k]; ok {
			return r
		}
		return 9
	}
	for _, d := range s.Elements {
		if d.Parent != "" {
			if p := res.find(d.Parent); p != nil && p != d {
				d.Parent = p.ID
			} else {
				s.Problems = append(s.Problems, Problem{File: d.File, Message: fmt.Sprintf("in: %q is not a known element", d.Parent), Level: "warn"})
				d.Parent = ""
			}
			continue
		}
		if d.File == "" || d.Kind == "adr" || d.Kind == "doc" || d.Kind == "session" {
			continue
		}
		my := rankOf(d.Kind)
		for dir := path.Dir(d.File); ; dir = path.Dir(dir) {
			var best *Doc
			for _, c := range byDir[dir] {
				if c == d || rankOf(c.Kind) >= my {
					continue
				}
				if best == nil || rankOf(c.Kind) > rankOf(best.Kind) {
					best = c
				}
			}
			if best != nil {
				d.Parent = best.ID
				break
			}
			if dir == "." || dir == "/" || dir == "" {
				break
			}
		}
	}
	// break cycles
	for _, d := range s.Elements {
		seen := map[string]bool{d.ID: true}
		for p := s.ByID[d.Parent]; p != nil; p = s.ByID[p.Parent] {
			if seen[p.ID] {
				s.Problems = append(s.Problems, Problem{File: d.File, Message: fmt.Sprintf("in: cycle through %q", p.ID)})
				d.Parent = ""
				break
			}
			seen[p.ID] = true
		}
	}
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}
