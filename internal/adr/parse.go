// Package adr reads ADR markdown into structured facts and builds the project index.
// Panel and table rules match the browser renderer (web-src/parse.js).
package adr

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

var fmRe = regexp.MustCompile(`(?s)^---\r?\n(.*?)\r?\n---\r?\n?`)

// SplitFrontmatter returns the frontmatter map, the body and the number of lines before the body.
func SplitFrontmatter(src string) (map[string]any, string, int) {
	m := fmRe.FindStringSubmatchIndex(src)
	if m == nil {
		return map[string]any{}, src, 0
	}
	raw := src[m[2]:m[3]]
	meta := map[string]any{}
	if err := yaml.Unmarshal([]byte(raw), &meta); err != nil || meta == nil {
		meta = looseFrontmatter(raw)
	}
	head := src[:m[1]]
	return meta, src[m[1]:], strings.Count(head, "\n")
}

// key: value per line; tolerant of unquoted colons that strict YAML rejects.
func looseFrontmatter(text string) map[string]any {
	meta := map[string]any{}
	listKey := ""
	kv := regexp.MustCompile(`^([\w-]+)\s*:\s*(.*)$`)
	item := regexp.MustCompile(`^\s+-\s+(.*)$`)
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimRight(line, "\r")
		if m := item.FindStringSubmatch(line); m != nil && listKey != "" {
			meta[listKey] = append(meta[listKey].([]any), strings.TrimSpace(m[1]))
			continue
		}
		m := kv.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		key, val := m[1], strings.TrimSpace(m[2])
		if val == "" {
			meta[key] = []any{}
			listKey = key
			continue
		}
		listKey = ""
		if strings.HasPrefix(val, "[") && strings.HasSuffix(val, "]") {
			var list []any
			for _, x := range strings.Split(val[1:len(val)-1], ",") {
				if x = strings.TrimSpace(x); x != "" {
					list = append(list, strings.Trim(x, `"'`))
				}
			}
			meta[key] = list
			continue
		}
		if len(val) > 1 && (val[0] == '"' || val[0] == '\'') && val[len(val)-1] == val[0] {
			val = val[1 : len(val)-1]
		}
		meta[key] = val
	}
	return meta
}

// AsList reads a frontmatter value as a list of strings ("a, b", [a, b] or a).
func AsList(v any) []string {
	var out []string
	switch x := v.(type) {
	case nil:
	case []any:
		for _, e := range x {
			if s := strings.TrimSpace(Str(e)); s != "" {
				out = append(out, s)
			}
		}
	case []string:
		out = append(out, x...)
	default:
		for _, s := range strings.Split(Str(x), ",") {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

// Str turns a YAML scalar into a string (dates and numbers included).
func Str(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case int:
		return strconv.Itoa(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	default:
		if t, ok := v.(interface{ Format(string) string }); ok {
			return t.Format("2006-01-02")
		}
		return fmt.Sprint(v)
	}
}

var digitsRe = regexp.MustCompile(`\d+`)

// RefID normalizes "ADR-4", "0004", 4 → "0004".
func RefID(v any, digits int) string {
	m := digitsRe.FindString(Str(v))
	if m == "" {
		return ""
	}
	n, _ := strconv.Atoi(m)
	return fmt.Sprintf("%0*d", digits, n)
}

func StatusKey(status string) string {
	s := strings.ToLower(strings.TrimSpace(status))
	switch {
	case s == "":
		return "proposed"
	case strings.HasPrefix(s, "superseded"):
		return "superseded"
	case strings.HasPrefix(s, "in review") || s == "review":
		return "review"
	}
	return strings.Fields(s)[0]
}

// ── panels ────────────────────────────────────────────────────────

type Block struct {
	Type string // "md" | "fence"
	Lang string
	Args string
	Text string
}

type Panel struct {
	ID     string
	Title  string
	Attrs  map[string]string
	Blocks []Block
}

var (
	fenceOpen = regexp.MustCompile("^(`{3,}|~{3,})\\s*([^\\s`]*)\\s*(.*)$")
	headingRe = regexp.MustCompile(`^##\s+(.+?)\s*$`)
	attrBlock = regexp.MustCompile(`\s*\{([^{}]*)\}\s*$`)
	attrToken = regexp.MustCompile(`([\w-]+)(?:=("[^"]*"|'[^']*'|\S+))?`)
	panelIDRe = regexp.MustCompile(`^([A-Z][0-9]?)\s+(.+)$`)
)

// Panels splits the body into intro blocks and "## " panels, skipping headings inside fences.
func Panels(body string) ([]Block, []Panel) {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	var intro []Block
	var panels []Panel
	cur := &intro
	var md []string
	flush := func() {
		if strings.TrimSpace(strings.Join(md, "\n")) != "" {
			*cur = append(*cur, Block{Type: "md", Text: strings.Join(md, "\n")})
		}
		md = nil
	}
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if m := fenceOpen.FindStringSubmatch(line); m != nil {
			flush()
			marker := m[1]
			end := -1
			closeRe := regexp.MustCompile("^" + regexp.QuoteMeta(string(marker[0])) + "{" + strconv.Itoa(len(marker)) + ",}\\s*$")
			for j := i + 1; j < len(lines); j++ {
				if closeRe.MatchString(lines[j]) {
					end = j
					break
				}
			}
			if end == -1 {
				end = len(lines)
			}
			text := ""
			if i+1 <= end && i+1 < len(lines) {
				text = strings.Join(lines[i+1:min(end, len(lines))], "\n")
			}
			*cur = append(*cur, Block{Type: "fence", Lang: strings.ToLower(m[2]), Args: strings.TrimSpace(m[3]), Text: text})
			i = end
			continue
		}
		if m := headingRe.FindStringSubmatch(line); m != nil {
			flush()
			p := parseHeading(m[1])
			panels = append(panels, p)
			cur = &panels[len(panels)-1].Blocks
			continue
		}
		md = append(md, line)
	}
	flush()
	assignIDs(panels)
	return intro, panels
}

func parseHeading(text string) Panel {
	p := Panel{Attrs: map[string]string{}}
	if m := attrBlock.FindStringSubmatchIndex(text); m != nil {
		for _, t := range attrToken.FindAllStringSubmatch(text[m[2]:m[3]], -1) {
			v := strings.Trim(t[2], `"'`)
			if t[2] == "" {
				v = "true"
			}
			p.Attrs[t[1]] = v
		}
		text = text[:m[0]]
	}
	if m := panelIDRe.FindStringSubmatch(text); m != nil {
		p.ID, p.Title = m[1], strings.TrimSpace(m[2])
	} else {
		p.Title = strings.TrimSpace(text)
	}
	return p
}

func assignIDs(panels []Panel) {
	used := map[string]bool{}
	for _, p := range panels {
		if p.ID != "" {
			used[p.ID] = true
		}
	}
	code := 'A'
	for i := range panels {
		if panels[i].ID != "" {
			continue
		}
		for used[string(code)] {
			code++
		}
		id := string(code)
		if code > 'Z' {
			id = fmt.Sprintf("P%d", code-64)
		}
		panels[i].ID = id
		used[id] = true
		code++
	}
}

// ── tables and options ────────────────────────────────────────────

type Table struct {
	Head []string
	Rows [][]string
}

var sepRow = regexp.MustCompile(`^\|?\s*:?-{2,}`)

// cells splits a table row on "|" that is not escaped as "\|".
func cells(l string) []string {
	l = strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(l), "|"), "|")
	var out []string
	var cur strings.Builder
	for i := 0; i < len(l); i++ {
		if l[i] == '\\' && i+1 < len(l) && l[i+1] == '|' {
			cur.WriteByte('|')
			i++
			continue
		}
		if l[i] == '|' {
			out = append(out, strings.TrimSpace(cur.String()))
			cur.Reset()
			continue
		}
		cur.WriteByte(l[i])
	}
	return append(out, strings.TrimSpace(cur.String()))
}

// ParseTable returns the first markdown table in text, or nil.
func ParseTable(text string) *Table {
	lines := strings.Split(text, "\n")
	for i := range lines {
		lines[i] = strings.TrimSpace(lines[i])
	}
	for i := 0; i+1 < len(lines); i++ {
		if strings.HasPrefix(lines[i], "|") && sepRow.MatchString(lines[i+1]) {
			t := &Table{Head: cells(lines[i])}
			for j := i + 2; j < len(lines) && strings.HasPrefix(lines[j], "|"); j++ {
				t.Rows = append(t.Rows, cells(lines[j]))
			}
			return t
		}
	}
	return nil
}

type Verdict struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}

type Field struct {
	Label string `json:"label"`
	Role  string `json:"role"`
	Text  string `json:"text"`
}

type Option struct {
	Key         *string `json:"key"`
	Name        string  `json:"name"`
	Topic       *string `json:"topic"`
	Verdict     Verdict `json:"verdict"`
	VerdictHead string  `json:"verdictHead"`
	Fields      []Field `json:"fields"`
}

type OptionGroup struct {
	Panel string   `json:"panel"`
	Title *string  `json:"title"`
	Items []Option `json:"items"`
}

var verdictRe = regexp.MustCompile(`(?i)^(ok|no|warn|✓|✔|✗|✘|⚠)(?:\s+(.*))?$`)
var verdictAlias = map[string]string{"✓": "ok", "✔": "ok", "✗": "no", "✘": "no", "⚠": "warn"}

func VerdictOf(cell string) *Verdict {
	m := verdictRe.FindStringSubmatch(strings.TrimSpace(cell))
	if m == nil {
		return nil
	}
	k := strings.ToLower(m[1])
	if a, ok := verdictAlias[k]; ok {
		k = a
	}
	return &Verdict{Kind: k, Label: strings.TrimSpace(m[2])}
}

var (
	topicHead = regexp.MustCompile(`(?i)^(topic|area|question|aspect)$`)
	nameHead  = regexp.MustCompile(`(?i)^(option|choice|alternative|approach|candidate)s?$`)
	proHead   = regexp.MustCompile(`(?i)^pros?$|advantage|benefit|strength`)
	conHead   = regexp.MustCompile(`(?i)^cons?$|disadvantage|drawback|weakness|risk`)
	letterRe  = regexp.MustCompile(`^([A-Z])\s*[—–-]\s*(.+)$`)
)

// OptionsFromTable reads an options table: the verdict column is the last one whose cells are
// mostly ok/no/warn.
func OptionsFromTable(t *Table) []Option {
	if t == nil || len(t.Rows) == 0 {
		return nil
	}
	vcol := -1
	for c := len(t.Head) - 1; c >= 0; c-- {
		hits := 0
		for _, r := range t.Rows {
			if c < len(r) && VerdictOf(r[c]) != nil {
				hits++
			}
		}
		if hits >= (len(t.Rows)+1)/2 {
			vcol = c
			break
		}
	}
	if vcol == -1 {
		return nil
	}
	topicCol, nameCol := -1, -1
	for i, h := range t.Head {
		if topicCol == -1 && topicHead.MatchString(h) {
			topicCol = i
		}
		if nameCol == -1 && nameHead.MatchString(h) {
			nameCol = i
		}
	}
	if nameCol == -1 {
		for i := range t.Head {
			if i != topicCol && i != vcol {
				nameCol = i
				break
			}
		}
	}
	at := func(r []string, i int) string {
		if i >= 0 && i < len(r) {
			return r[i]
		}
		return ""
	}
	var out []Option
	for _, r := range t.Rows {
		name := at(r, nameCol)
		o := Option{Name: name, VerdictHead: at(t.Head, vcol)}
		if m := letterRe.FindStringSubmatch(name); m != nil {
			k := m[1]
			o.Key, o.Name = &k, m[2]
		}
		if topicCol >= 0 {
			tp := at(r, topicCol)
			o.Topic = &tp
		}
		if v := VerdictOf(at(r, vcol)); v != nil {
			o.Verdict = *v
		} else {
			o.Verdict = Verdict{Kind: "info", Label: at(r, vcol)}
		}
		o.Fields = []Field{}
		for i, h := range t.Head {
			if i == vcol || i == nameCol || i == topicCol || at(r, i) == "" {
				continue
			}
			role := "info"
			if proHead.MatchString(h) {
				role = "pro"
			} else if conHead.MatchString(h) {
				role = "con"
			}
			o.Fields = append(o.Fields, Field{Label: h, Role: role, Text: at(r, i)})
		}
		out = append(out, o)
	}
	return out
}

// ── facts ─────────────────────────────────────────────────────────

type Facts struct {
	Decision       *string       `json:"decision"`
	Question       *string       `json:"question"`
	Recommendation *string       `json:"recommendation"`
	Options        []OptionGroup `json:"options"`
	Questions      []string      `json:"questions"`
	Consequences   []string      `json:"consequences"`
	Criteria       []string      `json:"criteria"`
}

var (
	plainCode = regexp.MustCompile("`([^`]*)`")
	plainBold = regexp.MustCompile(`\*\*?([^*]+)\*\*?`)
	plainLink = regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`)
	listItem  = regexp.MustCompile(`^\s{0,3}(?:[-*+]|\d+[.)])\s+(.*)$`)
	paraSplit = regexp.MustCompile(`\n\s*\n`)
)

func Plain(s string) string {
	s = plainCode.ReplaceAllString(s, "$1")
	s = plainBold.ReplaceAllString(s, "$1")
	s = plainLink.ReplaceAllString(s, "$1")
	return strings.TrimSpace(s)
}

func ListItems(text string) []string {
	out := []string{}
	for _, l := range strings.Split(text, "\n") {
		if m := listItem.FindStringSubmatch(l); m != nil {
			out = append(out, m[1])
		}
	}
	return out
}

func mdText(blocks []Block) string {
	var parts []string
	for _, b := range blocks {
		if b.Type == "md" {
			parts = append(parts, b.Text)
		}
	}
	return strings.Join(parts, "\n")
}

func firstFence(blocks []Block, langs ...string) *Block {
	for i := range blocks {
		if blocks[i].Type == "fence" {
			for _, l := range langs {
				if blocks[i].Lang == l {
					return &blocks[i]
				}
			}
		}
	}
	return nil
}

var (
	titleDecision = regexp.MustCompile(`^decision\b`)
	titleQuestion = regexp.MustCompile(`^question\b`)
	titleRec      = regexp.MustCompile(`^recommend`)
	titleOptions  = regexp.MustCompile(`^options?\b`)
	titleOptStrip = regexp.MustCompile(`(?i)^options?\s*:?\s*`)
	titleAsk      = regexp.MustCompile(`questions?\b.*(user|you|team|open)|^open questions`)
	titleConseq   = regexp.MustCompile(`^consequences?`)
	titleCriteria = regexp.MustCompile(`criteria`)
)

func ExtractFacts(panels []Panel) Facts {
	f := Facts{Options: []OptionGroup{}, Questions: []string{}, Consequences: []string{}, Criteria: []string{}}
	plainItems := func(xs []string) []string {
		for i := range xs {
			xs[i] = Plain(xs[i])
		}
		return xs
	}
	for _, p := range panels {
		t := strings.ToLower(p.Title)
		first := ""
		if c := firstFence(p.Blocks, "callout", "decision"); c != nil {
			first = c.Text
		} else {
			first = paraSplit.Split(mdText(p.Blocks), 2)[0]
		}
		val := Plain(first)
		switch {
		case titleDecision.MatchString(t) && empty(f.Decision):
			f.Decision = &val
		case titleQuestion.MatchString(t) && empty(f.Question):
			f.Question = &val
		case titleRec.MatchString(t) && empty(f.Recommendation):
			f.Recommendation = &val
		case titleOptions.MatchString(t):
			if opts := OptionsFromTable(ParseTable(mdText(p.Blocks))); opts != nil {
				g := OptionGroup{Panel: p.ID, Items: opts}
				if s := titleOptStrip.ReplaceAllString(p.Title, ""); s != "" {
					g.Title = &s
				}
				f.Options = append(f.Options, g)
			}
		case titleAsk.MatchString(t):
			f.Questions = plainItems(ListItems(mdText(p.Blocks)))
		case titleConseq.MatchString(t):
			f.Consequences = plainItems(ListItems(mdText(p.Blocks)))
		case titleCriteria.MatchString(t):
			f.Criteria = plainItems(ListItems(mdText(p.Blocks)))
		}
	}
	return f
}

var (
	plainFence = regexp.MustCompile("(?m)^```.*$")
	plainPunct = regexp.MustCompile("[#>*_`|{}\\[\\]]")
	plainFiles = regexp.MustCompile(`\(([^)]*\.(?:md|html))\)`)
	plainSpace = regexp.MustCompile(`\s+`)
)

func PlainText(body string) string {
	s := plainFence.ReplaceAllString(body, " ")
	s = plainPunct.ReplaceAllString(s, " ")
	s = plainFiles.ReplaceAllString(s, " ")
	return strings.TrimSpace(plainSpace.ReplaceAllString(s, " "))
}

func empty(p *string) bool { return p == nil || *p == "" }
