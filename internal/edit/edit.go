// Package edit makes small, line-based changes to ADR markdown, touching only what changes so
// the file stays readable in a diff and authors keep their formatting.
package edit

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"

	"github.com/abtinokhovat/crux/internal/adr"
)

var fmRe = regexp.MustCompile(`(?s)^---\r?\n(.*?)\r?\n---\r?\n?`)

var plainScalar = regexp.MustCompile(`^[\w./@+-][\w ./@+()–—'-]*$`)
var riskyScalar = regexp.MustCompile(`(?i):\s|\s#|^(true|false|null|yes|no|\d+)$`)

func scalar(s string) string {
	if plainScalar.MatchString(s) && !riskyScalar.MatchString(s) {
		return s
	}
	b, _ := json.Marshal(s)
	return string(b)
}

// Value is a frontmatter value: string, []string, or nil (removes the key).
func yamlValue(v any) string {
	switch x := v.(type) {
	case []string:
		parts := make([]string, len(x))
		for i, s := range x {
			parts[i] = scalar(s)
		}
		return "[" + strings.Join(parts, ", ") + "]"
	default:
		return scalar(adr.Str(x))
	}
}

// Patch is applied in order so new keys land predictably.
type Patch []KV

type KV struct {
	Key   string
	Value any
}

// SetFrontmatter sets or removes keys. New keys go before the closing ---.
func SetFrontmatter(text string, patch Patch) string {
	m := fmRe.FindStringSubmatchIndex(text)
	var lines []string
	if m != nil {
		lines = strings.Split(strings.ReplaceAll(text[m[2]:m[3]], "\r\n", "\n"), "\n")
	}
	for _, kv := range patch {
		keyRe := regexp.MustCompile(`^` + regexp.QuoteMeta(kv.Key) + `\s*:`)
		i := -1
		for j, l := range lines {
			if keyRe.MatchString(l) {
				i = j
				break
			}
		}
		end := i + 1
		if i >= 0 {
			for end < len(lines) && regexp.MustCompile(`^\s+-\s`).MatchString(lines[end]) {
				end++
			}
		}
		if kv.Value == nil {
			if i >= 0 {
				lines = append(lines[:i], lines[end:]...)
			}
			continue
		}
		line := kv.Key + ": " + yamlValue(kv.Value)
		if i >= 0 {
			lines = append(lines[:i], append([]string{line}, lines[end:]...)...)
		} else {
			lines = append(lines, line)
		}
	}
	fm := "---\n" + strings.Join(lines, "\n") + "\n---\n"
	if m != nil {
		return fm + text[m[1]:]
	}
	return fm + text
}

func Frontmatter(text string) map[string]any {
	meta, _, _ := adr.SplitFrontmatter(text)
	return meta
}

// ── panels ────────────────────────────────────────────────────────

type panel struct {
	Title, Attrs string
	Line, End    int
}

var (
	fenceStart = regexp.MustCompile("^(`{3,}|~{3,})")
	headRe     = regexp.MustCompile(`^##\s+(.+?)\s*(\{[^{}]*\})?\s*$`)
)

func panels(text string) []panel {
	lines := strings.Split(text, "\n")
	var out []panel
	fence := ""
	for i, l := range lines {
		if f := fenceStart.FindString(l); f != "" {
			if fence == "" {
				fence = f
			} else if strings.HasPrefix(l, fence) {
				fence = ""
			}
			continue
		}
		if fence != "" {
			continue
		}
		if m := headRe.FindStringSubmatch(l); m != nil {
			out = append(out, panel{Title: strings.TrimSpace(m[1]), Attrs: m[2], Line: i})
		}
	}
	for k := range out {
		if k+1 < len(out) {
			out[k].End = out[k+1].Line
		} else {
			out[k].End = len(lines)
		}
	}
	return out
}

func find(text, title string) *panel {
	for _, p := range panels(text) {
		if strings.EqualFold(strings.TrimSpace(p.Title), strings.TrimSpace(title)) {
			return &p
		}
	}
	return nil
}

func PanelBody(text, title string) (string, bool) {
	p := find(text, title)
	if p == nil {
		return "", false
	}
	lines := strings.Split(text, "\n")
	return strings.TrimSpace(strings.Join(lines[p.Line+1:p.End], "\n")), true
}

type Where struct{ After, Before string }

// SetPanel replaces a panel body or inserts the panel (after/before another, or at the end).
func SetPanel(text, title, body string, where Where) string {
	lines := strings.Split(text, "\n")
	if p := find(text, title); p != nil {
		head := "## " + p.Title
		if p.Attrs != "" {
			head += " " + p.Attrs
		}
		repl := []string{head, strings.TrimSpace(body), ""}
		return strings.Join(append(append(append([]string{}, lines[:p.Line]...), repl...), lines[p.End:]...), "\n")
	}
	block := []string{"## " + title + " {span=3}", strings.TrimSpace(body), ""}
	at := len(lines)
	if where.After != "" {
		if a := find(text, where.After); a != nil {
			at = a.End
		}
	} else if where.Before != "" {
		if a := find(text, where.Before); a != nil {
			at = a.Line
		}
	}
	if at == len(lines) && len(lines) > 0 && lines[len(lines)-1] != "" {
		block = append([]string{""}, block...)
	}
	return strings.Join(append(append(append([]string{}, lines[:at]...), block...), lines[at:]...), "\n")
}

func AppendToPanel(text, title string, add []string, where Where) string {
	body, _ := PanelBody(text, title)
	var parts []string
	if body != "" {
		parts = append(parts, body)
	}
	parts = append(parts, add...)
	return SetPanel(text, title, strings.Join(parts, "\n"), where)
}

func RemovePanel(text, title string) string {
	p := find(text, title)
	if p == nil {
		return text
	}
	lines := strings.Split(text, "\n")
	return strings.Join(append(lines[:p.Line:p.Line], lines[p.End:]...), "\n")
}

var fromClaude = regexp.MustCompile(`\s*from=claude\s*`)

// KeepPanel drops the {from=claude} marker: the user kept a block their Claude wrote.
func KeepPanel(text, title string) string {
	p := find(text, title)
	if p == nil {
		return text
	}
	lines := strings.Split(text, "\n")
	attrs := fromClaude.ReplaceAllString(p.Attrs, " ")
	attrs = regexp.MustCompile(`\{\s*\}`).ReplaceAllString(attrs, "")
	attrs = strings.TrimSpace(regexp.MustCompile(`\{\s+`).ReplaceAllString(regexp.MustCompile(`\s+\}`).ReplaceAllString(attrs, "}"), "{"))
	lines[p.Line] = strings.TrimSpace("## " + p.Title + " " + attrs)
	return strings.Join(lines, "\n")
}

var (
	optHead  = regexp.MustCompile(`(?i)^##\s+options?\b`)
	anyHead  = regexp.MustCompile(`^##\s+`)
	sepLine  = regexp.MustCompile(`^\|\s*:?-{2,}`)
	verdictC = regexp.MustCompile(`(?i)^(ok|no|warn)\b`)
	keyCell  = regexp.MustCompile(`^([A-Z])\s*[—–-]`)
)

// SetVerdicts marks the chosen option "ok" and the others "no" in Options tables.
func SetVerdicts(text, chosen string) string {
	lines := strings.Split(text, "\n")
	in := false
	for i, l := range lines {
		if anyHead.MatchString(l) {
			in = optHead.MatchString(l)
		}
		if !in || !strings.HasPrefix(l, "|") || sepLine.MatchString(l) {
			continue
		}
		cells := strings.Split(strings.TrimSuffix(strings.TrimPrefix(l, "|"), "|"), "|")
		last := strings.TrimSpace(cells[len(cells)-1])
		if !verdictC.MatchString(last) {
			continue
		}
		first := strings.TrimSpace(cells[0])
		key := first
		if m := keyCell.FindStringSubmatch(first); m != nil {
			key = m[1]
		}
		v := "no"
		if key == chosen || strings.HasPrefix(strings.ToLower(first), strings.ToLower(chosen)) {
			v = "ok"
		}
		cells[len(cells)-1] = " " + v + " "
		lines[i] = "|" + strings.Join(cells, "|") + "|"
	}
	return strings.Join(lines, "\n")
}

var blankRuns = regexp.MustCompile(`\n{3,}`)

func Read(path string) (string, error) {
	b, err := os.ReadFile(path)
	return string(b), err
}

func Write(path, text string) error {
	return os.WriteFile(path, []byte(blankRuns.ReplaceAllString(text, "\n\n")), 0o644)
}
