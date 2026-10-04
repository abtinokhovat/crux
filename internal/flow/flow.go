// Package flow is the decision flow on disk: capture a draft, keep links both ways, fold team
// notes in, finalize, and answer "which decisions apply here?" for agents.
package flow

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/abtinokhovat/crux/internal/adr"
	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/edit"
)

//go:embed templates
var Templates embed.FS

func Template(name string) string {
	b, _ := Templates.ReadFile("templates/" + name)
	return string(b)
}

func today() string { return time.Now().Format("2006-01-02") }

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func Slugify(s string) string {
	s = strings.Trim(slugRe.ReplaceAllString(strings.ToLower(s), "-"), "-")
	if len(s) > 60 {
		s = strings.Trim(s[:60], "-")
	}
	if s == "" {
		return "question"
	}
	return s
}

var (
	whichRe  = regexp.MustCompile(`(?i)^(?:which|what)\s+(.+?)\s+(?:do|does|should|will|can|to)\s+(?:we|i|you|they)?\s*(?:use|pick|choose|run|adopt|need|want)?\s*(.*)$`)
	shouldRe = regexp.MustCompile(`(?i)^(?:should|do|does|can|how do|how should)\s+(?:we|i|you)\s+`)
	spaces   = regexp.MustCompile(`\s+`)
)

// TitleFromQuestion: "Which broker do we use for v1?" → "Broker for v1".
func TitleFromQuestion(q string) string {
	t := strings.TrimRight(strings.TrimSpace(q), "? ")
	if m := whichRe.FindStringSubmatch(t); m != nil {
		t = m[1] + " " + m[2]
	} else {
		t = shouldRe.ReplaceAllString(t, "")
	}
	t = strings.TrimSpace(spaces.ReplaceAllString(t, " "))
	if t != "" {
		t = strings.ToUpper(t[:1]) + t[1:]
	}
	if len(t) > 70 {
		t = t[:70]
	}
	return t
}

type Draft struct {
	ID   string `json:"id"`
	File string `json:"file"`
}

// CreateDraft writes a private Draft ADR with the question and rough notes.
func CreateDraft(cfg *config.Config, s *adr.Store, question, notes, due, owner string) (Draft, error) {
	question = strings.TrimSpace(question)
	if question == "" {
		return Draft{}, fmt.Errorf("a question is required")
	}
	id := fmt.Sprintf("%0*d", cfg.Digits, adr.NextNumber(s))
	title := TitleFromQuestion(question)
	path := filepath.Join(cfg.Abs(cfg.Dir), id+"-"+Slugify(title)+".md")
	var lines []string
	for _, l := range strings.Split(strings.TrimSpace(notes), "\n") {
		if l = strings.TrimRight(l, " \r"); strings.TrimSpace(l) == "" {
			continue
		} else if !regexp.MustCompile(`^\s*[-*]`).MatchString(l) {
			l = "- " + l
		}
		lines = append(lines, l)
	}
	if len(lines) == 0 {
		lines = []string{"- (none yet)"}
	}
	if owner == "" {
		owner = cfg.Me
	}
	vars := map[string]string{"prefix": cfg.Prefix, "id": id, "title": title, "question": question, "date": today(), "due": due, "owner": owner, "notes": strings.Join(lines, "\n")}
	body := regexp.MustCompile(`\{\{(\w+)\}\}`).ReplaceAllStringFunc(Template("adr-draft.md"), func(m string) string {
		if v, ok := vars[m[2:len(m)-2]]; ok {
			return v
		}
		return m
	})
	if due == "" {
		body = edit.SetFrontmatter(body, edit.Patch{{Key: "due", Value: nil}})
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return Draft{}, err
	}
	if _, err := os.Stat(path); err == nil {
		return Draft{}, fmt.Errorf("%s exists", cfg.Rel(path))
	}
	return Draft{ID: id, File: cfg.Rel(path)}, edit.Write(path, body)
}

var inverse = map[string]string{"relates": "relates", "supersedes": "superseded_by", "superseded_by": "supersedes", "amends": "", "depends_on": ""}

func LinkTypes() []string {
	return []string{"relates", "supersedes", "superseded_by", "depends_on", "amends"}
}

// Link writes a → b, and the other side where the relation has one.
func Link(cfg *config.Config, s *adr.Store, a, rel, b string) ([]string, error) {
	rel = strings.ReplaceAll(rel, "-", "_")
	if _, ok := inverse[rel]; !ok {
		return nil, fmt.Errorf("relation must be one of: %s", strings.Join(LinkTypes(), ", "))
	}
	A, B := s.ByID[adr.RefID(a, cfg.Digits)], s.ByID[adr.RefID(b, cfg.Digits)]
	if A == nil || B == nil {
		bad := a
		if A != nil {
			bad = b
		}
		return nil, fmt.Errorf("unknown ADR: %s", bad)
	}
	var changed []string
	add := func(d *adr.Doc, key, id string) error {
		path := cfg.Abs(d.File)
		text, err := edit.Read(path)
		if err != nil {
			return err
		}
		var cur []string
		for _, x := range adr.AsList(edit.Frontmatter(text)[key]) {
			cur = append(cur, adr.RefID(x, cfg.Digits))
		}
		for _, x := range cur {
			if x == id {
				return nil
			}
		}
		patch := edit.Patch{{Key: key, Value: append(cur, id)}}
		if key == "superseded_by" {
			patch = append(patch, edit.KV{Key: "status", Value: "Superseded by " + id})
		}
		changed = append(changed, d.File)
		return edit.Write(path, edit.SetFrontmatter(text, patch))
	}
	if err := add(A, rel, B.ID); err != nil {
		return nil, err
	}
	if inv := inverse[rel]; inv != "" {
		if err := add(B, inv, A.ID); err != nil {
			return nil, err
		}
	}
	return changed, nil
}

type Note struct {
	ID   string
	By   string
	Text string
	At   string
	Tag  string
}

// ImportNotes adds team notes to "## Notes", tagged, without duplicates.
func ImportNotes(cfg *config.Config, d *adr.Doc, notes []Note) (int, error) {
	path := cfg.Abs(d.File)
	text, err := edit.Read(path)
	if err != nil {
		return 0, err
	}
	existing, _ := edit.PanelBody(text, "Notes")
	var add []string
	for _, n := range notes {
		body := spaces.ReplaceAllString(strings.TrimSpace(n.Text), " ")
		if strings.Contains(existing, body) {
			continue
		}
		line := "- "
		if n.Tag != "" {
			line += "**" + n.Tag + "** · "
		}
		line += body + " — @" + n.By
		if len(n.At) >= 16 {
			line += " (" + strings.Replace(n.At[:16], "T", " ", 1) + ")"
		}
		add = append(add, line)
	}
	if len(add) == 0 {
		return 0, nil
	}
	if regexp.MustCompile(`(?m)^- \(none yet\)$`).MatchString(existing) {
		text = edit.SetPanel(text, "Notes", "", edit.Where{})
	}
	return len(add), edit.Write(path, edit.AppendToPanel(text, "Notes", add, edit.Where{After: "Question"}))
}

type Dissent struct{ By, Opt, Why string }

var firstHead = regexp.MustCompile(`(?m)^##\s+(.+?)\s*(\{[^{}]*\})?\s*$`)

// Finalize writes the decision callout on top, verdicts, dissent and status Accepted.
func Finalize(cfg *config.Config, d *adr.Doc, option, decision string, dissent []Dissent, reopen []string) error {
	path := cfg.Abs(d.File)
	text, err := edit.Read(path)
	if err != nil {
		return err
	}
	if option != "" {
		text = edit.SetVerdicts(text, option)
	}
	if strings.TrimSpace(decision) == "" {
		decision = "Chose option " + option + "."
	}
	callout := "```callout ok Decision\n" + strings.TrimSpace(decision) + "\n```"
	where := edit.Where{}
	if m := firstHead.FindStringSubmatch(text); m != nil && !strings.EqualFold(m[1], "decision") {
		where.Before = m[1]
	}
	text = edit.SetPanel(text, "Decision", callout, where)
	if len(dissent) > 0 {
		var lines []string
		for _, x := range dissent {
			l := "- @" + x.By + " prefers " + x.Opt
			if x.Why != "" {
				l += ": " + x.Why
			}
			lines = append(lines, l)
		}
		text = edit.SetPanel(text, "Dissent", strings.Join(lines, "\n"), edit.Where{After: "Decision"})
	}
	fm := edit.Frontmatter(text)
	patch := edit.Patch{{Key: "status", Value: "Accepted"}, {Key: "decided", Value: today()}}
	if o := adr.Str(fm["owner"]); o != "" {
		patch = append(patch, edit.KV{Key: "deciders", Value: []string{o}})
	}
	if len(reopen) > 0 {
		patch = append(patch, edit.KV{Key: "reopen_when", Value: reopen})
	}
	return edit.Write(path, edit.SetFrontmatter(text, patch))
}

func SetStatus(cfg *config.Config, d *adr.Doc, status string) error {
	path := cfg.Abs(d.File)
	text, err := edit.Read(path)
	if err != nil {
		return err
	}
	return edit.Write(path, edit.SetFrontmatter(text, edit.Patch{{Key: "status", Value: status}}))
}

// ── context for agents ────────────────────────────────────────────

type Rejected struct {
	Name string `json:"name"`
	Why  string `json:"why"`
}

type Decision struct {
	ID         string     `json:"id"`
	Title      string     `json:"title"`
	Status     string     `json:"status"`
	Binding    bool       `json:"binding"`
	Decision   *string    `json:"decision"`
	Question   *string    `json:"question"`
	Leaning    *string    `json:"leaning"`
	Chosen     []string   `json:"chosen"`
	Rejected   []Rejected `json:"rejected"`
	ReopenWhen []string   `json:"reopen_when"`
	AppliesTo  []string   `json:"applies_to"`
	Components []string   `json:"components"`
	Links      []string   `json:"links"`
	File       string     `json:"file"`
	Matched    []string   `json:"matched"`
}

func globRe(g string) *regexp.Regexp {
	q := regexp.QuoteMeta(g)
	q = strings.ReplaceAll(q, `\*\*/`, "\x00")
	q = strings.ReplaceAll(q, `\*\*`, "\x00")
	q = strings.ReplaceAll(q, `\*`, "[^/]*")
	q = strings.ReplaceAll(q, "\x00", ".*")
	return regexp.MustCompile("^" + q)
}

func globPrefix(g string) string {
	if i := strings.Index(g, "*"); i >= 0 {
		return g[:i]
	}
	return g
}

// Context lists decisions matching paths (applies_to / component paths) and topic words.
func Context(cfg *config.Config, s *adr.Store, inputs []string) []Decision {
	var paths, terms []string
	for _, x := range inputs {
		if strings.ContainsAny(x, "/.") {
			paths = append(paths, strings.TrimPrefix(x, "./"))
		} else {
			terms = append(terms, strings.ToLower(x))
		}
	}
	var nodes map[string]*adr.Node
	if s.Architecture != nil {
		nodes = s.Architecture.Nodes
	}
	type hit struct {
		d   *adr.Doc
		why []string
	}
	var hits []hit
	for _, d := range s.Adrs {
		globs := append([]string{}, d.Applies...)
		for _, c := range d.Components {
			if n := nodes[c]; n != nil {
				globs = append(globs, n.Paths...)
			}
		}
		var why []string
		for _, p := range paths {
			for _, g := range globs {
				if globRe(g).MatchString(p) || strings.HasPrefix(p, globPrefix(g)) || strings.HasPrefix(globPrefix(g), p) {
					why = append(why, "path "+p+" ~ "+g)
					break
				}
			}
		}
		for _, t := range terms {
			switch {
			case contains(d.Tags, t):
				why = append(why, "tag "+t)
			case componentMatch(d.Components, nodes, t):
				why = append(why, "component "+t)
			case strings.Contains(strings.ToLower(d.Title), t):
				why = append(why, "title "+t)
			}
		}
		if len(inputs) == 0 || len(why) > 0 {
			hits = append(hits, hit{d, why})
		}
	}
	rank := map[string]int{"accepted": 0, "review": 1, "proposed": 2, "open": 3, "draft": 4}
	r := func(k string) int {
		if v, ok := rank[k]; ok {
			return v
		}
		return 5
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if r(hits[i].d.StatusKey) != r(hits[j].d.StatusKey) {
			return r(hits[i].d.StatusKey) < r(hits[j].d.StatusKey)
		}
		return len(hits[i].why) > len(hits[j].why)
	})
	out := []Decision{}
	for _, h := range hits {
		d := h.d
		x := Decision{ID: d.ID, Title: d.Title, Status: d.Status, Binding: d.StatusKey == "accepted", ReopenWhen: d.Reopen, AppliesTo: d.Applies, Components: d.Components, File: d.File, Matched: orEmpty(h.why), Chosen: []string{}, Rejected: []Rejected{}, Links: []string{}}
		if d.Facts.Decision != nil && *d.Facts.Decision != "" {
			x.Decision = d.Facts.Decision
		} else {
			x.Question, x.Leaning = d.Facts.Question, d.Facts.Recommendation
		}
		for _, g := range d.Facts.Options {
			for _, o := range g.Items {
				switch o.Verdict.Kind {
				case "ok":
					x.Chosen = append(x.Chosen, o.Name)
				case "no":
					why := ""
					for _, f := range o.Fields {
						if f.Role == "con" {
							why = f.Text
							break
						}
					}
					x.Rejected = append(x.Rejected, Rejected{o.Name, why})
				}
			}
		}
		for _, e := range s.Edges {
			if e.Type == "mentions" {
				continue
			}
			if e.From == d.ID {
				x.Links = append(x.Links, e.Type+" "+e.To)
			} else if e.To == d.ID && e.Type == "relates" {
				x.Links = append(x.Links, "relates "+e.From) // symmetric
			} else if e.To == d.ID {
				x.Links = append(x.Links, e.Type+"← "+e.From)
			}
		}
		out = append(out, x)
	}
	return out
}

func componentMatch(comps []string, nodes map[string]*adr.Node, t string) bool {
	for _, c := range comps {
		if strings.Contains(strings.ToLower(c), t) {
			return true
		}
		if n := nodes[c]; n != nil && strings.Contains(strings.ToLower(n.Label), t) {
			return true
		}
	}
	return false
}

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

func orEmpty(xs []string) []string {
	if xs == nil {
		return []string{}
	}
	return xs
}
