package adr

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/abtinokhovat/crux/internal/catalog"
	"github.com/abtinokhovat/crux/internal/config"
	"gopkg.in/yaml.v3"
)

// Relations an ADR can declare in frontmatter, with how the other side reads.
var Relations = map[string]map[string]string{
	"supersedes":    {"label": "supersedes", "inverse": "superseded by"},
	"superseded_by": {"label": "superseded by", "inverse": "supersedes"},
	"depends_on":    {"label": "depends on", "inverse": "required by"},
	"amends":        {"label": "amends", "inverse": "amended by"},
	"relates":       {"label": "relates to", "inverse": "relates to"},
	"mentions":      {"label": "mentions", "inverse": "mentioned by"},
}

var relAliases = map[string]string{"superseded-by": "superseded_by", "supersededby": "superseded_by", "depends-on": "depends_on", "depends": "depends_on", "related": "relates", "relates_to": "relates"}

type Section struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type Doc struct {
	Kind       string              `json:"kind"`
	ID         string              `json:"id"`
	Num        int                 `json:"num,omitempty"`
	Slug       string              `json:"slug,omitempty"`
	File       string              `json:"file"`
	Mtime      int64               `json:"mtime"`
	Title      string              `json:"title"`
	Subtitle   string              `json:"subtitle"`
	Status     string              `json:"status"`
	StatusKey  string              `json:"statusKey"`
	Date       string              `json:"date"`
	Author     string              `json:"author"`
	Owner      string              `json:"owner"`
	Due        string              `json:"due"`
	Reopen     []string            `json:"reopen"`
	Applies    []string            `json:"applies"`
	Tags       []string            `json:"tags"`
	Components []string            `json:"components"`
	Rel        map[string][]string `json:"rel"`
	Mentions   []string            `json:"mentions"`
	Facts      Facts               `json:"facts"`
	Sections   []Section           `json:"sections"`
	Text       string              `json:"text"`
	Meta       map[string]any      `json:"-"`
	Source     string              `json:"-"`

	// elements (crux: <kind> files)
	Parent      string   `json:"parent,omitempty"`
	Tech        []string `json:"tech,omitempty"`
	Code        []string `json:"code,omitempty"`
	CodeImplied bool     `json:"codeImplied,omitempty"`
	Origin      string   `json:"origin,omitempty"`
	Confidence  string   `json:"confidence,omitempty"`
	Evidence    []string `json:"evidence,omitempty"`
	Transport   string   `json:"transport,omitempty"` // contract
	Name        string   `json:"name,omitempty"`      // contract: "POST /orders", "order.created"
	On          string   `json:"on,omitempty"`
	Schema      string   `json:"schema,omitempty"`
	Trigger     string   `json:"trigger,omitempty"` // flow
	Outcome     string   `json:"outcome,omitempty"`
	Steps       []Step   `json:"steps,omitempty"`
	Phase       string   `json:"phase,omitempty"` // session
	State       string   `json:"state,omitempty"` // question: open | answered
	RaisedFrom  string   `json:"raisedFrom,omitempty"`
	Answer      string   `json:"answer,omitempty"`
	Implied     bool     `json:"implied,omitempty"` // made from a reference; no file
	Unknown     bool     `json:"unknown,omitempty"` // crux: value is not a known kind
	Wiki        []string `json:"-"`
}

type Edge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Type string `json:"type"`
}

type Problem struct {
	File    string `json:"file"`
	Message string `json:"message"`
	Level   string `json:"level,omitempty"`
	Line    int    `json:"line,omitempty"`
}

type Node struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Kind     string   `json:"kind"`
	Tech     string   `json:"tech"`  // infra technology (redis, kafka, postgres…): colors the box
	Techs    []string `json:"techs,omitempty"`
	Doc      string   `json:"doc,omitempty"`    // element id when the box comes from a crux file
	Origin   string   `json:"origin,omitempty"` // inferred boxes draw dotted
	Lines    string   `json:"lines"` // "straight" draws this level with straight lines instead of elbows
	Sub      string   `json:"sub"`
	Desc     string   `json:"desc"`
	Tags     []string `json:"tags"`
	Parent   *string  `json:"parent"`
	Children []string `json:"children"`
	Adrs     []string `json:"adrs"`
	Docs     []string `json:"docs"`
	Paths    []string `json:"paths"`
	At       []int    `json:"at"`
	X        *float64 `json:"x"`
	Y        *float64 `json:"y"`
	W        *float64 `json:"w"`
	H        *float64 `json:"h"`
	Tag      *string  `json:"tag"`
	Groups   []Group  `json:"groups"`
	Deep     []string `json:"deep"`
}

type Group struct {
	Label string   `json:"label"`
	Nodes []string `json:"nodes"`
}

type ArchEdge struct {
	From   string    `json:"from"`
	To     string    `json:"to"`
	Label  string    `json:"label"`
	Dashed bool      `json:"dashed"`
	Both   bool      `json:"both"`
	Sel    bool      `json:"sel"`
	Lp     *float64  `json:"lp"`
	Lo     []float64 `json:"lo"`
	// from element links
	Type      string `json:"type,omitempty"`
	Transport string `json:"transport,omitempty"`
	Mode      string `json:"mode,omitempty"`
	Via       string `json:"via,omitempty"`
}

type Architecture struct {
	Title  string           `json:"title"`
	Desc   string           `json:"desc"`
	Roots  []string         `json:"roots"`
	Nodes  map[string]*Node `json:"nodes"`
	Edges  []ArchEdge       `json:"edges"`
	Groups []Group          `json:"groups"`
	Lines  string           `json:"lines"` // top level: "straight" or "" (elbow)
	order  []string
}

type Store struct {
	Adrs         []*Doc              `json:"adrs"`
	Docs         []*Doc              `json:"docs"`
	Elements     []*Doc              `json:"elements"`
	Links        []Link              `json:"links"`
	Catalog      *catalog.Catalog    `json:"-"`
	Edges        []Edge              `json:"edges"`
	Tags         map[string][]string `json:"tags"`
	Architecture *Architecture       `json:"architecture"`
	Problems     []Problem           `json:"problems"`
	ByID         map[string]*Doc     `json:"-"`
}

var adrFile = regexp.MustCompile(`^(\d{1,6})-([\w.-]+)\.md$`)

func mentionsIn(body string, cfg *config.Config, self string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(n string) {
		id := RefID(n, cfg.Digits)
		if id != "" && id != self && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	for _, m := range regexp.MustCompile(`(?i)\b`+regexp.QuoteMeta(cfg.Prefix)+`[-\s]?(\d{1,6})\b`).FindAllStringSubmatch(body, -1) {
		add(m[1])
	}
	for _, m := range regexp.MustCompile(`\]\((?:[^)]*/)?(\d{1,6})-[\w.-]+\.(?:md|html)\)`).FindAllStringSubmatch(body, -1) {
		add(m[1])
	}
	if out == nil {
		out = []string{}
	}
	return out
}

func lower(xs []string) []string {
	out := make([]string, 0, len(xs))
	for _, x := range xs {
		out = append(out, strings.ToLower(x))
	}
	return out
}

func sections(panels []Panel) []Section {
	out := make([]Section, 0, len(panels))
	for _, p := range panels {
		out = append(out, Section{p.ID, p.Title})
	}
	return out
}

// ReadDoc parses one markdown file. isADR decides the id scheme (number from the file name).
func ReadDoc(path string, cfg *config.Config, isADR bool) (*Doc, error) {
	d, body, err := readBase(path, cfg)
	if err != nil {
		return nil, err
	}
	if isADR {
		m := adrFile.FindStringSubmatch(filepath.Base(path))
		fillADR(d, body, cfg, atoi(m[1]), m[2])
	} else {
		fillDoc(d, body, cfg)
	}
	return d, nil
}

// ReadCrux parses a file with a "crux: <kind>" header: an ADR, a doc, or an element.
func ReadCrux(path string, cfg *config.Config, cat *catalog.Catalog) (*Doc, error) {
	d, body, err := readBase(path, cfg)
	if err != nil {
		return nil, err
	}
	kind, known := NormKind(Str(d.Meta["crux"]))
	switch kind {
	case "adr":
		num := 0
		slug := ""
		if m := adrFile.FindStringSubmatch(filepath.Base(path)); m != nil {
			num, slug = atoi(m[1]), m[2]
		}
		if x := Str(d.Meta["id"]); x != "" && RefID(x, cfg.Digits) != "" {
			num = atoi(RefID(x, cfg.Digits))
		}
		if num == 0 {
			return nil, fmt.Errorf("crux: adr needs a number: id: 12, or a file name like 0012-title.md")
		}
		if slug == "" {
			slug = Slug(firstNonEmpty(Str(d.Meta["title"]), h1(body)))
		}
		fillADR(d, body, cfg, num, slug)
	case "doc":
		fillDoc(d, body, cfg)
		if id := Str(d.Meta["id"]); id != "" {
			d.ID = id
		}
	default:
		readElement(d, kind, body, cfg, cat)
		if !known {
			d.Unknown = true
		}
	}
	return d, nil
}

func readBase(path string, cfg *config.Config) (*Doc, string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	st, _ := os.Stat(path)
	src := string(data)
	meta, body, _ := SplitFrontmatter(src)
	_, panels := Panels(body)
	d := &Doc{
		File: cfg.Rel(path), Mtime: st.ModTime().UnixMilli(), Meta: meta, Source: src,
		Subtitle: Str(meta["subtitle"]), Author: Str(firstOf(meta["author"], meta["authors"])), Owner: Str(meta["owner"]), Due: Str(meta["due"]),
		Reopen: orEmpty(AsList(meta["reopen_when"])), Applies: orEmpty(AsList(meta["applies_to"])),
		Tags: lower(AsList(meta["tags"])), Components: orEmpty(AsList(firstOf(meta["components"], meta["component"]))),
		Rel: map[string][]string{}, Facts: ExtractFacts(panels), Sections: sections(panels), Text: PlainText(body), Date: Str(meta["date"]),
	}
	return d, body, nil
}

func fillADR(d *Doc, body string, cfg *config.Config, num int, slug string) {
	meta := d.Meta
	d.Kind, d.Num, d.Slug = "adr", num, slug
	d.ID = fmt.Sprintf("%0*d", cfg.Digits, num)
	d.Status = Str(meta["status"])
	if d.Status == "" {
		d.Status = "Proposed"
	}
	d.StatusKey = StatusKey(d.Status)
	title := Str(meta["title"])
	if title == "" && Str(meta["crux"]) != "" {
		title = h1(body)
	}
	if title == "" {
		title = strings.ReplaceAll(d.Slug, "-", " ")
	}
	d.Title = regexp.MustCompile(`(?i)^\s*`+regexp.QuoteMeta(cfg.Prefix)+`[-\s]?0*`+strconv.Itoa(d.Num)+`\s*[—–:-]\s*`).ReplaceAllString(title, "")
	for k, v := range meta {
		key := strings.ToLower(k)
		if a, ok := relAliases[key]; ok {
			key = a
		}
		if _, ok := Relations[key]; ok && key != "mentions" {
			var ids []string
			for _, x := range AsList(v) {
				if id := RefID(x, cfg.Digits); id != "" {
					ids = append(ids, id)
				}
			}
			d.Rel[key] = ids
		}
	}
	if m := regexp.MustCompile(`(?i)superseded\s+by\s+(?:\w+-)?(\d+)`).FindStringSubmatch(d.Status); m != nil {
		d.Rel["superseded_by"] = uniq(append(d.Rel["superseded_by"], RefID(m[1], cfg.Digits)))
	}
	d.Mentions = mentionsIn(body, cfg, d.ID)
	for _, m := range wikiRe.FindAllStringSubmatch(body, -1) {
		d.Wiki = append(d.Wiki, strings.TrimSpace(m[1]))
	}
}

func fillDoc(d *Doc, body string, cfg *config.Config) {
	meta := d.Meta
	d.Kind, d.ID = "doc", "doc:"+d.File
	d.Title = Str(meta["title"])
	if d.Title == "" {
		if t := h1(body); t != "" {
			d.Title = t
		} else {
			d.Title = strings.TrimSuffix(filepath.Base(d.File), ".md")
		}
	}
	d.Status = Str(meta["status"])
	d.StatusKey = "doc"
	if d.Status != "" {
		d.StatusKey = StatusKey(d.Status)
	}
	d.Mentions = mentionsIn(body, cfg, "")
	for _, m := range wikiRe.FindAllStringSubmatch(body, -1) {
		d.Wiki = append(d.Wiki, strings.TrimSpace(m[1]))
	}
}

// LoadCatalog reads the built-in catalog plus the project's extensions.
func LoadCatalog(cfg *config.Config) (*catalog.Catalog, error) {
	return catalog.Load(cfg.Abs(cfg.Catalog))
}

// Load reads every ADR, doc and crux file, then builds edges, tags, the element graph and the
// architecture map.
func Load(cfg *config.Config) *Store {
	s := &Store{Tags: map[string][]string{}, ByID: map[string]*Doc{}, Problems: []Problem{}, Adrs: []*Doc{}, Docs: []*Doc{}, Elements: []*Doc{}, Links: []Link{}, Edges: []Edge{}}
	cat, err := LoadCatalog(cfg)
	if err != nil {
		s.Problems = append(s.Problems, Problem{File: cfg.Catalog, Message: "catalog: " + err.Error()})
		cat = catalog.Builtin()
	}
	s.Catalog = cat
	loaded := map[string]bool{}
	adrDir := cfg.Abs(cfg.Dir)
	entries, _ := os.ReadDir(adrDir)
	for _, e := range entries {
		if e.IsDir() || !adrFile.MatchString(e.Name()) {
			continue
		}
		p := filepath.Join(adrDir, e.Name())
		loaded[p] = true
		var d *Doc
		var err error
		if !cfg.Scan.Off && HasCruxHeader(p) {
			d, err = ReadCrux(p, cfg, cat)
		} else {
			d, err = ReadDoc(p, cfg, true)
		}
		if err != nil {
			s.Problems = append(s.Problems, Problem{File: cfg.Rel(p), Message: err.Error()})
			continue
		}
		s.add(d)
	}
	for _, dir := range cfg.Docs {
		_ = filepath.WalkDir(cfg.Abs(dir), func(p string, e os.DirEntry, err error) error {
			if err != nil || e.IsDir() && strings.HasPrefix(e.Name(), ".") && p != cfg.Abs(dir) {
				if e != nil && e.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if e.IsDir() || !strings.HasSuffix(p, ".md") || loaded[p] {
				return nil
			}
			if !cfg.Scan.Off && HasCruxHeader(p) {
				return nil // the header scan reads it
			}
			loaded[p] = true
			if d, err := ReadDoc(p, cfg, false); err == nil {
				s.Docs = append(s.Docs, d)
			}
			return nil
		})
	}
	if !cfg.Scan.Off {
		WalkProject(cfg, LoadIgnore(cfg), func(abs, rel string, e os.DirEntry) {
			if loaded[abs] || !strings.HasSuffix(strings.ToLower(abs), ".md") || !HasCruxHeader(abs) {
				return
			}
			loaded[abs] = true
			d, err := ReadCrux(abs, cfg, cat)
			if err != nil {
				s.Problems = append(s.Problems, Problem{File: rel, Message: err.Error()})
				return
			}
			s.add(d)
		})
	}
	sort.Slice(s.Adrs, func(i, j int) bool { return s.Adrs[i].Num < s.Adrs[j].Num })
	sort.SliceStable(s.Elements, func(i, j int) bool {
		a, b := s.Elements[i], s.Elements[j]
		if ra, rb := kindOrder(a.Kind), kindOrder(b.Kind); ra != rb {
			return ra < rb
		}
		return a.File < b.File
	})
	all := append(append(append([]*Doc{}, s.Adrs...), s.Docs...), s.Elements...)
	for _, d := range all {
		if prev := s.ByID[d.ID]; prev != nil {
			s.Problems = append(s.Problems, Problem{File: d.File, Message: fmt.Sprintf("duplicate id %q (also %s); set a distinct id:", d.ID, prev.File)})
			continue
		}
		s.ByID[d.ID] = d
		if d.Unknown {
			s.Problems = append(s.Problems, Problem{File: d.File, Message: fmt.Sprintf("crux: %q is not a known kind (%s)", Str(d.Meta["crux"]), strings.Join(Kinds, ", ")), Level: "warn"})
		}
	}
	for _, a := range s.Adrs {
		for typ, ids := range a.Rel {
			for _, t := range ids {
				if s.ByID[t] == nil {
					s.Problems = append(s.Problems, Problem{File: a.File, Message: fmt.Sprintf("%s: %s-%s does not exist", typ, cfg.Prefix, t)})
				}
			}
		}
		for _, t := range a.Mentions {
			if s.ByID[t] == nil {
				s.Problems = append(s.Problems, Problem{File: a.File, Message: fmt.Sprintf("mentions %s-%s, which does not exist", cfg.Prefix, t)})
			}
		}
		if _, ok := cfg.Statuses[a.StatusKey]; !ok {
			s.Problems = append(s.Problems, Problem{File: a.File, Message: fmt.Sprintf("unknown status %q", a.Status)})
		}
	}
	linkElements(s, cfg, cat)
	all = append(append(append([]*Doc{}, s.Adrs...), s.Docs...), s.Elements...)
	s.buildEdges(all)
	s.Architecture = loadArchitecture(cfg, s)
	s.Architecture = mergeElements(s.Architecture, s, cfg)
	if s.Architecture != nil {
		s.Architecture.computeDeep()
	}
	for _, d := range all {
		for _, t := range d.Tags {
			s.Tags[t] = append(s.Tags[t], d.ID)
		}
	}
	if s.Architecture != nil {
		for _, n := range s.Architecture.Nodes {
			for _, t := range n.Tags {
				if _, ok := s.Tags[t]; !ok {
					s.Tags[t] = []string{}
				}
			}
		}
	}
	return s
}

func (s *Store) add(d *Doc) {
	switch d.Kind {
	case "adr":
		s.Adrs = append(s.Adrs, d)
	case "doc":
		s.Docs = append(s.Docs, d)
	default:
		s.Elements = append(s.Elements, d)
	}
}

func kindOrder(k string) int {
	for i, x := range Kinds {
		if x == k {
			return i
		}
	}
	return len(Kinds)
}

func (s *Store) buildEdges(all []*Doc) {
	seen := map[string]bool{}
	pair := func(a, b string) string {
		if a > b {
			a, b = b, a
		}
		return a + "|" + b
	}
	types := []string{"supersedes", "superseded_by", "depends_on", "amends", "relates"}
	for _, a := range s.Adrs {
		for _, typ := range types {
			for _, t := range a.Rel[typ] {
				if s.ByID[t] == nil {
					continue
				}
				from, to, kind := a.ID, t, typ
				if typ == "superseded_by" {
					from, to, kind = t, a.ID, "supersedes"
				}
				k := from + ">" + to + ">" + kind
				if seen[k] || (kind == "relates" && seen[to+">"+from+">relates"]) {
					continue
				}
				seen[k], seen[pair(from, to)] = true, true
				s.Edges = append(s.Edges, Edge{from, to, kind})
			}
		}
	}
	for _, d := range all {
		for _, t := range d.Mentions {
			if s.ByID[t] == nil || seen[pair(d.ID, t)] {
				continue
			}
			seen[pair(d.ID, t)] = true
			s.Edges = append(s.Edges, Edge{d.ID, t, "mentions"})
		}
	}
}

// ── architecture.yaml ─────────────────────────────────────────────

var edgeRe = regexp.MustCompile(`^\s*(.+?)\s*(<->|-->|->)\s*(.+?)\s*(?::\s*(.*))?$`)

func parseEdge(v any) *ArchEdge {
	if m, ok := v.(map[string]any); ok {
		if _, has := m["from"]; has {
			e := &ArchEdge{From: Str(m["from"]), To: Str(m["to"]), Label: Str(m["label"]), Dashed: m["dashed"] == true, Both: m["both"] == true, Sel: m["sel"] == true}
			if f, ok := m["lp"].(float64); ok {
				e.Lp = &f
			}
			if lo, ok := m["lo"].([]any); ok && len(lo) == 2 {
				e.Lo = []float64{num(lo[0]), num(lo[1])}
			}
			return e
		}
		// YAML reads "- a -> b: label" as {"a -> b": "label"}
		for k, val := range m {
			if val == nil {
				v = k
			} else {
				v = k + ": " + Str(val)
			}
		}
	}
	m := edgeRe.FindStringSubmatch(Str(v))
	if m == nil {
		return nil
	}
	return &ArchEdge{From: m[1], To: m[3], Label: m[4], Dashed: m[2] == "-->", Both: m[2] == "<->"}
}

func loadArchitecture(cfg *config.Config, s *Store) *Architecture {
	data, err := os.ReadFile(cfg.Abs(cfg.Architecture))
	if err != nil {
		return nil
	}
	var raw map[string]any
	if err := yaml.Unmarshal(data, &raw); err != nil {
		s.Problems = append(s.Problems, Problem{File: cfg.Architecture, Message: "architecture: " + err.Error()})
		return nil
	}
	a := &Architecture{Title: Str(raw["title"]), Desc: Str(raw["desc"]), Lines: strings.ToLower(Str(raw["lines"])), Nodes: map[string]*Node{}, Roots: []string{}, Edges: []ArchEdge{}, Groups: groups(raw["groups"])}
	if a.Title == "" {
		a.Title = "Architecture"
	}
	var visit func(list any, parent *string)
	visit = func(list any, parent *string) {
		items, _ := list.([]any)
		for _, it := range items {
			n, _ := it.(map[string]any)
			id := Str(n["id"])
			if id == "" {
				s.Problems = append(s.Problems, Problem{File: cfg.Architecture, Message: "node without id"})
				continue
			}
			node := &Node{ID: id, Label: Str(firstOf(n["label"], id)), Kind: Str(firstOf(n["kind"], "component")), Tech: strings.ToLower(Str(n["tech"])), Lines: strings.ToLower(Str(n["lines"])), Sub: Str(n["sub"]), Desc: Str(n["desc"]),
				Tags: lower(AsList(n["tags"])), Parent: parent, Docs: orEmpty(AsList(n["docs"])), Paths: orEmpty(AsList(n["paths"])), Groups: groups(n["groups"]), Children: []string{}}
			for _, x := range AsList(n["adrs"]) {
				node.Adrs = append(node.Adrs, RefID(x, cfg.Digits))
			}
			if node.Adrs == nil {
				node.Adrs = []string{}
			}
			for _, k := range []struct {
				dst **float64
				key string
			}{{&node.X, "x"}, {&node.Y, "y"}, {&node.W, "w"}, {&node.H, "h"}} {
				if v, ok := n[k.key]; ok {
					f := num(v)
					*k.dst = &f
				}
			}
			if t := Str(n["tag"]); t != "" {
				node.Tag = &t
			}
			if at, ok := n["at"].([]any); ok && len(at) == 2 {
				node.At = []int{int(num(at[0])), int(num(at[1]))}
			}
			kids, _ := n["children"].([]any)
			for _, c := range kids {
				if cm, ok := c.(map[string]any); ok {
					node.Children = append(node.Children, Str(cm["id"]))
				}
			}
			a.Nodes[id] = node
			a.order = append(a.order, id)
			if parent == nil {
				a.Roots = append(a.Roots, id)
			}
			edges, _ := n["edges"].([]any)
			for _, e := range edges {
				if pe := parseEdge(e); pe != nil {
					a.Edges = append(a.Edges, *pe)
				}
			}
			pid := id
			visit(n["children"], &pid)
		}
	}
	visit(raw["nodes"], nil)
	edges, _ := raw["edges"].([]any)
	for _, e := range edges {
		if pe := parseEdge(e); pe != nil {
			a.Edges = append(a.Edges, *pe)
		}
	}
	for _, e := range a.Edges {
		for _, end := range []string{e.From, e.To} {
			if a.Nodes[end] == nil {
				s.Problems = append(s.Problems, Problem{File: cfg.Architecture, Message: fmt.Sprintf("edge references unknown node %q", end)})
			}
		}
	}
	// link both ways: node.adrs in YAML and adr.components in frontmatter
	for _, d := range s.Adrs {
		for _, c := range d.Components {
			n := a.Nodes[c]
			if n == nil {
				if s.ByID[c] == nil && newResolver(s.Elements).find(c) == nil {
					s.Problems = append(s.Problems, Problem{File: d.File, Message: fmt.Sprintf("component %q is not in %s or any crux file", c, cfg.Architecture)})
				}
				continue
			}
			if !contains(n.Adrs, d.ID) {
				n.Adrs = append(n.Adrs, d.ID)
			}
		}
	}
	for _, nid := range a.order {
		n := a.Nodes[nid]
		for _, id := range n.Adrs {
			if d := s.ByID[id]; d != nil && !contains(d.Components, n.ID) {
				d.Components = append(d.Components, n.ID)
			}
		}
	}
	return a
}

// computeDeep sets each node's decisions including its whole subtree.
func (a *Architecture) computeDeep() {
	for _, n := range a.Nodes {
		n.Deep = nil
	}
	var deep func(id string, seen map[string]bool) []string
	deep = func(id string, seen map[string]bool) []string {
		n := a.Nodes[id]
		if n.Deep != nil {
			return n.Deep
		}
		if seen[id] {
			return nil
		}
		seen[id] = true
		out := append([]string{}, n.Adrs...)
		for _, c := range n.Children {
			if a.Nodes[c] != nil {
				out = append(out, deep(c, seen)...)
			}
		}
		n.Deep = uniq(out)
		return n.Deep
	}
	for id := range a.Nodes {
		deep(id, map[string]bool{})
	}
}

func groups(v any) []Group {
	out := []Group{}
	list, _ := v.([]any)
	for _, g := range list {
		m, _ := g.(map[string]any)
		out = append(out, Group{Label: Str(m["label"]), Nodes: orEmpty(AsList(m["nodes"]))})
	}
	return out
}

func NextNumber(s *Store) int {
	n := 0
	for _, a := range s.Adrs {
		n = max(n, a.Num)
	}
	return n + 1
}

// ── small helpers ─────────────────────────────────────────────────

func firstOf(v ...any) any {
	for _, x := range v {
		if x != nil && Str(x) != "" {
			return x
		}
	}
	return nil
}

func orEmpty(xs []string) []string {
	if xs == nil {
		return []string{}
	}
	return xs
}

func uniq(xs []string) []string {
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

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

func num(v any) float64 {
	switch x := v.(type) {
	case int:
		return float64(x)
	case float64:
		return x
	}
	f, _ := strconv.ParseFloat(Str(v), 64)
	return f
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
