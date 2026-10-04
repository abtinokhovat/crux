// Package cli implements the crux command line.
package cli

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/abtinokhovat/crux/internal/adr"
	"github.com/abtinokhovat/crux/internal/app"
	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/flow"
	"github.com/abtinokhovat/crux/internal/share"
	"github.com/abtinokhovat/crux/skills"
)

var Version = "dev"

//go:embed help.txt
var help string

// ── output ──

var tty = func() bool { st, err := os.Stdout.Stat(); return err == nil && st.Mode()&os.ModeCharDevice != 0 }()

func paint(code string) func(string) string {
	return func(s string) string {
		if !tty || os.Getenv("NO_COLOR") != "" {
			return s
		}
		return "\x1b[" + code + "m" + s + "\x1b[0m"
	}
}

var (
	bold   = paint("1")
	dim    = paint("2")
	green  = paint("32")
	yellow = paint("33")
	red    = paint("31")
	cyan   = paint("36")
)

func out(f string, a ...any) { fmt.Printf(f+"\n", a...) }

func statusColor(d *adr.Doc) string {
	s := pad(d.Status, 12)
	switch d.StatusKey {
	case "open":
		return yellow(s)
	case "proposed", "review":
		return cyan(s)
	case "accepted":
		return green(s)
	case "rejected":
		return red(s)
	}
	return dim(s)
}

func pad(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s + strings.Repeat(" ", n-len(r))
}

func jsonOut(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// ── args ──

type args struct {
	pos   []string
	flags map[string]string
}

var valueFlags = map[string]bool{"root": true, "port": true, "host": true, "out": true, "tags": true, "components": true, "status": true, "author": true, "tag": true, "context": true, "due": true, "option": true, "decision": true, "reopen": true, "token": true, "data": true}
var short = map[string]string{"o": "out", "c": "context", "h": "help"}

func parse(argv []string) args {
	a := args{flags: map[string]string{}}
	for i := 0; i < len(argv); i++ {
		s := argv[i]
		if !strings.HasPrefix(s, "-") || s == "-" {
			a.pos = append(a.pos, s)
			continue
		}
		name := strings.TrimLeft(s, "-")
		val, hasVal := "", false
		if k, v, ok := strings.Cut(name, "="); ok {
			name, val, hasVal = k, v, true
		}
		if l, ok := short[name]; ok {
			name = l
		}
		if valueFlags[name] && !hasVal && i+1 < len(argv) {
			val, hasVal = argv[i+1], true
			i++
		}
		if !hasVal {
			val = "true"
		}
		a.flags[name] = val
	}
	return a
}

func (a args) has(k string) bool { return a.flags[k] != "" }

// ── project ──

func project(a args, quiet bool) (*config.Config, error) {
	root := a.flags["root"]
	if root == "" {
		wd, _ := os.Getwd()
		if root = config.FindRoot(wd); root == "" {
			root = wd
		}
	}
	root, _ = filepath.Abs(root)
	cfg, err := config.Load(root)
	if err == nil && cfg.File == "" && !quiet {
		fmt.Fprintln(os.Stderr, dim(fmt.Sprintf("No crux.config.yaml in %s; using defaults (dir: %s). Run \"crux init\" to create one.", root, cfg.Dir)))
	}
	return cfg, err
}

func getAdr(cfg *config.Config, s *adr.Store, raw string) (*adr.Doc, error) {
	id := adr.RefID(raw, cfg.Digits)
	if d := s.ByID[id]; d != nil && d.Kind == "adr" {
		return d, nil
	}
	return nil, fmt.Errorf("no %s-%s. Run \"crux list\"", cfg.Prefix, raw)
}

// ── commands ──

type command func(a args) error

var commands map[string]command

func init() {
	commands = map[string]command{
		"help": func(args) error { fmt.Print(help); return nil }, "version": func(args) error { out("crux %s", Version); return nil },
		"init": cmdInit, "serve": cmdServe, "build": cmdBuild, "new": cmdNew, "next": cmdNext, "list": cmdList, "show": cmdShow,
		"search": cmdSearch, "lint": cmdLint, "index": cmdIndex, "graph": cmdGraph, "tags": cmdTags, "components": cmdComponents,
		"q": cmdQ, "notes": cmdNotes, "share": cmdShare, "pull": cmdPull, "finalize": cmdFinalize, "link": cmdLink, "context": cmdContext,
		"server": cmdServer, "login": cmdLogin, "me": cmdMe, "skill": cmdSkill,
	}
}

// Main runs the CLI and returns the exit code.
func Main(argv []string) int {
	name := "help"
	if len(argv) > 0 && !strings.HasPrefix(argv[0], "-") {
		name, argv = argv[0], argv[1:]
	}
	a := parse(argv)
	if a.has("version") && name == "help" {
		name = "version"
	}
	cmd, ok := commands[name]
	if !ok {
		fmt.Fprintln(os.Stderr, red("✗ unknown command \""+name+"\""))
		fmt.Print(help)
		return 1
	}
	if a.has("help") {
		fmt.Print(help)
		return 0
	}
	if err := cmd(a); err != nil {
		var ex exitErr
		if errors.As(err, &ex) {
			return int(ex)
		}
		fmt.Fprintln(os.Stderr, red("✗ "+err.Error()))
		return 1
	}
	return 0
}

type exitErr int

func (e exitErr) Error() string { return "exit " + strconv.Itoa(int(e)) }

func cmdInit(a args) error {
	root := a.flags["root"]
	if root == "" {
		root, _ = os.Getwd()
	}
	name := filepath.Base(root)
	var wrote []string
	put := func(rel, body string) error {
		p := filepath.Join(root, rel)
		if _, err := os.Stat(p); err == nil && !a.has("force") {
			return nil
		}
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		wrote = append(wrote, rel)
		return os.WriteFile(p, []byte(strings.ReplaceAll(body, "{{name}}", name)), 0o644)
	}
	for _, f := range [][2]string{
		{"crux.config.yaml", "init-config.yaml"}, {"docs/adr/architecture.yaml", "init-architecture.yaml"}, {".crux/template.md", "adr.md"},
		{".crux/components/example.mjs", "component.example.mjs"}, {"docs/adr/README.md", "init-readme.md"},
	} {
		if err := put(f[0], flow.Template(f[1])); err != nil {
			return err
		}
	}
	if len(wrote) == 0 {
		out("Nothing to do; files exist (use --force to overwrite).")
		return nil
	}
	out("%s created\n  %s\n\nNext: %s, then %s", green("✓"), strings.Join(wrote, "\n  "), bold(`crux q "Which … ?"`), bold("crux serve"))
	return nil
}

func cmdServe(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	port, _ := strconv.Atoi(firstNonEmpty(a.flags["port"], os.Getenv("PORT"), "4321"))
	host := firstNonEmpty(a.flags["host"], "127.0.0.1")
	srv, url, err := app.Serve(cfg, host, port)
	if err != nil {
		return err
	}
	s := srv.Store()
	comps := 0
	if s.Architecture != nil {
		comps = len(s.Architecture.Nodes)
	}
	out("%s %s  %s\n  %d ADRs · %d docs · %d links · %d tags · %d components\n  watching %s", green("●"), bold(cfg.Title), cyan(url), len(s.Adrs), len(s.Docs), len(s.Edges), len(s.Tags), comps, cfg.Dir)
	if len(s.Problems) > 0 {
		out("  %s — run %s", yellow(fmt.Sprintf("%d problem(s)", len(s.Problems))), bold("crux lint"))
	}
	out("  %s", dim("Ctrl+C to stop"))
	if a.has("open") {
		openURL(url)
	}
	select {}
}

func openURL(u string) {
	var c *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		c = exec.Command("open", u)
	case "windows":
		c = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	default:
		c = exec.Command("xdg-open", u)
	}
	_ = c.Start()
}

func cmdBuild(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	dir := cfg.Abs(firstNonEmpty(a.flags["out"], first(a.pos), "dist/adr"))
	n, err := app.Build(cfg, dir)
	if err != nil {
		return err
	}
	out("%s %d pages → %s\n  Serve with any static server (GitHub Pages, S3, nginx).", green("✓"), n, cfg.Rel(dir))
	return nil
}

func cmdNew(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	title := strings.TrimSpace(strings.Join(a.pos, " "))
	if title == "" {
		return errors.New(`give a title: crux new "Use Kafka for domain events"`)
	}
	s := adr.Load(cfg)
	id := fmt.Sprintf("%0*d", cfg.Digits, adr.NextNumber(s))
	tpl := flow.Template("adr.md")
	if a.has("open") {
		tpl = flow.Template("adr-open.md")
	} else if b, err := os.ReadFile(cfg.Abs(cfg.Template)); err == nil {
		tpl = string(b)
	}
	status := firstNonEmpty(a.flags["status"], map[bool]string{true: "Open", false: "Proposed"}[a.has("open")])
	vars := map[string]string{"prefix": cfg.Prefix, "id": id, "title": title, "date": today(), "status": status, "author": firstNonEmpty(a.flags["author"], cfg.Me, os.Getenv("USER")), "tags": list(a.flags["tags"]), "components": list(a.flags["components"])}
	body := regexp.MustCompile(`\{\{(\w+)\}\}`).ReplaceAllStringFunc(tpl, func(m string) string {
		if v, ok := vars[m[2:len(m)-2]]; ok {
			return v
		}
		return m
	})
	p := filepath.Join(cfg.Abs(cfg.Dir), id+"-"+flow.Slugify(title)+".md")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	if _, err := os.Stat(p); err == nil {
		return fmt.Errorf("%s exists", cfg.Rel(p))
	}
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		return err
	}
	if a.has("json") {
		return jsonOut(map[string]string{"id": id, "file": cfg.Rel(p), "title": title})
	}
	out("%s %s-%s  %s", green("✓"), cfg.Prefix, id, cfg.Rel(p))
	return nil
}

func list(s string) string {
	var out []string
	for _, x := range strings.Split(s, ",") {
		if x = strings.TrimSpace(x); x != "" {
			out = append(out, x)
		}
	}
	return strings.Join(out, ", ")
}

func cmdNext(a args) error {
	cfg, err := project(a, true)
	if err != nil {
		return err
	}
	out("%0*d", cfg.Digits, adr.NextNumber(adr.Load(cfg)))
	return nil
}

func cmdList(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	s := adr.Load(cfg)
	var items []*adr.Doc
	for _, d := range s.Adrs {
		if st := a.flags["status"]; st != "" && d.StatusKey != strings.ToLower(st) {
			continue
		}
		if t := a.flags["tag"]; t != "" && !slices.Contains(d.Tags, strings.ToLower(t)) {
			continue
		}
		items = append(items, d)
	}
	if a.has("json") {
		return jsonOut(items)
	}
	if len(items) == 0 {
		out(dim("No ADRs."))
	}
	for _, d := range items {
		var tags []string
		for _, t := range d.Tags {
			tags = append(tags, "#"+t)
		}
		out("%s  %s %s %s", bold(d.ID), statusColor(d), pad(d.Title, 52), dim(strings.Join(tags, " ")))
	}
	return nil
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func cmdShow(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	s := adr.Load(cfg)
	d, err := getAdr(cfg, s, first(a.pos))
	if err != nil {
		return err
	}
	var links []adr.Edge
	for _, e := range s.Edges {
		if e.From == d.ID || e.To == d.ID {
			links = append(links, e)
		}
	}
	if a.has("json") {
		return jsonOut(map[string]any{"adr": d, "links": links})
	}
	f := d.Facts
	out("%s  %s %s", bold(cfg.Prefix+"-"+d.ID), statusColor(d), bold(d.Title))
	if d.Subtitle != "" {
		out(dim(d.Subtitle))
	}
	out(dim(d.File))
	if v := deref(f.Decision); v != "" {
		out("\n%s%s", green("Decision  "), v)
	}
	if v := deref(f.Question); v != "" {
		out("\n%s%s", yellow("Question  "), v)
	}
	if v := deref(f.Recommendation); v != "" {
		out("\n%s%s", cyan("Leaning   "), v)
	}
	for _, g := range f.Options {
		h := "Options"
		if g.Title != nil {
			h += ": " + *g.Title
		}
		out("\n%s", bold(h))
		for _, o := range g.Items {
			mark := map[string]string{"ok": green("✓"), "no": red("✗"), "warn": yellow("~")}[o.Verdict.Kind]
			if mark == "" {
				mark = "·"
			}
			k := ""
			if o.Key != nil {
				k = *o.Key + " — "
			}
			lbl := ""
			if o.Verdict.Label != "" {
				lbl = dim(" (" + o.Verdict.Label + ")")
			}
			out("  %s %s%s%s", mark, k, o.Name, lbl)
		}
	}
	if len(f.Questions) > 0 {
		out("\n%s", yellow(fmt.Sprintf("Open questions (%d)", len(f.Questions))))
		for i, q := range f.Questions {
			out("  %d. %s", i+1, q)
		}
	}
	if len(d.Tags) > 0 {
		out("\nTags: #%s", strings.Join(d.Tags, " #"))
	}
	if len(d.Components) > 0 {
		out("Components: %s", strings.Join(d.Components, ", "))
	}
	if len(d.Reopen) > 0 {
		out("Reopen when: %s", strings.Join(d.Reopen, " · "))
	}
	if len(links) > 0 {
		var ls []string
		for _, e := range links {
			if e.From == d.ID {
				ls = append(ls, "→ "+e.Type+" "+e.To)
			} else {
				ls = append(ls, "← "+e.Type+" "+e.From)
			}
		}
		out("Links: %s", strings.Join(ls, ", "))
	}
	return nil
}

func cmdSearch(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	words := strings.Fields(strings.ToLower(strings.Join(a.pos, " ")))
	if len(words) == 0 {
		return errors.New("crux search <words>")
	}
	s := adr.Load(cfg)
	type hit struct {
		d     *adr.Doc
		score int
	}
	var hits []hit
	for _, d := range append(append([]*adr.Doc{}, s.Adrs...), s.Docs...) {
		hay := strings.ToLower(strings.Join([]string{d.ID, d.Title, d.Subtitle, strings.Join(d.Tags, " "), strings.Join(d.Components, " "), d.Text}, " "))
		title := strings.ToLower(d.Title + " " + strings.Join(d.Tags, " "))
		score, ok := 0, true
		for _, w := range words {
			if !strings.Contains(hay, w) {
				ok = false
				break
			}
			score++
			if strings.Contains(title, w) {
				score += 4
			}
		}
		if ok {
			hits = append(hits, hit{d, score})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].score > hits[j].score })
	if a.has("json") {
		var res []map[string]string
		for _, h := range hits {
			res = append(res, map[string]string{"id": h.d.ID, "title": h.d.Title, "status": h.d.Status, "file": h.d.File})
		}
		return jsonOut(res)
	}
	if len(hits) == 0 {
		out(dim("No match."))
	}
	for _, h := range hits {
		id := h.d.ID
		if h.d.Kind != "adr" {
			id = "doc "
		}
		out("%s  %s %s  %s", bold(id), statusColor(h.d), h.d.Title, dim(h.d.File))
	}
	return nil
}

func cmdLint(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	s := adr.Load(cfg)
	problems := append([]adr.Problem{}, s.Problems...)
	for _, d := range s.Adrs {
		if d.Date == "" {
			problems = append(problems, adr.Problem{File: d.File, Message: "missing date", Level: "warn"})
		}
		if (d.StatusKey == "accepted" || d.StatusKey == "proposed") && deref(d.Facts.Decision) == "" {
			problems = append(problems, adr.Problem{File: d.File, Message: `no "## Decision" panel with a callout — the UI cannot show the decision`, Level: "warn"})
		}
		if d.StatusKey == "open" && deref(d.Facts.Question) == "" {
			problems = append(problems, adr.Problem{File: d.File, Message: `open ADR without a "## Question" callout`, Level: "warn"})
		}
		if len(d.Tags) == 0 {
			problems = append(problems, adr.Problem{File: d.File, Message: "no tags", Level: "warn"})
		}
	}
	if a.has("json") {
		return jsonOut(problems)
	}
	errs := 0
	for _, p := range problems {
		lvl := red("error")
		if p.Level == "warn" {
			lvl = yellow("warn ")
		} else {
			errs++
		}
		out("%s %s  %s", lvl, p.File, p.Message)
	}
	if len(problems) == 0 {
		out("%s %d ADRs clean", green("✓"), len(s.Adrs))
	} else {
		out("\n%d error(s), %d warning(s)", errs, len(problems)-errs)
	}
	if errs > 0 {
		return exitErr(1)
	}
	return nil
}

var indexBlock = regexp.MustCompile(`(?s)<!-- (?:crux|adr):index:start -->.*<!-- (?:crux|adr):index:end -->`)

func cmdIndex(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	s := adr.Load(cfg)
	p := filepath.Join(cfg.Abs(cfg.Dir), "README.md")
	rows := []string{"<!-- crux:index:start -->", "| # | Title | Status | Tags |", "|---|---|---|---|"}
	for _, d := range s.Adrs {
		var tags []string
		for _, t := range d.Tags {
			tags = append(tags, "`"+t+"`")
		}
		rows = append(rows, fmt.Sprintf("| [%s](%s) | %s | %s | %s |", d.ID, filepath.Base(d.File), d.Title, d.Status, strings.Join(tags, " ")))
	}
	table := strings.Join(append(rows, "<!-- crux:index:end -->"), "\n")
	text := "# Architecture Decision Records\n\n## Index\n\n"
	if b, err := os.ReadFile(p); err == nil {
		text = string(b)
	}
	if indexBlock.MatchString(text) {
		text = indexBlock.ReplaceAllLiteralString(text, table)
	} else {
		text = strings.TrimRight(text, "\n") + "\n\n" + table + "\n"
	}
	if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
		return err
	}
	out("%s %d rows → %s", green("✓"), len(s.Adrs), cfg.Rel(p))
	return nil
}

func cmdGraph(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	s := adr.Load(cfg)
	if a.has("json") {
		var nodes []map[string]any
		for _, d := range s.Adrs {
			nodes = append(nodes, map[string]any{"id": d.ID, "title": d.Title, "status": d.StatusKey, "tags": d.Tags})
		}
		return jsonOut(map[string]any{"nodes": nodes, "edges": s.Edges})
	}
	if a.has("mermaid") {
		arrow := map[string]string{"supersedes": "==>|supersedes|", "depends_on": "-->|depends on|", "amends": "-->|amends|", "relates": "---", "mentions": "-.->"}
		out("graph LR")
		for _, d := range s.Adrs {
			out("  A%s[\"%s %s\"]:::%s", d.ID, d.ID, strings.ReplaceAll(d.Title, `"`, "'"), d.StatusKey)
		}
		for _, e := range s.Edges {
			if s.ByID[e.From].Kind == "adr" && s.ByID[e.To].Kind == "adr" {
				out("  A%s %s A%s", e.From, firstNonEmpty(arrow[e.Type], "-->"), e.To)
			}
		}
		return nil
	}
	for _, e := range s.Edges {
		out("%s %s %s", e.From, dim("─"+e.Type+"→"), e.To)
	}
	return nil
}

func cmdTags(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	s := adr.Load(cfg)
	if a.has("json") {
		return jsonOut(s.Tags)
	}
	keys := make([]string, 0, len(s.Tags))
	for k := range s.Tags {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return len(s.Tags[keys[i]]) > len(s.Tags[keys[j]]) })
	for _, k := range keys {
		out("%s %3d  %s", pad("#"+k, 24), len(s.Tags[k]), dim(strings.Join(s.Tags[k], " ")))
	}
	return nil
}

// Fenced blocks the renderer understands (the browser renders them; this is the list).
var builtinComponents = [][3]string{
	{"decision", "crux", "Bold decision hero: what we decided, in one line"},
	{"options", "crux", "Option cards (chosen / possible / rejected) with pros, cons and fields"},
	{"compare", "crux", "Weighted scoring matrix: heatmap plus ranked totals, winner in bold"},
	{"scenarios", "crux", "What-if grid: situations × options with ✓ ! ✗ and a short note"},
	{"proscons", "crux", "Two-column pros and cons; ~ lines are neutral notes"},
	{"tradeoff", "crux", "Sliders that show where the decision sits between two poles"},
	{"stats", "crux", "Big number tiles for key figures (load, latency, cost)"},
	{"adr", "crux", "Embedded cards for other ADRs (status, decision, link)"},
	{"flow", "answer-me-with-html", "Flowchart / architecture diagram (auto layout)"},
	{"sequence", "answer-me-with-html", "Sequence diagram between participants"},
	{"tree", "answer-me-with-html", "Hierarchy: org chart or indented list"},
	{"timeline", "answer-me-with-html", "Timeline of phases or history"},
	{"limits", "answer-me-with-html", "Values against limits as bars"},
	{"kv", "answer-me-with-html", "Key-value grid / title block"},
	{"callout", "answer-me-with-html", "Conclusion / note / warning bar"},
	{"annot", "answer-me-with-html", "Annotate parts of one sentence"},
}

func cmdComponents(a args) error {
	cfg, err := project(a, true)
	if err != nil {
		return err
	}
	for _, c := range builtinComponents {
		out("%s %s %s", bold(pad(c[0], 11)), pad(c[1], 22), c[2])
	}
	files, _ := os.ReadDir(cfg.Abs(cfg.Components))
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".mjs") || strings.HasSuffix(f.Name(), ".js") {
			out("%s %s %s", bold(pad("(project)", 11)), pad(f.Name(), 22), dim("see the Components page in crux serve"))
		}
	}
	out(dim("Any other fence language is syntax-highlighted (go, ts, sql, yaml, proto, bash, …)."))
	return nil
}

// ── decision flow ──

func cmdQ(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	q := strings.TrimSpace(strings.Join(a.pos, " "))
	if q == "" {
		return errors.New(`crux q "Which broker do we use for v1?"`)
	}
	d, err := flow.CreateDraft(cfg, adr.Load(cfg), q, a.flags["context"], a.flags["due"], "")
	if err != nil {
		return err
	}
	out("%s %s-%s draft  %s  %s", green("✓"), cfg.Prefix, d.ID, dim(d.File), dim("(private — only on your laptop)"))
	if a.has("notes") {
		s := adr.Load(cfg)
		it, err := share.OpenNotes(cfg, s.ByID[d.ID])
		if err != nil {
			return err
		}
		out("%s open for notes: %s", yellow("◐"), bold(it.URL))
	} else {
		out(dim(fmt.Sprintf(`Next: enrich it with your Claude (/crux enrich %s), or "crux notes %s" to collect notes from the room.`, d.ID, d.ID)))
	}
	return nil
}

func withAdr(a args, fn func(cfg *config.Config, s *adr.Store, d *adr.Doc) error) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	s := adr.Load(cfg)
	d, err := getAdr(cfg, s, first(a.pos))
	if err != nil {
		return err
	}
	return fn(cfg, s, d)
}

func cmdNotes(a args) error {
	return withAdr(a, func(cfg *config.Config, s *adr.Store, d *adr.Doc) error {
		switch {
		case a.has("import"):
			it, err := share.Fetch(cfg, d)
			if err != nil {
				return err
			}
			if it == nil {
				return fmt.Errorf("ADR-%s has no notes on the share server", d.ID)
			}
			var notes []flow.Note
			for _, e := range it.Entries {
				if e.Kind == "note" {
					notes = append(notes, flow.Note{ID: e.ID, By: e.By, Text: e.Text, At: e.At})
				}
			}
			n, err := flow.ImportNotes(cfg, d, notes)
			if err != nil {
				return err
			}
			out("%s %d note(s) added to \"## Notes\" in %s", green("✓"), n, d.File)
		case a.has("close"):
			if _, err := share.SetMode(cfg, d, "closed"); err != nil {
				return err
			}
			out("%s notes closed for ADR-%s", green("✓"), d.ID)
		default:
			it, err := share.OpenNotes(cfg, d)
			if err != nil {
				return err
			}
			out("%s ADR-%s open for notes — share this link in the room:\n  %s\n%s", yellow("◐"), d.ID, bold(it.URL), dim("Teammates see the question and your notes so far; nothing else from your draft."))
		}
		return nil
	})
}

func cmdShare(a args) error {
	return withAdr(a, func(cfg *config.Config, s *adr.Store, d *adr.Doc) error {
		if a.has("close") {
			if _, err := share.SetMode(cfg, d, "closed"); err != nil {
				return err
			}
			out("%s review closed for ADR-%s", green("✓"), d.ID)
			return nil
		}
		if slices.Contains([]string{"draft", "open", "proposed"}, d.StatusKey) {
			if err := flow.SetStatus(cfg, d, "In review"); err != nil {
				return err
			}
			s = adr.Load(cfg)
			d = s.ByID[d.ID]
		}
		it, err := share.ShareReview(cfg, s, d)
		if err != nil {
			return err
		}
		var asks []string
		for _, q := range it.Snapshot.Questions {
			asks = append(asks, map[bool]string{true: "@" + q.To, false: "anyone"}[q.To != ""])
		}
		out("%s ADR-%s shared for review (v%d):\n  %s", cyan("◉"), d.ID, it.Versions, bold(it.URL))
		if len(asks) > 0 {
			out("  asks: %s", strings.Join(asks, ", "))
		}
		out(dim("Re-run after edits to update what reviewers see. Their input stays."))
		return nil
	})
}

func cmdPull(a args) error {
	return withAdr(a, func(cfg *config.Config, s *adr.Store, d *adr.Doc) error {
		it, err := share.Fetch(cfg, d)
		if err != nil {
			return err
		}
		if it == nil {
			return fmt.Errorf(`ADR-%s is not shared. Run "crux share %s" or "crux notes %s"`, d.ID, d.ID, d.ID)
		}
		if a.has("json") {
			return jsonOut(it)
		}
		f, err := share.WriteDigest(cfg, d, it)
		if err != nil {
			return err
		}
		k := func(kind string) int {
			n := 0
			for _, e := range it.Entries {
				if e.Kind == kind {
					n++
				}
			}
			return n
		}
		out("%s %d entries → %s\n  picks %d · pros %d · cons %d · answers %d · comments %d · notes %d\n%s", green("✓"), len(it.Entries), bold(f), k("pick"), k("pro"), k("con"), k("answer"), k("comment"), k("note"), dim("Ask your Claude: /crux digest "+d.ID))
		return nil
	})
}

func cmdFinalize(a args) error {
	return withAdr(a, func(cfg *config.Config, s *adr.Store, d *adr.Doc) error {
		opt := a.flags["option"]
		if opt == "" {
			return fmt.Errorf(`crux finalize %s --option C [--decision "…"] [--reopen "a; b"]`, d.ID)
		}
		it, err := share.Fetch(cfg, d)
		if err != nil {
			fmt.Fprintln(os.Stderr, yellow("! share server: "+err.Error()+" — finalizing without team picks"))
			it = nil
		}
		dissent := app.Dissent(it, opt)
		decision := firstNonEmpty(a.flags["decision"], deref(d.Facts.Recommendation), "Chose option "+opt+".")
		var reopen []string
		for _, r := range strings.Split(a.flags["reopen"], ";") {
			if r = strings.TrimSpace(r); r != "" {
				reopen = append(reopen, r)
			}
		}
		if err := flow.Finalize(cfg, d, opt, decision, dissent, reopen); err != nil {
			return err
		}
		extra := ""
		if len(dissent) > 0 {
			extra += fmt.Sprintf(" · %d dissent recorded", len(dissent))
		}
		if it != nil {
			s2 := adr.Load(cfg)
			if _, err := share.PublishFinal(cfg, s2, s2.ByID[d.ID], opt, decision); err != nil {
				return err
			}
			extra += " · reviewers see the decision"
		}
		out("%s ADR-%s accepted (option %s)%s\n%s", green("✓"), d.ID, opt, extra, dim("Edited "+d.File+". Commit it when you are ready."))
		return nil
	})
}

func cmdLink(a args) error {
	cfg, err := project(a, false)
	if err != nil {
		return err
	}
	if len(a.pos) < 3 {
		return errors.New("crux link 0020 relates 0004")
	}
	changed, err := flow.Link(cfg, adr.Load(cfg), a.pos[0], a.pos[1], a.pos[2])
	if err != nil {
		return err
	}
	if len(changed) == 0 {
		out(dim("already linked"))
	} else {
		out("%s %s", green("✓"), strings.Join(changed, ", "))
	}
	return nil
}

func cmdContext(a args) error {
	cfg, err := project(a, true)
	if err != nil {
		return err
	}
	list := flow.Context(cfg, adr.Load(cfg), a.pos)
	if a.has("json") {
		return jsonOut(list)
	}
	if len(list) == 0 {
		out(dim(`No recorded decisions match. If you are about to make one, capture it: crux q "…?"`))
	}
	for _, d := range list {
		st := yellow(strings.ToUpper(d.Status))
		if d.Binding {
			st = green("ACCEPTED")
		}
		m := ""
		if len(d.Matched) > 0 {
			m = dim("  (" + strings.Join(d.Matched, ", ") + ")")
		}
		out("%s %s %s%s", bold(cfg.Prefix+"-"+d.ID), st, bold(d.Title), m)
		if d.Decision != nil {
			out("  decided: %s", *d.Decision)
		}
		if d.Leaning != nil && *d.Leaning != "" {
			out("  leaning: %s", *d.Leaning)
		} else if d.Question != nil && *d.Question != "" {
			out("  open question: %s", *d.Question)
		}
		if len(d.Rejected) > 0 {
			var r []string
			for _, x := range d.Rejected {
				s := x.Name
				if x.Why != "" {
					s += " — " + x.Why
				}
				r = append(r, s)
			}
			out("  rejected: %s", strings.Join(r, " · "))
		}
		if len(d.ReopenWhen) > 0 {
			out("  reopen when: %s", strings.Join(d.ReopenWhen, " · "))
		}
		if len(d.Links) > 0 {
			out(dim("  links: " + strings.Join(d.Links, ", ")))
		}
		out(dim("  " + d.File))
	}
	return nil
}

func cmdServer(a args) error {
	port := firstNonEmpty(a.flags["port"], os.Getenv("PORT"), "8080")
	host := firstNonEmpty(a.flags["host"], os.Getenv("HOST"), "0.0.0.0")
	return share.Serve(share.ServerOptions{
		Addr: host + ":" + port, Data: firstNonEmpty(a.flags["data"], os.Getenv("CRUX_DATA"), "./data"),
		Tokens: os.Getenv("CRUX_TOKENS"), Passcode: os.Getenv("CRUX_PASSCODE"), PublicURL: os.Getenv("CRUX_PUBLIC_URL"),
	})
}

func cmdLogin(a args) error {
	url := strings.TrimRight(first(a.pos), "/")
	if url == "" || a.flags["token"] == "" {
		return errors.New("crux login https://crux.example.com --token <token>")
	}
	handle, err := share.Whoami(url, a.flags["token"])
	if err != nil {
		return err
	}
	u := config.LoadUser()
	u.Servers[url] = config.Server{Token: a.flags["token"], Handle: handle}
	if u.Me == "" {
		u.Me = handle
	}
	if err := config.SaveUser(u); err != nil {
		return err
	}
	out("%s logged in to %s as @%s", green("✓"), url, handle)
	if cfg, err := project(a, true); err == nil && cfg.Share != url {
		out(dim("Add to crux.config.yaml:  share: " + url))
	}
	return nil
}

func cmdMe(a args) error {
	u := config.LoadUser()
	if h := first(a.pos); h != "" {
		u.Me = strings.TrimPrefix(h, "@")
		if err := config.SaveUser(u); err != nil {
			return err
		}
	}
	if u.Me == "" {
		out(dim(`not set — run "crux me <handle>" or "crux login"`))
	} else {
		out("@%s", u.Me)
	}
	return nil
}

func cmdSkill(a args) error {
	if first(a.pos) != "install" {
		return errors.New("crux skill install")
	}
	cfg, err := project(a, true)
	if err != nil {
		return err
	}
	for _, name := range []string{"crux", "answer-me-with-html"} {
		dest := filepath.Join(cfg.Root, ".claude", "skills", name)
		if _, err := os.Stat(dest); err == nil && !a.has("force") {
			out(dim("skip " + name + " (exists, --force to overwrite)"))
			continue
		}
		err := fs.WalkDir(skills.FS, name, func(p string, e fs.DirEntry, err error) error {
			if err != nil || e.IsDir() {
				return err
			}
			b, _ := fs.ReadFile(skills.FS, p)
			t := filepath.Join(cfg.Root, ".claude", "skills", filepath.FromSlash(p))
			if err := os.MkdirAll(filepath.Dir(t), 0o755); err != nil {
				return err
			}
			return os.WriteFile(t, b, 0o644)
		})
		if err != nil {
			return err
		}
		out("%s %s", green("✓"), cfg.Rel(dest))
	}
	return nil
}

// ── helpers ──

func first(xs []string) string {
	if len(xs) == 0 {
		return ""
	}
	return xs[0]
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

func today() string { return time.Now().Format("2006-01-02") }
