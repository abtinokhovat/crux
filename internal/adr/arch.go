package adr

import (
	"sort"
	"strings"

	"github.com/abtinokhovat/crux/internal/config"
)

var langLike = map[string]bool{"language": true, "runtime": true, "framework": true, "protocol": true, "observability": true}

// mergeElements adds structural elements to the architecture map as boxes (nested by in:) and
// their connections as edges. A node in architecture.yaml with the same id is enriched instead.
func mergeElements(a *Architecture, s *Store, cfg *config.Config) *Architecture {
	var boxes []*Doc
	isBox := map[string]bool{}
	for _, e := range s.Elements {
		if IsStructural(e.Kind) || (e.Kind == "contract" && (e.Transport == "topic" || e.Transport == "queue") && e.Parent != "" && s.ByID[e.Parent] != nil && IsStructural(s.ByID[e.Parent].Kind)) {
			boxes = append(boxes, e)
			isBox[e.ID] = true
		}
	}
	if len(boxes) == 0 {
		return a
	}
	if a == nil {
		a = &Architecture{Title: "System", Nodes: map[string]*Node{}, Roots: []string{}, Edges: []ArchEdge{}, Groups: []Group{}}
		for _, e := range s.Elements {
			if e.Kind == "system" && e.Parent == "" {
				a.Title, a.Desc = e.Title, e.Subtitle
			}
		}
	}
	// boxes
	for _, e := range boxes {
		kind := e.Kind
		if kind == "contract" {
			kind = "topic"
		}
		// the box color comes from infrastructure tech (postgres, kafka, stripe…); code kinds
		// stay neutral and show their language as an icon
		tech := ""
		if !codeKinds[e.Kind] {
			for _, t := range e.Tech {
				if c := s.Catalog; c == nil || c.Tech[t] == nil || !langLike[c.Tech[t].Category] {
					tech = t
					break
				}
			}
			if tech == "" && len(e.Tech) > 0 {
				tech = e.Tech[0]
			}
		}
		if n := a.Nodes[e.ID]; n != nil {
			n.Doc = e.ID
			if n.Tech == "" {
				n.Tech = tech
			}
			n.Techs = e.Tech
			if n.Sub == "" {
				n.Sub = e.Subtitle
			}
			if len(n.Paths) == 0 {
				n.Paths = e.Code
			}
			n.Origin = e.Origin
			continue
		}
		label := e.Title
		if e.Kind == "contract" {
			label = e.Name
		}
		a.Nodes[e.ID] = &Node{ID: e.ID, Label: label, Kind: kind, Tech: tech, Techs: e.Tech, Sub: e.Subtitle, Tags: e.Tags, Paths: e.Code, Doc: e.ID, Origin: e.Origin,
			Adrs: []string{}, Docs: []string{}, Children: []string{}, Groups: []Group{}}
		a.order = append(a.order, e.ID)
	}
	// nesting: the box's parent, or the nearest ancestor that is a box
	boxParent := func(id string) string {
		for p := s.ByID[id]; p != nil && p.Parent != ""; p = s.ByID[p.Parent] {
			if a.Nodes[p.Parent] != nil {
				return p.Parent
			}
		}
		return ""
	}
	for _, e := range boxes {
		n := a.Nodes[e.ID]
		if n.Doc != e.ID || n.Parent != nil {
			continue // a yaml node keeps its yaml place
		}
		if p := boxParent(e.ID); p != "" {
			pid := p
			n.Parent = &pid
			if !contains(a.Nodes[p].Children, e.ID) {
				a.Nodes[p].Children = append(a.Nodes[p].Children, e.ID)
			}
		} else if !contains(a.Roots, e.ID) {
			a.Roots = append(a.Roots, e.ID)
		}
	}
	// one system at the top: it names the map, and its children are the top level
	if len(a.Roots) == 1 {
		if root := a.Nodes[a.Roots[0]]; root != nil && root.Kind == "system" && len(root.Children) > 0 && len(root.Adrs) == 0 {
			a.Title, a.Desc = root.Label, firstNonEmpty(root.Sub, a.Desc)
			for _, c := range root.Children {
				a.Nodes[c].Parent = nil
			}
			a.Roots = append([]string{}, root.Children...)
			delete(a.Nodes, root.ID)
		}
	}
	// the box an element shows up in: itself, its parent box, or (for endpoints) its provider
	boxOf := func(id string) string {
		if a.Nodes[id] != nil {
			return id
		}
		for p := s.ByID[id]; p != nil; p = s.ByID[p.Parent] {
			if a.Nodes[p.ID] != nil {
				return p.ID
			}
			if p.Parent == "" {
				break
			}
		}
		return ""
	}
	type key struct{ from, to, typ string }
	idx := map[key]int{}
	add := func(from, to string, l Link, label string) {
		if from == "" || to == "" || from == to {
			return
		}
		typ := l.Type
		if typ == "consumes" {
			typ = "publishes"
		}
		if typ == "uses" {
			typ = "calls"
		}
		k := key{from, to, typ}
		if i, ok := idx[k]; ok {
			e := &a.Edges[i]
			if label != "" && !strings.Contains(", "+e.Label+", ", ", "+label+", ") {
				if e.Label == "" {
					e.Label = label
				} else {
					e.Label += ", " + label
				}
			}
			return
		}
		mode := l.Mode
		e := ArchEdge{From: from, To: to, Label: label, Type: typ, Transport: l.Transport, Mode: mode, Via: l.Via, Dashed: mode == "async" || mode == "stream" || l.Type == "depends_on" || l.Type == "runs_on"}
		idx[k] = len(a.Edges)
		a.Edges = append(a.Edges, e)
	}
	for _, l := range s.Links {
		switch l.Type {
		case "calls", "uses", "reads", "writes", "depends_on", "publishes", "consumes", "implements":
		default:
			continue
		}
		label := l.Label
		if label == "" && l.Via != "" {
			if c := s.ByID[l.Via]; c != nil {
				label = c.Name
			}
		}
		from, to := l.From, l.To
		if l.Type == "consumes" {
			from, to = l.To, l.From
		}
		toDoc, fromDoc := s.ByID[to], s.ByID[from]
		// publishes/consumes to a topic box draw through the box; the implied publisher → consumer
		// line is only for topics that have no box
		if l.Implied && l.Via != "" && isBox[l.Via] {
			continue
		}
		if (l.Type == "publishes" && toDoc != nil && toDoc.Kind == "contract" && !isBox[to]) ||
			(l.Type == "consumes" && fromDoc != nil && fromDoc.Kind == "contract" && !isBox[from]) {
			continue
		}
		if l.Type == "uses" && toDoc != nil && toDoc.Kind == "contract" && !isBox[to] {
			continue // the implied client → provider line carries it
		}
		if label == "" && (l.Type == "reads" || l.Type == "writes") {
			label = l.Type
		}
		if l.Type == "depends_on" && label == "" {
			label = "uses"
		}
		if (l.Type == "publishes" || l.Type == "consumes") && isBox[to] || isBox[from] && fromDoc != nil && fromDoc.Kind == "contract" {
			label = "" // the topic box itself names it
		}
		add(boxOf(from), boxOf(to), l, label)
	}
	// decisions on the boxes they are about (elements that are not boxes pass to their box)
	for _, l := range s.Links {
		if l.Type != "decided_by" {
			continue
		}
		b := boxOf(l.From)
		if b == "" {
			continue
		}
		n := a.Nodes[b]
		if !contains(n.Adrs, l.To) {
			n.Adrs = append(n.Adrs, l.To)
		}
		if d := s.ByID[l.To]; d != nil && d.Kind == "adr" && !contains(d.Components, b) {
			d.Components = append(d.Components, b)
		}
	}
	for _, n := range a.Nodes {
		sort.Strings(n.Adrs)
	}
	_ = cfg
	return a
}
