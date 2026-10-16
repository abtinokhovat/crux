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
	"github.com/abtinokhovat/crux/internal/home"
	"github.com/abtinokhovat/crux/internal/lint"
	"github.com/abtinokhovat/crux/internal/scan"
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

var valueFlags = map[string]bool{"root": true, "port": true, "host": true, "out": true, "tags": true, "components": true, "status": true, "author": true, "tag": true, "context": true, "due": true, "option": true, "decision": true, "reopen": true, "token": true, "data": true, "agent": true, "adapters": true, "kind": true, "in": true, "dir": true, "depth": true, "id": true, "tech": true, "owner": true, "phase": true}
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
		"server": cmdServer, "login": cmdLogin, "me": cmdMe, "skill": cmdSkill, "scan": cmdScan, "extract": cmdExtract, "trace": cmdTrace, "gaps": cmdGaps,
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
		{"crux.config.yaml", "init-config.yaml"}, {"docs/system/" + adr.Slug(name) + ".md", "init-system.md"}, {".crux/template.md", "adr.md"},
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
	out("%s created\n  %s\n\nNext: %s (or describe services with %s), then %s", green("✓"), strings.Join(wrote, "\n  "), bold(`crux q "Which … ?"`), bold(`crux new service "Orders" --dir services/orders`), bold("crux serve"))
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
	flows, qs := 0, 0
	for _, e := range s.Elements {
		switch {
		case e.Kind == "flow":
			flows++
		case e.Kind == "question" && e.State != "answered":
			qs++
		}
	}
	out("%s %s  %s\n  %d ADRs · %d elements · %d flows · %d open questions · %d links · %d map boxes\n  watching %s", green("●"), bold(cfg.Title), cyan(url), len(s.Adrs), len(s.Elements), flows, qs, len(s.Links)+len(s.Edges), comps, cfg.Root)
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
	if len(a.pos) >= 2 {
		if k, ok := adr.NormKind(a.pos[0]); ok && k != "adr" && k != "doc" {
			s := adr.Load(cfg)
			file, err := flow.NewElement(cfg, s, flow.NewOpts{Kind: k, Title: strings.Join(a.pos[1:], " "), ID: a.flags["id"], In: a.flags["in"], Dir: a.flags["dir"], Tech: a.flags["tech"], Owner: a.flags["owner"], Phase: a.flags["phase"]})
			if err != nil {
				return err
			}
			if a.has("json") {
				return jsonOut(map[string]string{"kind": k, "file": file})
			}
			out("%s %s  %s", green("✓"), k, file)
			return nil
		}
	}
	if len(a.pos) > 0 && a.pos[0] == "adr" {
		a.pos = a.pos[1:]
	}
	title := strings.TrimSpace(strings.Join(a.pos, " "))
	if title == "" {
		return errors.New(`give a title: crux new "Use Kafka for domain events", or an element: crux new service "Orders" --dir services/orders`)
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
	if k := a.flags["kind"]; k != "" && k != "adr" {
		var els []*adr.Doc
		for _, e := range s.Elements {
			if k == "all" || e.Kind == k || (k == "contracts" && e.Kind == "contract") {
				els = append(els, e)
			}
		}
		if a.has("json") {
			return jsonOut(els)
		}
		if len(els) == 0 {
			out(dim("No elements of kind " + k + "."))
		}
		for _, e := range els {
			name := e.Title
			if e.Kind == "contract" {
				name = e.Name
			}
			extra := strings.Join(e.Tech, ",")
			if e.Origin == "inferred" {
				extra += " " + yellow("inferred")
			}
			out("%s %s %s %s %s", pad(e.Kind, 10), bold(pad(e.ID, 30)), pad(name, 34), dim(pad(e.File, 44)), extra)
		}
		return nil
	}
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
	if x := first(a.pos); x != "" && adr.RefID(x, cfg.Digits) == "" || s.ByID[first(a.pos)] != nil && s.ByID[first(a.pos)].Kind != "adr" {
		return printTrace(cfg, s, first(a.pos), a)
	}
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
	findings := lint.Graph(cfg, s)
	if a.has("code") {
		_, f, _ := indexed(cfg, s)
		findings = append(findings, lint.Code(cfg, s, f)...)
	}
	if !a.has("info") && !a.has("json") {
		kept := findings[:0]
		hidden := 0
		for _, f := range findings {
			if f.Level == "info" {
				hidden++
				continue
			}
			kept = append(kept, f)
		}
		defer func(n int) {
			if n > 0 {
				out(dim(fmt.Sprintf("%d info finding(s) hidden — --info to show them", n)))
			}
		}(hidden)
		findings = kept
	}
	if a.has("json") {
		return jsonOut(findings)
	}
	errs, warns := 0, 0
	for _, f := range findings {
		lvl := red("error")
		switch f.Level {
		case "warn":
			lvl = yellow("warn ")
			warns++
		case "info":
			lvl = cyan("info ")
		default:
			errs++
		}
		where := f.File
		if f.Line > 0 {
			where += fmt.Sprintf(":%d", f.Line)
		}
		if where == "" {
			where = "(code)"
			if f.Element != "" {
				where = "(" + f.Element + ", no file)"
			}
		}
		out("%s %s  %s %s", lvl, where, f.Message, dim("["+f.Rule+"]"))
		if f.Fix != "" {
			out("      %s %s", dim("fix:"), f.Fix)
		}
	}
	if len(findings) == 0 {
		out("%s %d ADRs · %d elements clean", green("✓"), len(s.Adrs), len(s.Elements))
	} else {
		out("\n%d error(s), %d warning(s)", errs, warns)
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
	s := adr.Load(cfg)
	list := flow.Context(cfg, s, a.pos)
	els, conv := flow.SystemContext(s, a.pos)
	if a.has("json") {
		return jsonOut(map[string]any{"decisions": list, "elements": els, "conventions": conv})
	}
	if len(list) == 0 && len(els) == 0 {
		out(dim(`Nothing recorded matches. If you are about to make a hard-to-reverse choice, capture it: crux q "…?"`))
	}
	for _, e := range els {
		origin := ""
		if e.Origin == "inferred" {
			origin = yellow(" (inferred — unconfirmed)")
		}
		out("%s %s %s%s %s", bold(strings.ToUpper(e.Kind)), bold(e.ID), e.Title, origin, dim("("+strings.Join(e.Matched, ", ")+")"))
		if e.Summary != "" {
			out("  %s", e.Summary)
		}
		for _, row := range [][2]any{{"exposes", e.Exposes}, {"calls", e.Calls}, {"publishes", e.Publishes}, {"consumes", e.Consumes}, {"data", e.Data}, {"flows", e.Flows}} {
			if xs := row[1].([]string); len(xs) > 0 {
				out("  %s %s", pad(row[0].(string)+":", 11), strings.Join(xs, " · "))
			}
		}
		for _, q := range e.Questions {
			out("  %s %s", yellow("open question:"), q)
		}
		out(dim("  " + e.File))
	}
	for _, c := range conv {
		out("%s %s — %s %s", cyan("CONVENTION"), bold(c.ID), firstNonEmpty(c.Summary, c.Title), dim(c.File))
	}
	if len(els) > 0 && len(list) > 0 {
		out("")
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

// skillDirs is where each coding agent looks for project skills (SKILL.md folders).
var skillDirs = map[string]string{
	"claude":   ".claude/skills",
	"codex":    ".agents/skills",
	"cursor":   ".cursor/skills",
	"gemini":   ".gemini/skills",
	"copilot":  ".github/skills",
	"opencode": ".opencode/skills",
}

var agentOrder = []string{"claude", "codex", "cursor", "gemini", "copilot", "opencode"}

func cmdSkill(a args) error {
	if first(a.pos) != "install" {
		return errors.New("crux skill install [--agent claude|codex|cursor|gemini|copilot|opencode|all] [--global] [--force]")
	}
	agents := strings.Split(firstNonEmpty(a.flags["agent"], "claude"), ",")
	if len(agents) == 1 && agents[0] == "all" {
		agents = agentOrder
	}
	for _, ag := range agents {
		if skillDirs[strings.TrimSpace(ag)] == "" {
			return fmt.Errorf("unknown agent %q (one of: %s, all)", ag, strings.Join(agentOrder, ", "))
		}
	}
	// --global puts the skills in the user's home, so they work in every repo without touching one
	root, rel := "", func(p string) string { return p }
	if a.has("global") {
		h, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		root = h
	} else {
		cfg, err := project(a, true)
		if err != nil {
			return err
		}
		root, rel = cfg.Root, cfg.Rel
	}
	seen := map[string]bool{}
	for _, ag := range agents {
		base := filepath.Join(root, filepath.FromSlash(skillDirs[strings.TrimSpace(ag)]))
		if seen[base] {
			continue
		}
		seen[base] = true
		for _, name := range []string{"crux", "crux-adopt", "crux-design", "crux-model", "crux-build", "answer-me-with-html"} {
			dest := filepath.Join(base, name)
			if _, err := os.Stat(dest); err == nil && !a.has("force") {
				out(dim("skip " + rel(dest) + " (exists, --force to overwrite)"))
				continue
			}
			err := fs.WalkDir(skills.FS, name, func(p string, e fs.DirEntry, err error) error {
				if err != nil || e.IsDir() {
					return err
				}
				b, _ := fs.ReadFile(skills.FS, p)
				t := filepath.Join(base, filepath.FromSlash(p))
				if err := os.MkdirAll(filepath.Dir(t), 0o755); err != nil {
					return err
				}
				return os.WriteFile(t, b, 0o644)
			})
			if err != nil {
				return err
			}
			out("%s %s", green("✓"), rel(dest))
		}
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

// ── system ──

func cmdScan(a args) error {
	cfg, err := project(a, true)
	if err != nil {
		return err
	}
	cat, err := adr.LoadCatalog(cfg)
	if err != nil {
		return err
	}
	var adapters []string
	if x := a.flags["adapters"]; x != "" {
		adapters = strings.Split(x, ",")
	}
	if a.has("deep") {
		if adapters == nil {
			adapters = append(adapters, cfg.Lint.Adapters...)
		}
		if len(adapters) == 0 {
			adapters = []string{"go", "ts", "infra", "extractors"}
		}
		adapters = append(adapters, "deep") // explicit: says so when the analyzer is missing
	}
	f := scan.Run(cfg, cat, adapters)
	if a.has("json") {
		return jsonOut(f)
	}
	mains := 0
	for _, m := range f.Modules {
		if m.Main {
			mains++
		}
	}
	out("%s %s  %s", bold("scan"), cfg.Root, dim("adapters: "+strings.Join(f.Adapters, ", ")))
	out("  %d modules (%d entry points) · %d routes · %d topics/queues · %d technologies · %d infra · %d schemas · %d migrations",
		len(f.Modules), mains, len(f.Routes), len(f.Topics), len(techIDs(f)), len(f.Infra), len(f.Schemas), len(f.Migrations))
	out("  %d wires · %d env reads · %d hosts · %d gRPC clients · %d tables · %d proto services · %d ingress rules · %d CODEOWNERS rules",
		len(f.Wires), len(f.Env), len(f.Hosts), len(f.Clients), len(f.Tables), len(f.Protos), len(f.Ingress), len(f.Owners))
	if len(f.Services) > 0 {
		out("\n%s", bold(fmt.Sprintf("Deployable candidates (%d)", len(f.Services))))
		for _, s := range f.Services {
			out("  %s %s %s %s", pad(s.Kind, 8), bold(pad(s.Name, 28)), pad(s.Dir, 40), dim(strings.Join(s.Evidence, ", ")))
		}
	}
	if len(f.Infra) > 0 {
		out("\n%s", bold(fmt.Sprintf("Infrastructure (%d)", len(f.Infra))))
		for _, x := range f.Infra {
			out("  %s %s %s %s", pad(x.Kind, 8), bold(pad(x.Name, 28)), pad(x.Tech, 14), dim(x.File))
		}
	}
	if ids := techIDs(f); len(ids) > 0 {
		var labels []string
		for _, id := range ids {
			if t := cat.Tech[id]; t != nil {
				labels = append(labels, t.Label)
			}
		}
		out("\n%s %s", bold("Technologies"), strings.Join(labels, " · "))
	}
	if len(f.Topics) > 0 {
		by := map[string][]string{}
		var names []string
		for _, t := range f.Topics {
			if _, ok := by[t.Name]; !ok {
				names = append(names, t.Name)
			}
			d := map[string]string{"pub": "→", "sub": "←"}[t.Dir]
			if d == "" {
				d = "·"
			}
			by[t.Name] = append(by[t.Name], d+t.Mod)
		}
		sort.Strings(names)
		out("\n%s", bold(fmt.Sprintf("Topics and queues (%d)", len(names))))
		for i, n := range names {
			if i == 40 && !a.has("all") {
				out(dim(fmt.Sprintf("  … %d more (--all)", len(names)-40)))
				break
			}
			out("  %s %s", pad(n, 40), dim(strings.Join(uniqStr(by[n]), "  ")))
		}
	}
	if len(f.Routes) > 0 {
		out("\n%s", bold(fmt.Sprintf("Routes (%d)", len(f.Routes))))
		for i, r := range f.Routes {
			if i == 30 && !a.has("all") {
				out(dim(fmt.Sprintf("  … %d more (--all)", len(f.Routes)-30)))
				break
			}
			out("  %s %s %s %s", pad(r.Kind, 7), pad(r.Method, 7), pad(r.Path, 44), dim(fmt.Sprintf("%s:%d", r.File, r.Line)))
		}
	}
	for _, p := range f.Problems {
		out(yellow("! " + p))
	}
	out(dim("\n--json for the full facts (modules, imports, evidence). The adopt skill starts from this."))
	return nil
}

// cmdExtract manages the extractors in crux's home: scripts written once for a code pattern and
// reused on every repository that matches.
func cmdExtract(a args) error {
	usage := errors.New("crux extract list | new <id> | run <id> [--json] | trust <id> | path")
	sub := first(a.pos)
	switch sub {
	case "path":
		out("%s", home.Dir())
		return nil
	case "new":
		if len(a.pos) < 2 {
			return usage
		}
		dir, err := home.Scaffold(a.pos[1])
		if err != nil {
			return err
		}
		out("created %s\n  edit manifest.yaml (when it applies) and extract.py (what it finds), then: crux extract run %s", dir, a.pos[1])
		return nil
	case "list", "":
		ms, err := home.List()
		if err != nil {
			return err
		}
		if len(ms) == 0 {
			out("no extractors in %s — crux extract new <id>", home.ExtractorsDir())
			return nil
		}
		var cfg *config.Config
		var files []string
		if c, err := project(a, false); err == nil {
			cfg = c
			files = projectFiles(c)
		}
		for _, m := range ms {
			state := "needs approval"
			if m.Trusted() {
				state = "approved"
			}
			here := ""
			if cfg != nil {
				here = "not for this repo"
				if m.Applies(cfg.Root, files) {
					here = "applies here"
				}
			}
			out("  %s %s %s  %s", bold(pad(m.ID, 24)), pad(state, 15), pad(here, 18), dim(m.Summary))
		}
		return nil
	case "trust", "run":
		if len(a.pos) < 2 {
			return usage
		}
		m, err := home.Load(filepath.Join(home.ExtractorsDir(), a.pos[1]))
		if err != nil {
			return err
		}
		if sub == "trust" {
			out("%s", dim("a script runs with your rights; review it first:"))
			out("  %s  (%s)", m.Dir, m.Run)
			if err := m.Trust(); err != nil {
				return err
			}
			out("approved %s@%s", m.ID, m.Hash())
			return nil
		}
		cfg, err := project(a, true)
		if err != nil {
			return err
		}
		if !m.Trusted() {
			return fmt.Errorf("%s is not approved in its current form — review it, then: crux extract trust %s", m.ID, m.ID)
		}
		g, err := scan.RunExtractor(cfg.Root, m)
		if err != nil {
			return err
		}
		if a.has("json") {
			return jsonOut(g)
		}
		out("%s on %s: %d topics · %d clients · %d routes · %d tech · %d observations", bold(m.ID), cfg.Root, len(g.Topics), len(g.Clients), len(g.Routes), len(g.Tech), len(g.Obs))
		return nil
	}
	return usage
}

func techIDs(f *scan.Facts) []string {
	seen := map[string]bool{}
	var ids []string
	for _, t := range f.Tech {
		if !seen[t.ID] {
			seen[t.ID] = true
			ids = append(ids, t.ID)
		}
	}
	sort.Strings(ids)
	return ids
}

func uniqStr(xs []string) []string {
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

func cmdTrace(a args) error {
	cfg, err := project(a, true)
	if err != nil {
		return err
	}
	if first(a.pos) == "" {
		return errors.New("crux trace <element or flow id>")
	}
	s := adr.Load(cfg)
	if !a.has("no-code") {
		s, _, _ = indexed(cfg, s)
	}
	return printTrace(cfg, s, first(a.pos), a)
}

// indexed adds what the code says to the model: connections, contracts, step and entity
// anchors crux finds on its own (lint.Derive), merged into the store.
func indexed(cfg *config.Config, s *adr.Store) (*adr.Store, *scan.Facts, *lint.Derived) {
	if s == nil {
		return lint.Index(cfg)
	}
	f := scan.Run(cfg, s.Catalog, nil)
	d := lint.Derive(cfg, s, f)
	lint.Merge(cfg, s, d)
	return s, f, d
}

func cmdGaps(a args) error {
	cfg, err := project(a, true)
	if err != nil {
		return err
	}
	s, f, d := indexed(cfg, adr.Load(cfg))
	gaps := lint.Gaps(cfg, s, f, d)
	if k := a.flags["kind"]; k != "" {
		kept := gaps[:0]
		for _, g := range gaps {
			if strings.HasPrefix(g.Kind, k) {
				kept = append(kept, g)
			}
		}
		gaps = kept
	}
	if el := a.flags["in"]; el != "" {
		kept := gaps[:0]
		for _, g := range gaps {
			if g.Element == el {
				kept = append(kept, g)
			}
		}
		gaps = kept
	}
	if a.has("json") {
		if gaps == nil {
			gaps = []lint.Gap{}
		}
		return jsonOut(gaps)
	}
	scanned, both := 0, 0
	for _, l := range s.Links {
		switch {
		case l.Source == "scan" && !l.Implied:
			scanned++
		case l.Source == "both":
			both++
		}
	}
	out("%s %d connections found in code (%d confirm declared ones, %d only in code) · %d gaps", bold("crux gaps"), scanned+both, both, scanned, len(gaps))
	kind := ""
	shown := 0
	for _, g := range gaps {
		if g.Kind != kind {
			kind = g.Kind
			shown = 0
			n := 0
			for _, x := range gaps {
				if x.Kind == kind {
					n++
				}
			}
			out("\n%s %s", bold(kind), dim(fmt.Sprintf("(%d)", n)))
		}
		shown++
		if shown > 12 && !a.has("all") {
			if shown == 13 {
				out(dim("  … more (--all, or --kind " + kind + ")"))
			}
			continue
		}
		where := ""
		if len(g.Evidence) > 0 {
			where = dim("  " + strings.Join(g.Evidence, ", "))
		}
		out("  %s%s", g.Message, where)
		out("    %s %s", dim("fix:"), g.Fix)
	}
	if len(gaps) == 0 {
		out("%s nothing left to connect", green("✓"))
	} else {
		out(dim("\nEach kind has a procedure in the crux skill (gaps.md). --json for agents; --kind K, --in <element> to narrow."))
	}
	return nil
}

func printTrace(cfg *config.Config, s *adr.Store, id string, a args) error {
	t, err := flow.TraceOf(cfg, s, id)
	if err != nil {
		return err
	}
	if a.has("json") {
		return jsonOut(t)
	}
	where := ""
	if len(t.Parent) > 0 {
		where = dim(" in " + strings.Join(t.Parent, " / "))
	}
	out("%s %s %s%s", bold(strings.ToUpper(t.Kind)), bold(t.ID), t.Title, where)
	if t.Summary != "" {
		out(t.Summary)
	}
	if t.Origin == "inferred" {
		out(yellow("inferred from code — not confirmed yet"))
	}
	if t.File != "" {
		out(dim(t.File))
	}
	if len(t.Tech) > 0 {
		out("tech: %s", strings.Join(t.Tech, ", "))
	}
	if len(t.Code) > 0 {
		out("code: %s", strings.Join(t.Code, ", "))
	}
	if len(t.At) > 0 {
		out("at:   %s", strings.Join(t.At, ", "))
	}
	if len(t.Steps) > 0 {
		out("\n%s", bold("Steps"))
		phase := ""
		for i, st := range t.Steps {
			if st.Phase != "" && st.Phase != phase {
				phase = st.Phase
				out("  %s", dim("== "+phase+" =="))
			}
			arrow := "→"
			if st.Async {
				arrow = "⇢"
			}
			what := strings.TrimSpace(st.Transport + " " + st.Name)
			if what == "" {
				what = st.Label
			}
			at := ""
			if st.At != "" {
				at = cyan("  @ " + st.At)
			}
			out("  %2d. %s %s %s %s  %s%s", i+1, pad(st.ID, 10), firstNonEmpty(st.FromID, st.From), arrow, firstNonEmpty(st.ToID, st.To), dim(what), at)
			for _, n := range st.Notes {
				out("        %s", dim("note: "+n))
			}
			for _, b := range st.Branches {
				at := ""
				if b.At != "" {
					at = cyan("  @ " + b.At)
				}
				out("        %s %s → %s%s", cyan("?"), b.When, b.To, at)
			}
		}
	}
	if len(t.Hops) > 0 {
		out("\n%s", bold("Connections"))
		for _, h := range t.Hops {
			arrow := "→"
			if h.Dir == "in" {
				arrow = "←"
			}
			via := ""
			if h.Via != "" {
				via = " via " + h.Via
			}
			mode := ""
			if h.Mode != "" {
				mode = " [" + h.Mode + "]"
			}
			implied := ""
			if h.Implied {
				implied = dim(" (derived)")
			}
			switch h.Source {
			case "scan":
				implied += yellow(" (in code, not declared)")
			case "both":
				implied += green(" ✓code")
			}
			if h.At != "" {
				implied += cyan("  @ " + h.At)
			}
			out("  %s %s %s %s%s%s%s", arrow, pad(h.Type, 11), pad(h.Kind, 9), h.ID, dim(via), dim(mode), implied)
		}
	}
	if len(t.Flows) > 0 {
		out("\n%s", bold("Flows"))
		for _, f := range t.Flows {
			out("  %s %s", bold(f.ID), dim(f.Title))
			for _, st := range f.Steps {
				out("    %s", st)
			}
		}
	}
	if len(t.Decisions) > 0 {
		out("\n%s", bold("Decisions"))
		for _, d := range t.Decisions {
			line := ""
			if d.Decision != nil {
				line = *d.Decision
			} else if d.Question != nil {
				line = "open: " + *d.Question
			}
			out("  %s-%s %s %s", cfg.Prefix, d.ID, d.Title, dim(line))
		}
	}
	if len(t.Questions) > 0 {
		out("\n%s", yellow("Open questions"))
		for _, q := range t.Questions {
			out("  ? %s", q)
		}
	}
	if len(t.Inside) > 0 {
		out("\n%s %s", bold("Inside"), strings.Join(t.Inside, " · "))
	}
	if len(t.Rules) > 0 {
		out("\n%s", bold("Conventions"))
		for _, r := range t.Rules {
			out("  %s", r)
		}
	}
	return nil
}

// projectFiles lists the project's files (slash paths from the root), as the scanners see them.
func projectFiles(cfg *config.Config) []string {
	var files []string
	adr.WalkProject(cfg, adr.LoadIgnore(cfg), func(abs, rel string, e os.DirEntry) { files = append(files, rel) })
	sort.Strings(files)
	return files
}
