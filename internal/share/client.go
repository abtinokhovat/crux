package share

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/abtinokhovat/crux/internal/adr"
	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/edit"
)

// State maps ADR id → where it is shared. Lives in .crux/share.json (personal working state).
type State map[string]struct {
	Slug string `json:"slug"`
	URL  string `json:"url"`
	Mode string `json:"mode"`
	At   string `json:"at"`
}

func stateDir(cfg *config.Config) string { return cfg.Abs(".crux") }

func LoadState(cfg *config.Config) State {
	st := State{}
	if b, err := os.ReadFile(filepath.Join(stateDir(cfg), "share.json")); err == nil {
		_ = json.Unmarshal(b, &st)
	}
	return st
}

func saveState(cfg *config.Config, st State) error {
	dir := stateDir(cfg)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	gi := filepath.Join(dir, ".gitignore")
	if _, err := os.Stat(gi); err != nil {
		_ = os.WriteFile(gi, []byte("share.json\nreviews/\n"), 0o644)
	}
	b, _ := json.MarshalIndent(st, "", "  ")
	return os.WriteFile(filepath.Join(dir, "share.json"), b, 0o644)
}

var repoRe = regexp.MustCompile(`^.*[:/]([^/:]+/[^/]+)$`)

func repoName(cfg *config.Config) string {
	out, err := exec.Command("git", "-C", cfg.Root, "remote", "get-url", "origin").Output()
	if err != nil {
		return filepath.Base(cfg.Root)
	}
	u := strings.TrimSuffix(strings.TrimSpace(string(out)), ".git")
	if m := repoRe.FindStringSubmatch(u); m != nil {
		return m[1]
	}
	return u
}

var httpc = &http.Client{Timeout: 20 * time.Second}

func call(cfg *config.Config, method, path string, body, out any) error {
	if cfg.Share == "" {
		return fmt.Errorf("no share server: add `share: https://crux.example.com` to crux.config.yaml, then run `crux login`")
	}
	if cfg.ShareToken == "" && method != http.MethodGet {
		return fmt.Errorf("not logged in to %s: run `crux login %s --token <token>`", cfg.Share, cfg.Share)
	}
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, cfg.Share+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if cfg.ShareToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.ShareToken)
	}
	res, err := httpc.Do(req)
	if err != nil {
		return fmt.Errorf("cannot reach %s: %v", cfg.Share, err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		var e struct{ Error string }
		_ = json.NewDecoder(res.Body).Decode(&e)
		if e.Error == "" {
			e.Error = res.Status
		}
		return fmt.Errorf("%d %s", res.StatusCode, e.Error)
	}
	if out != nil {
		return json.NewDecoder(res.Body).Decode(out)
	}
	return nil
}

// Whoami checks a token against a server and returns the owner handle.
func Whoami(server, token string) (string, error) {
	req, _ := http.NewRequest(http.MethodGet, strings.TrimRight(server, "/")+"/api/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := httpc.Do(req)
	if err != nil {
		return "", fmt.Errorf("cannot reach %s: %v", server, err)
	}
	defer res.Body.Close()
	var out struct{ Handle, Error string }
	_ = json.NewDecoder(res.Body).Decode(&out)
	if res.StatusCode != 200 {
		return "", fmt.Errorf("%s", firstNonEmpty(out.Error, res.Status))
	}
	return out.Handle, nil
}

var (
	leadAsk = regexp.MustCompile(`^@([\w.-]+)\s*[:—-]\s*(.*)$`)
	tailAsk = regexp.MustCompile(`^(.*?)\s*\(@([\w.-]+)\)\s*$`)
)

// TeamQuestions reads "## Questions for the team": "- @handle: question" or "1. … (@handle)".
func TeamQuestions(src string) []Question {
	body, ok := edit.PanelBody(src, "Questions for the team")
	if !ok {
		body, _ = edit.PanelBody(src, "Questions for the user")
	}
	out := []Question{}
	for _, t := range adr.ListItems(body) {
		if m := leadAsk.FindStringSubmatch(t); m != nil {
			out = append(out, Question{m[1], m[2]})
		} else if m := tailAsk.FindStringSubmatch(t); m != nil {
			out = append(out, Question{m[2], m[1]})
		} else {
			out = append(out, Question{"", t})
		}
	}
	return out
}

func snapshot(cfg *config.Config, s *adr.Store, d *adr.Doc) *Snapshot {
	sn := &Snapshot{Source: d.Source, StatusKey: d.StatusKey, Prefix: cfg.Prefix, Digits: cfg.Digits, Refs: map[string]Ref{}, Questions: TeamQuestions(d.Source), Options: []Option{}}
	// other ADRs it links to, so references render with title and status
	for _, id := range append(append([]string{}, d.Mentions...), relIDs(d)...) {
		if o := s.ByID[id]; o != nil {
			sn.Refs[id] = Ref{o.Title, o.Status, o.StatusKey}
		}
	}
	lean := adr.Str(d.Meta["leaning"])
	i := 0
	for _, g := range d.Facts.Options {
		for _, o := range g.Items {
			k := string(rune('A' + i))
			if o.Key != nil {
				k = *o.Key
			}
			sn.Options = append(sn.Options, Option{k, o.Name})
			if lean == "" && o.Verdict.Kind == "ok" {
				lean = k
			}
			i++
		}
	}
	if lean != "" {
		why := ""
		if d.Facts.Recommendation != nil {
			why = *d.Facts.Recommendation
		}
		sn.Leaning = &Leaning{lean, why}
	}
	return sn
}

func relIDs(d *adr.Doc) []string {
	var out []string
	for _, ids := range d.Rel {
		out = append(out, ids...)
	}
	return out
}

func publishItem(cfg *config.Config, d *adr.Doc, p publish) (*Item, error) {
	p.Repo = repoName(cfg)
	p.Adr = &AdrRef{d.ID, d.Title, d.Status}
	var it Item
	if err := call(cfg, http.MethodPost, "/api/items", p, &it); err != nil {
		return nil, err
	}
	st := LoadState(cfg)
	e := st[d.ID]
	e.Slug, e.URL, e.Mode, e.At = it.Slug, it.URL, it.Mode, time.Now().Format(time.RFC3339)
	st[d.ID] = e
	return &it, saveState(cfg, st)
}

func question(d *adr.Doc) string {
	if d.Facts.Question != nil && *d.Facts.Question != "" {
		return *d.Facts.Question
	}
	return firstNonEmpty(d.Subtitle, d.Title)
}

// OpenNotes: the room sees the question and your notes so far.
func OpenNotes(cfg *config.Config, d *adr.Doc) (*Item, error) {
	q := question(d)
	ctx, _ := edit.PanelBody(d.Source, "Notes")
	return publishItem(cfg, d, publish{Mode: "notes", Question: &q, Context: &ctx})
}

// ShareReview publishes (or updates) the ADR for team review.
func ShareReview(cfg *config.Config, s *adr.Store, d *adr.Doc) (*Item, error) {
	q := question(d)
	return publishItem(cfg, d, publish{Mode: "review", Question: &q, Snapshot: snapshot(cfg, s, d)})
}

// PublishFinal shows the accepted ADR and the decision to reviewers.
func PublishFinal(cfg *config.Config, s *adr.Store, d *adr.Doc, option, decision string) (*Item, error) {
	q := question(d)
	return publishItem(cfg, d, publish{Mode: "final", Question: &q, Snapshot: snapshot(cfg, s, d), Final: &Final{Option: option, Decision: decision}})
}

func SetMode(cfg *config.Config, d *adr.Doc, mode string) (*Item, error) {
	e, ok := LoadState(cfg)[d.ID]
	if !ok {
		return nil, fmt.Errorf("%s-%s is not shared", cfg.Prefix, d.ID)
	}
	var it Item
	if err := call(cfg, http.MethodPatch, "/api/items/"+e.Slug, publish{Mode: mode}, &it); err != nil {
		return nil, err
	}
	st := LoadState(cfg)
	e.Mode = it.Mode
	st[d.ID] = e
	return &it, saveState(cfg, st)
}

// Fetch returns the shared item, or nil when the ADR is not shared.
func Fetch(cfg *config.Config, d *adr.Doc) (*Item, error) {
	e, ok := LoadState(cfg)[d.ID]
	if !ok {
		return nil, nil
	}
	var it Item
	if err := call(cfg, http.MethodGet, "/api/items/"+e.Slug, nil, &it); err != nil {
		return nil, err
	}
	return &it, nil
}

func SendReply(cfg *config.Config, d *adr.Doc, entry, kind, text string) (*Entry, error) {
	e, ok := LoadState(cfg)[d.ID]
	if !ok {
		return nil, fmt.Errorf("not shared")
	}
	var out Entry
	return &out, call(cfg, http.MethodPost, "/api/items/"+e.Slug+"/entries/"+entry+"/reply", map[string]string{"kind": kind, "text": text}, &out)
}

// Digest renders team input as markdown for the user and their Claude.
func Digest(d *adr.Doc, it *Item) string {
	names := map[string]string{}
	if it.Snapshot != nil {
		for _, o := range it.Snapshot.Options {
			names[o.Key] = o.Name
		}
	}
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	line := func(e Entry) string {
		s := "- @" + e.By
		if e.Opt != nil {
			s += " [" + *e.Opt + "]"
		}
		if e.Target != nil {
			s += " (on: " + *e.Target + ")"
		}
		s += ": " + e.Text
		if e.Why != "" {
			s += " — because: " + e.Why
		}
		if e.Reply != nil {
			s += "\n  - owner " + e.Reply.Kind
			if e.Reply.Text != "" {
				s += ": " + e.Reply.Text
			}
		}
		return s
	}
	section := func(title, kind string) []string {
		out := []string{"", "## " + title}
		n := 0
		for _, e := range it.Entries {
			if e.Kind == kind {
				out = append(out, line(e))
				n++
			}
		}
		if n == 0 {
			out = append(out, "- none")
		}
		return out
	}
	lines := []string{fmt.Sprintf("# Team input for ADR-%s — %s", d.ID, d.Title), fmt.Sprintf("Mode: %s · %d entries · pulled %s", it.Mode, len(it.Entries), time.Now().Format("2006-01-02 15:04")), "", "## Picks"}
	picks := 0
	for _, e := range it.Entries {
		if e.Kind == "pick" {
			conf := 0
			if e.Conf != nil {
				conf = *e.Conf
			}
			l := fmt.Sprintf("- @%s: %s (%s) · %d%%", e.By, str(e.Opt), names[str(e.Opt)], conf)
			if e.Text != "" {
				l += " — " + e.Text
			}
			lines = append(lines, l)
			picks++
		}
	}
	if picks == 0 {
		lines = append(lines, "- none")
	}
	lines = append(lines, section("Pros", "pro")...)
	lines = append(lines, section("Cons", "con")...)
	lines = append(lines, section("Answers", "answer")...)
	lines = append(lines, section("Comments", "comment")...)
	lines = append(lines, section("Meeting notes", "note")...)
	open := 0
	for _, e := range it.Entries {
		if e.Reply == nil && (e.Kind == "pro" || e.Kind == "con" || e.Kind == "comment" || e.Kind == "answer") {
			open++
		}
	}
	lines = append(lines, "", fmt.Sprintf("Unanswered: %d", open))
	return strings.Join(lines, "\n") + "\n"
}

func WriteDigest(cfg *config.Config, d *adr.Doc, it *Item) (string, error) {
	p := filepath.Join(stateDir(cfg), "reviews", d.ID+".md")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return "", err
	}
	return cfg.Rel(p), os.WriteFile(p, []byte(Digest(d, it)), 0o644)
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}
