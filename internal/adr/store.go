package adr

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

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
}

type Architecture struct {
	Title  string           `json:"title"`
	Desc   string           `json:"desc"`
	Roots  []string         `json:"roots"`
	Nodes  map[string]*Node `json:"nodes"`
	Edges  []ArchEdge       `json:"edges"`
	Groups []Group          `json:"groups"`
	order  []string
}

type Store struct {
	Adrs         []*Doc              `json:"adrs"`
	Docs         []*Doc              `json:"docs"`
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

// ReadDoc parses one markdown file. isADR decides the id scheme.
func ReadDoc(path string, cfg *config.Config, isADR bool) (*Doc, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
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
	if isADR {
		m := adrFile.FindStringSubmatch(filepath.Base(path))
		d.Kind, d.Num, d.Slug = "adr", atoi(m[1]), m[2]
		d.ID = RefID(m[1], cfg.Digits)
		d.Status = Str(meta["status"])
		if d.Status == "" {
			d.Status = "Proposed"
		}
		d.StatusKey = StatusKey(d.Status)
		title := Str(meta["title"])
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
	} else {
		d.Kind, d.ID = "doc", "doc:"+d.File
		d.Title = Str(meta["title"])
		if d.Title == "" {
			if m := regexp.MustCompile(`(?m)^#\s+(.+)$`).FindStringSubmatch(body); m != nil {
				d.Title = m[1]
			} else {
				d.Title = strings.TrimSuffix(filepath.Base(path), ".md")
			}
		}
		d.Status = Str(meta["status"])
		d.StatusKey = "doc"
		if d.Status != "" {
			d.StatusKey = StatusKey(d.Status)
		}
		d.Mentions = mentionsIn(body, cfg, "")
	}
	return d, nil
}

// Load reads every ADR and doc, then builds edges, tags and the architecture map.
func Load(cfg *config.Config) *Store {
	s := &Store{Tags: map[string][]string{}, ByID: map[string]*Doc{}, Problems: []Problem{}, Adrs: []*Doc{}, Docs: []*Doc{}, Edges: []Edge{}}
	adrDir := cfg.Abs(cfg.Dir)
	entries, _ := os.ReadDir(adrDir)
	for _, e := range entries {
		if e.IsDir() || !adrFile.MatchString(e.Name()) {
			continue
		}
		d, err := ReadDoc(filepath.Join(adrDir, e.Name()), cfg, true)
		if err != nil {
			s.Problems = append(s.Problems, Problem{File: cfg.Rel(filepath.Join(adrDir, e.Name())), Message: err.Error()})
			continue
		}
		s.Adrs = append(s.Adrs, d)
	}
	sort.Slice(s.Adrs, func(i, j int) bool { return s.Adrs[i].Num < s.Adrs[j].Num })
	for _, dir := range cfg.Docs {
		_ = filepath.WalkDir(cfg.Abs(dir), func(p string, e os.DirEntry, err error) error {
			if err != nil || e.IsDir() && strings.HasPrefix(e.Name(), ".") && p != cfg.Abs(dir) {
				if e != nil && e.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if e.IsDir() || !strings.HasSuffix(p, ".md") || (strings.HasPrefix(p, adrDir) && adrFile.MatchString(e.Name())) {
				return nil
			}
			if d, err := ReadDoc(p, cfg, false); err == nil {
				s.Docs = append(s.Docs, d)
			}
			return nil
		})
	}
	all := append(append([]*Doc{}, s.Adrs...), s.Docs...)
	for _, d := range all {
		s.ByID[d.ID] = d
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
	s.buildEdges(all)
	s.Architecture = loadArchitecture(cfg, s)
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
	a := &Architecture{Title: Str(raw["title"]), Desc: Str(raw["desc"]), Nodes: map[string]*Node{}, Roots: []string{}, Edges: []ArchEdge{}, Groups: groups(raw["groups"])}
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
			node := &Node{ID: id, Label: Str(firstOf(n["label"], id)), Kind: Str(firstOf(n["kind"], "component")), Sub: Str(n["sub"]), Desc: Str(n["desc"]),
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
				s.Problems = append(s.Problems, Problem{File: d.File, Message: fmt.Sprintf("component %q is not in %s", c, cfg.Architecture)})
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
	var deep func(id string) []string
	deep = func(id string) []string {
		n := a.Nodes[id]
		if n.Deep != nil {
			return n.Deep
		}
		out := append([]string{}, n.Adrs...)
		for _, c := range n.Children {
			if a.Nodes[c] != nil {
				out = append(out, deep(c)...)
			}
		}
		n.Deep = uniq(out)
		return n.Deep
	}
	for id := range a.Nodes {
		deep(id)
	}
	return a
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
