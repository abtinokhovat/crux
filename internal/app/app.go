// Package app is the local web app: the embedded UI, a JSON API over the project's markdown,
// live reload, the decision-flow actions, and the static export.
package app

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/abtinokhovat/crux/internal/adr"
	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/edit"
	"github.com/abtinokhovat/crux/internal/flow"
	"github.com/abtinokhovat/crux/internal/share"
	"github.com/abtinokhovat/crux/web"
)

type App struct {
	cfg     *config.Config
	mu      sync.RWMutex
	store   *adr.Store
	clients map[chan struct{}]bool
	cmu     sync.Mutex
}

func New(cfg *config.Config) *App {
	return &App{cfg: cfg, store: adr.Load(cfg), clients: map[chan struct{}]bool{}}
}

func (a *App) Store() *adr.Store {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.store
}

func (a *App) Reload() {
	s := adr.Load(a.cfg)
	a.mu.Lock()
	a.store = s
	a.mu.Unlock()
}

// ── site data ──

type ComponentFile struct {
	File string `json:"file"`
	URL  string `json:"url"`
}

func (a *App) projectComponents() []ComponentFile {
	out := []ComponentFile{}
	dir := a.cfg.Abs(a.cfg.Components)
	files, _ := os.ReadDir(dir)
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".mjs") || strings.HasSuffix(f.Name(), ".js") {
			st, _ := f.Info()
			rel := a.cfg.Rel(filepath.Join(dir, f.Name()))
			out = append(out, ComponentFile{File: f.Name(), URL: fmt.Sprintf("files/%s?v=%d", rel, st.ModTime().UnixMilli())})
		}
	}
	return out
}

func (a *App) Site(static bool) map[string]any {
	s := a.Store()
	return map[string]any{
		"title": a.cfg.Title, "prefix": a.cfg.Prefix, "digits": a.cfg.Digits, "statuses": a.cfg.Statuses, "tagInfo": a.cfg.Tags,
		"relations": adr.Relations, "adrs": s.Adrs, "docs": s.Docs, "edges": s.Edges, "tags": s.Tags, "architecture": s.Architecture,
		"problems": s.Problems, "projectComponents": a.projectComponents(), "static": static, "local": !static, "me": a.cfg.Me,
		"share": map[string]any{"url": a.cfg.Share, "loggedIn": a.cfg.ShareToken != "", "items": share.LoadState(a.cfg)},
	}
}

func docPayload(d *adr.Doc) map[string]any { return map[string]any{"meta": d, "source": d.Source} }

// ── http ──

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	switch {
	case r.Method == http.MethodPost && strings.HasPrefix(p, "/api/"):
		a.action(w, r)
	case p == "/api/site":
		writeJSON(w, 200, a.Site(false))
	case p == "/api/events":
		a.events(w, r)
	case strings.HasPrefix(p, "/api/doc/"):
		if d := a.Store().ByID[strings.TrimPrefix(p, "/api/doc/")]; d != nil {
			writeJSON(w, 200, docPayload(d))
		} else {
			writeJSON(w, 404, map[string]string{"error": "not found"})
		}
	case strings.HasPrefix(p, "/api/team/"):
		a.team(w, strings.TrimPrefix(p, "/api/team/"))
	case strings.HasPrefix(p, "/files/"):
		a.file(w, r, strings.TrimPrefix(p, "/files/"))
	default:
		serveWeb(w, r, p)
	}
}

func serveWeb(w http.ResponseWriter, r *http.Request, p string) {
	name := strings.TrimPrefix(path.Clean(p), "/")
	if name == "" || name == "." {
		name = "index.html"
	}
	b, err := fs.ReadFile(web.FS, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentType(name))
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(b)
}

func contentType(name string) string {
	if t := mime.TypeByExtension(path.Ext(name)); t != "" {
		return t
	}
	return "application/octet-stream"
}

// file serves project files (images, project components). Only inside the root.
func (a *App) file(w http.ResponseWriter, r *http.Request, rel string) {
	full := filepath.Join(a.cfg.Root, filepath.FromSlash(path.Clean("/"+rel)))
	if !strings.HasPrefix(full, a.cfg.Root+string(filepath.Separator)) {
		http.Error(w, "forbidden", 403)
		return
	}
	st, err := os.Stat(full)
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	ct := contentType(full)
	if strings.HasSuffix(full, ".mjs") {
		ct = "text/javascript; charset=utf-8"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, full)
}

func (a *App) team(w http.ResponseWriter, id string) {
	d := a.Store().ByID[id]
	if d == nil {
		writeJSON(w, 404, map[string]string{"error": "not found"})
		return
	}
	st, ok := share.LoadState(a.cfg)[d.ID]
	base := map[string]any{"configured": a.cfg.Share != "", "loggedIn": a.cfg.ShareToken != ""}
	if !ok {
		base["shared"] = nil
		writeJSON(w, 200, base)
		return
	}
	base["shared"] = st
	it, err := share.Fetch(a.cfg, d)
	if err != nil {
		base["error"] = err.Error()
	} else {
		base["item"] = it
	}
	writeJSON(w, 200, base)
}

// ── actions (local only) ──

var actionRe = regexp.MustCompile(`^/api/(new|doc/(\d+)/(keep|drop|notes|share|close|reply|import|pull|finalize|status))$`)

func (a *App) action(w http.ResponseWriter, r *http.Request) {
	// The custom header forces a CORS preflight, which other websites cannot pass.
	if r.Header.Get("X-Crux") != "1" {
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
		return
	}
	m := actionRe.FindStringSubmatch(r.URL.Path)
	if m == nil {
		writeJSON(w, 404, map[string]string{"error": "unknown action"})
		return
	}
	var body struct {
		Question, Notes, Due, Title, Entry, Kind, Text, Option, Decision, Status string
		OpenNotes                                                                bool
		Entries                                                                  []string
		Tags                                                                     map[string]string
		Reopen                                                                   []string
	}
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	_ = json.Unmarshal(b, &body)
	out, err := a.run(m[1], m[2], m[3], body.Question, body.Notes, body.Due, body.Title, body.Entry, body.Kind, body.Text, body.Option, body.Decision, body.Status, body.OpenNotes, body.Entries, body.Tags, body.Reopen)
	a.Reload()
	a.broadcast()
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, out)
}

func (a *App) run(kind, id, verb, question, notes, due, title, entry, rkind, text, option, decision, status string, openNotes bool, entries []string, tags map[string]string, reopen []string) (any, error) {
	if kind == "new" {
		dr, err := flow.CreateDraft(a.cfg, a.Store(), question, notes, due, "")
		if err != nil {
			return nil, err
		}
		res := map[string]any{"id": dr.ID, "file": dr.File, "url": nil}
		if openNotes {
			a.Reload()
			it, err := share.OpenNotes(a.cfg, a.Store().ByID[dr.ID])
			if err != nil {
				return res, err
			}
			res["url"] = it.URL
		}
		return res, nil
	}
	d := a.Store().ByID[id]
	if d == nil {
		return nil, fmt.Errorf("not found")
	}
	file := a.cfg.Abs(d.File)
	switch verb {
	case "keep", "drop":
		t, err := edit.Read(file)
		if err != nil {
			return nil, err
		}
		if verb == "keep" {
			t = edit.KeepPanel(t, title)
		} else {
			t = edit.RemovePanel(t, title)
		}
		return map[string]bool{"ok": true}, edit.Write(file, t)
	case "status":
		return map[string]bool{"ok": true}, flow.SetStatus(a.cfg, d, status)
	case "notes":
		it, err := share.OpenNotes(a.cfg, d)
		if err != nil {
			return nil, err
		}
		return map[string]string{"url": it.URL}, nil
	case "share":
		if slices.Contains([]string{"draft", "open", "proposed"}, d.StatusKey) {
			if err := flow.SetStatus(a.cfg, d, "In review"); err != nil {
				return nil, err
			}
			a.Reload()
		}
		s := a.Store()
		it, err := share.ShareReview(a.cfg, s, s.ByID[id])
		if err != nil {
			return nil, err
		}
		return map[string]string{"url": it.URL}, nil
	case "close":
		return share.SetMode(a.cfg, d, "closed")
	case "reply":
		return share.SendReply(a.cfg, d, entry, rkind, text)
	case "import":
		it, err := share.Fetch(a.cfg, d)
		if err != nil || it == nil {
			return nil, fmt.Errorf("not shared: %v", err)
		}
		want := map[string]bool{}
		for _, e := range entries {
			want[e] = true
		}
		var notes []flow.Note
		for _, e := range it.Entries {
			if e.Kind == "note" && (len(entries) == 0 || want[e.ID]) {
				notes = append(notes, flow.Note{ID: e.ID, By: e.By, Text: e.Text, At: e.At, Tag: tags[e.ID]})
			}
		}
		n, err := flow.ImportNotes(a.cfg, d, notes)
		return map[string]int{"added": n}, err
	case "pull":
		it, err := share.Fetch(a.cfg, d)
		if err != nil || it == nil {
			return nil, fmt.Errorf("not shared: %v", err)
		}
		f, err := share.WriteDigest(a.cfg, d, it)
		return map[string]string{"file": f}, err
	case "finalize":
		it, _ := share.Fetch(a.cfg, d)
		dissent := Dissent(it, option)
		if err := flow.Finalize(a.cfg, d, option, decision, dissent, reopen); err != nil {
			return nil, err
		}
		if it != nil {
			a.Reload()
			s := a.Store()
			if _, err := share.PublishFinal(a.cfg, s, s.ByID[id], option, decision); err != nil {
				return nil, err
			}
		}
		return map[string]any{"ok": true, "dissent": len(dissent)}, nil
	}
	return nil, fmt.Errorf("unknown action")
}

// Dissent: team picks for another option, with their reasons.
func Dissent(it *share.Item, option string) []flow.Dissent {
	var out []flow.Dissent
	if it == nil {
		return out
	}
	for _, e := range it.Entries {
		if e.Kind == "pick" && e.Opt != nil && *e.Opt != option {
			out = append(out, flow.Dissent{By: e.By, Opt: *e.Opt, Why: e.Text})
		}
	}
	return out
}

// ── live reload ──

func (a *App) broadcast() {
	a.cmu.Lock()
	defer a.cmu.Unlock()
	for ch := range a.clients {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (a *App) events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	ch := make(chan struct{}, 1)
	a.cmu.Lock()
	a.clients[ch] = true
	a.cmu.Unlock()
	defer func() {
		a.cmu.Lock()
		delete(a.clients, ch)
		a.cmu.Unlock()
	}()
	fmt.Fprint(w, "retry: 1000\n\n")
	fl.Flush()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ch:
			fmt.Fprintf(w, "data: {\"type\":\"reload\",\"at\":%d}\n\n", time.Now().UnixMilli())
			fl.Flush()
		}
	}
}

// watch polls the project's markdown, YAML and components and reloads on change.
func (a *App) watch() {
	sig := ""
	for {
		var parts []string
		roots := append([]string{a.cfg.Dir, a.cfg.Components, filepath.Dir(a.cfg.Architecture)}, a.cfg.Docs...)
		for _, root := range roots {
			_ = filepath.WalkDir(a.cfg.Abs(root), func(p string, e fs.DirEntry, err error) error {
				if err != nil {
					return nil
				}
				if e.IsDir() && e.Name() == "node_modules" {
					return filepath.SkipDir
				}
				if !e.IsDir() && regexp.MustCompile(`\.(md|ya?ml|m?js|json)$`).MatchString(p) {
					if st, err := e.Info(); err == nil {
						parts = append(parts, fmt.Sprintf("%s:%d:%d", p, st.ModTime().UnixNano(), st.Size()))
					}
				}
				return nil
			})
		}
		if a.cfg.File != "" {
			if st, err := os.Stat(a.cfg.File); err == nil {
				parts = append(parts, fmt.Sprint(st.ModTime().UnixNano()))
			}
		}
		sort.Strings(parts)
		next := strings.Join(parts, "|")
		if sig != "" && next != sig {
			if cfg, err := config.Load(a.cfg.Root); err == nil {
				a.mu.Lock()
				a.cfg = cfg
				a.mu.Unlock()
			}
			a.Reload()
			a.broadcast()
		}
		sig = next
		time.Sleep(700 * time.Millisecond)
	}
}

// Serve starts the local app on the first free port from port.
func Serve(cfg *config.Config, host string, port int) (*App, string, error) {
	a := New(cfg)
	var ln net.Listener
	var err error
	for p := port; p < port+20; p++ {
		if ln, err = net.Listen("tcp", fmt.Sprintf("%s:%d", host, p)); err == nil {
			break
		}
	}
	if err != nil {
		return nil, "", err
	}
	go a.watch()
	go func() { _ = http.Serve(ln, a) }()
	h := host
	if h == "0.0.0.0" {
		h = "localhost"
	}
	return a, fmt.Sprintf("http://%s:%d/", h, ln.Addr().(*net.TCPAddr).Port), nil
}

// Build writes a static site: the same UI with the API answers as files.
func Build(cfg *config.Config, out string) (int, error) {
	a := New(cfg)
	if err := os.RemoveAll(out); err != nil {
		return 0, err
	}
	err := fs.WalkDir(web.FS, ".", func(p string, e fs.DirEntry, err error) error {
		if err != nil || e.IsDir() || strings.HasSuffix(p, ".go") {
			return err
		}
		b, _ := fs.ReadFile(web.FS, p)
		return writeFile(filepath.Join(out, p), b)
	})
	if err != nil {
		return 0, err
	}
	site := a.Site(true)
	// project components travel with the site
	for _, c := range a.projectComponents() {
		rel := strings.SplitN(strings.TrimPrefix(c.URL, "files/"), "?", 2)[0]
		if b, err := os.ReadFile(cfg.Abs(rel)); err == nil {
			_ = writeFile(filepath.Join(out, "files", rel), b)
		}
	}
	b, _ := json.Marshal(site)
	if err := writeFile(filepath.Join(out, "api", "site"), b); err != nil {
		return 0, err
	}
	n := 0
	for id, d := range a.Store().ByID {
		b, _ := json.Marshal(docPayload(d))
		if err := writeFile(filepath.Join(out, "api", "doc", id), b); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func writeFile(p string, b []byte) error {
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, b, 0o644)
}
