package adr

import (
	"fmt"
	"regexp"
	"strings"
)

// The domain model: entity fields, the relations crux calculates from them, and where each
// entity lives (its owner, the store it is kept in, its code).

// EntityField is one line of an ```entity block: name, type, then notes.
type EntityField struct {
	Name   string   `json:"name"`
	Type   string   `json:"type,omitempty"`
	Note   string   `json:"note,omitempty"`
	PK     bool     `json:"pk,omitempty"`
	Unique bool     `json:"unique,omitempty"`
	FK     string   `json:"fk,omitempty"`   // fk <entity> as written
	Card   string   `json:"card,omitempty"` // 1..n, 0..1, n..m … as written
	Enum   []string `json:"enum,omitempty"`
	Line   int      `json:"line"`
}

var (
	cardRe = regexp.MustCompile(`\b([01n*]|\d+)\.\.([1nm*]|\d+)\b`)
	fkRe   = regexp.MustCompile(`(?i)\bfk\s+([\w.-]+)`)
	idRe   = regexp.MustCompile(`^(.+?)(?:_id|Id|_ID)$`)
)

// entityText joins every ```entity fence in the body.
func entityText(body string) string {
	intro, panels := Panels(body)
	all := append([]Block{}, intro...)
	for _, p := range panels {
		all = append(all, p.Blocks...)
	}
	var parts []string
	for _, b := range all {
		if b.Type == "fence" && b.Lang == "entity" {
			parts = append(parts, b.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// ParseFields reads entity lines the way the ```entity component draws them.
func ParseFields(text string) []EntityField {
	var out []EntityField
	for i, raw := range strings.Split(text, "\n") {
		t := strings.TrimSpace(raw)
		if t == "" || strings.HasPrefix(t, "//") {
			continue
		}
		parts := strings.Fields(t)
		f := EntityField{Name: parts[0], Line: i + 1}
		if len(parts) > 1 {
			f.Type = parts[1]
		}
		if len(parts) > 2 {
			f.Note = strings.Join(parts[2:], " ")
		}
		low := " " + strings.ToLower(f.Note) + " "
		f.PK = strings.Contains(low, " pk ")
		f.Unique = strings.Contains(low, " unique ")
		if m := fkRe.FindStringSubmatch(f.Note); m != nil {
			f.FK = m[1]
		}
		if m := cardRe.FindString(f.Note); m != "" {
			f.Card = m
		}
		if strings.Contains(f.Note, "|") && f.FK == "" {
			for _, v := range strings.Split(f.Note, "|") {
				if v = strings.TrimSpace(v); v != "" {
					f.Enum = append(f.Enum, v)
				}
			}
		}
		out = append(out, f)
	}
	return out
}

// linkModel calculates entity relations and homes. A cardinality is how many of the target one
// source has: 1..1, 0..1, 1..n, 0..n; n..m on a list is many-to-many.
//
//	fk X            → references X (1..1, or the cardinality written next to it)
//	type X[]        → has X (1..n, or as written; n..m is many-to-many)
//	type X          → references X (1..1)
//	x_id / xId      → references X when X is an entity (calculated from the name)
//	stored_in: S    → kept in store S; without it, the one store its owner writes
func linkModel(s *Store, find func(string) *Doc, addLink func(Link)) {
	entity := func(x string) *Doc {
		if d := find(x); d != nil && d.Kind == "entity" {
			return d
		}
		return nil
	}
	for _, d := range s.Elements {
		if d.Kind != "entity" {
			continue
		}
		for _, f := range d.Fields {
			if f.PK && f.FK == "" {
				continue
			}
			if f.FK != "" {
				to := find(f.FK)
				switch {
				case to == nil:
					s.Problems = append(s.Problems, Problem{File: d.File, Message: fmt.Sprintf("entity %s field %s: fk %q is not a known entity", d.ID, f.Name, f.FK), Level: "warn"})
				case to.Kind != "entity":
					s.Problems = append(s.Problems, Problem{File: d.File, Message: fmt.Sprintf("entity %s field %s: fk %q is a %s, not an entity", d.ID, f.Name, f.FK, to.Kind), Level: "warn"})
				default:
					addLink(Link{From: d.ID, To: to.ID, Type: "references", Label: f.Name, Card: firstNonEmpty(f.Card, "1..1")})
				}
				continue
			}
			if base, many := strings.CutSuffix(f.Type, "[]"); many {
				if to := entity(base); to != nil {
					addLink(Link{From: d.ID, To: to.ID, Type: "has", Label: f.Name, Card: firstNonEmpty(f.Card, "1..n")})
				}
				continue
			}
			if to := entity(f.Type); to != nil {
				addLink(Link{From: d.ID, To: to.ID, Type: "references", Label: f.Name, Card: firstNonEmpty(f.Card, "1..1")})
				continue
			}
			if m := idRe.FindStringSubmatch(f.Name); m != nil {
				if to := entity(m[1]); to != nil && to != d {
					addLink(Link{From: d.ID, To: to.ID, Type: "references", Label: f.Name, Card: firstNonEmpty(f.Card, "1..1"), Implied: true})
				}
			}
		}
	}
	homeEntities(s, addLink)
}

// homeEntities finds the store each entity is kept in: stored_in, else the one store (or, with
// no store, the one cache) its owner — or the owner's nearest container — writes; with no
// writes, the one it reads or depends on.
func homeEntities(s *Store, addLink func(Link)) {
	stored := map[string]string{}
	for _, l := range s.Links {
		if l.Type == "stored_in" {
			stored[l.From] = l.To
		}
	}
	for _, d := range s.Elements {
		if d.Kind != "entity" || d.Store != "" {
			continue
		}
		if st := stored[d.ID]; st != "" {
			d.Store = st
			continue
		}
		for p := s.ByID[d.Parent]; p != nil && d.Store == ""; p = s.ByID[p.Parent] {
			pick := func(types ...string) []string {
				var stores, caches []string
				for _, l := range s.Links {
					if l.From != p.ID || !contains(types, l.Type) {
						continue
					}
					if t := s.ByID[l.To]; t != nil && t.Kind == "store" {
						stores = append(stores, t.ID)
					} else if t != nil && t.Kind == "cache" {
						caches = append(caches, t.ID)
					}
				}
				stores, caches = uniqStrs(stores), uniqStrs(caches)
				if len(stores) == 0 && len(caches) == 1 {
					return caches
				}
				return stores
			}
			stores := pick("writes")
			if len(stores) == 0 {
				stores = pick("reads", "depends_on")
			}
			if len(stores) == 1 {
				d.Store, d.StoreInferred = stores[0], true
				addLink(Link{From: d.ID, To: stores[0], Type: "stored_in", Mode: "data", Implied: true})
			}
			if len(stores) > 0 || p.Kind == "context" || p.Kind == "system" {
				break
			}
		}
	}
}


func uniqStrs(xs []string) []string {
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
