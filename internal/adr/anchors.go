package adr

import (
	"github.com/abtinokhovat/crux/internal/code"
	"github.com/abtinokhovat/crux/internal/config"
)

// AnchorUse is one code anchor written in a crux file, resolved against the code.
type AnchorUse struct {
	code.Anchor
	Element string `json:"element"`         // the element that wrote it
	Where   string `json:"where,omitempty"` // "" (the element) · step:<id> · branch:<step> · <edge type>:<target>
	Doc     string `json:"doc"`             // the crux file
	DocLine int    `json:"docLine,omitempty"`
	Scanned bool   `json:"scanned,omitempty"` // found by crux in the code, not written in a crux file
}

// resolveAnchors resolves every at: and " @ " anchor and lists them on the store. Steps,
// branches and links get their resolved file:line back.
func resolveAnchors(s *Store, cfg *config.Config) {
	r := code.NewResolver(cfg.Root)
	s.Anchors = []AnchorUse{}
	add := func(d *Doc, ref, where string, line int) code.Anchor {
		a := r.Resolve(ref)
		s.Anchors = append(s.Anchors, AnchorUse{Anchor: a, Element: d.ID, Where: where, Doc: d.File, DocLine: line})
		return a
	}
	for _, d := range s.Elements {
		for _, ref := range d.At {
			add(d, ref, "", 0)
		}
		for i := range d.Steps {
			st := &d.Steps[i]
			if st.At != "" {
				add(d, st.At, "step:"+st.ID, st.Line)
			}
			for _, b := range st.Branches {
				if b.At != "" {
					add(d, b.At, "branch:"+st.ID, st.Line)
				}
			}
		}
	}
	for _, l := range s.Links {
		if l.At != "" && l.Source != "scan" {
			if d := s.ByID[l.From]; d != nil {
				add(d, l.At, l.Type+":"+l.To, 0)
			}
		}
	}
}
