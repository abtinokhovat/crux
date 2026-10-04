// Package share is the team side of the flow: a small server for meeting notes and review,
// and the client the CLI and the local app use to publish and read.
//
// Owners (token) publish a question or a review snapshot; teammates (team passcode) add notes,
// comments, pros/cons with reasons, answers and picks. Storage: one JSON file per item.
package share

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/abtinokhovat/crux/web"
)

type Option struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

type Question struct {
	To   string `json:"to"`
	Text string `json:"text"`
}

type Ref struct {
	Title     string `json:"title"`
	Status    string `json:"status"`
	StatusKey string `json:"statusKey"`
}

type Leaning struct {
	Opt string `json:"opt"`
	Why string `json:"why"`
}

// Snapshot is what reviewers see: the ADR markdown plus what the page needs to render it.
type Snapshot struct {
	Source    string         `json:"source"`
	StatusKey string         `json:"statusKey"`
	Prefix    string         `json:"prefix"`
	Digits    int            `json:"digits"`
	Refs      map[string]Ref `json:"refs"`
	Options   []Option       `json:"options"`
	Questions []Question     `json:"questions"`
	Leaning   *Leaning       `json:"leaning"`
	At        string         `json:"at"`
}

type Final struct {
	Option   string `json:"option"`
	Decision string `json:"decision"`
	At       string `json:"at"`
}

type Reply struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
	At   string `json:"at"`
}

type Entry struct {
	ID     string  `json:"id"`
	Kind   string  `json:"kind"`
	By     string  `json:"by"`
	Text   string  `json:"text"`
	Why    string  `json:"why"`
	Opt    *string `json:"opt"`
	Target *string `json:"target"`
	Conf   *int    `json:"conf,omitempty"`
	At     string  `json:"at"`
	Reply  *Reply  `json:"reply"`
}

type AdrRef struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

type Item struct {
	Slug      string    `json:"slug"`
	Owner     string    `json:"owner"`
	Repo      string    `json:"repo"`
	Adr       AdrRef    `json:"adr"`
	Mode      string    `json:"mode"`
	Question  string    `json:"question"`
	Context   string    `json:"context"`
	Snapshot  *Snapshot `json:"snapshot"`
	Final     *Final    `json:"final"`
	Entries   []Entry   `json:"entries"`
	Versions  int       `json:"versions"`
	CreatedAt string    `json:"createdAt"`
	UpdatedAt string    `json:"updatedAt"`
	URL       string    `json:"url,omitempty"`
}

var kinds = map[string][]string{"notes": {"note"}, "review": {"comment", "pro", "con", "answer", "pick"}}

const (
	maxBody = 4 << 20
	maxText = 4000
	perMin  = 40
)

type ServerOptions struct {
	Addr      string
	Data      string
	Tokens    string // "handle:token,handle2:token2"
	Passcode  string
	PublicURL string
}

type server struct {
	opt    ServerOptions
	dir    string
	owners map[string]string // token → handle
	cookie string
	mu     sync.Mutex
	subs   map[string]map[chan string]bool
	hits   map[string][]time.Time
}

// ParseTokens reads "handle:token,…".
func ParseTokens(s string) map[string]string {
	out := map[string]string{}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if i := strings.Index(part, ":"); i > 0 {
			out[part[i+1:]] = part[:i]
		}
	}
	return out
}

func NewServer(opt ServerOptions) (http.Handler, []string, error) {
	s := &server{opt: opt, dir: filepath.Join(opt.Data, "items"), owners: ParseTokens(opt.Tokens), subs: map[string]map[chan string]bool{}, hits: map[string][]time.Time{}}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, nil, err
	}
	if opt.Passcode != "" {
		h := hmac.New(sha256.New, []byte("crux-share:"+opt.Tokens))
		h.Write([]byte(opt.Passcode))
		s.cookie = hex.EncodeToString(h.Sum(nil))
	}
	var handles []string
	for _, h := range s.owners {
		handles = append(handles, h)
	}
	slices.Sort(handles)
	return s, handles, nil
}

// ── storage ──

var slugRe = regexp.MustCompile(`^[a-z0-9]{6,40}$`)

func (s *server) path(slug string) string { return filepath.Join(s.dir, slug+".json") }

func (s *server) load(slug string) *Item {
	if !slugRe.MatchString(slug) {
		return nil
	}
	b, err := os.ReadFile(s.path(slug))
	if err != nil {
		return nil
	}
	var it Item
	if json.Unmarshal(b, &it) != nil {
		return nil
	}
	return &it
}

func (s *server) save(it *Item) error {
	it.UpdatedAt = now()
	b, _ := json.MarshalIndent(it, "", " ")
	tmp := s.path(it.Slug) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path(it.Slug))
}

func (s *server) all() []*Item {
	var out []*Item
	files, _ := os.ReadDir(s.dir)
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".json") {
			if it := s.load(strings.TrimSuffix(f.Name(), ".json")); it != nil {
				out = append(out, it)
			}
		}
	}
	return out
}

// ── live updates ──

func (s *server) notify(slug, typ string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subs[slug] {
		select {
		case ch <- typ:
		default:
		}
	}
}

// ── auth ──

func (s *server) ownerOf(r *http.Request) string {
	t := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if t == "" {
		return ""
	}
	for tok, h := range s.owners {
		if subtle.ConstantTimeCompare([]byte(tok), []byte(t)) == 1 {
			return h
		}
	}
	return ""
}

func (s *server) isTeam(r *http.Request) bool {
	if s.opt.Passcode == "" || s.ownerOf(r) != "" {
		return true
	}
	if c, err := r.Cookie("crux_team"); err == nil && subtle.ConstantTimeCompare([]byte(c.Value), []byte(s.cookie)) == 1 {
		return true
	}
	return subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Crux-Passcode")), []byte(s.opt.Passcode)) == 1
}

func clientIP(r *http.Request) string {
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		return strings.TrimSpace(strings.Split(f, ",")[0])
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}

func (s *server) limited(r *http.Request) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	ip, t := clientIP(r), time.Now()
	var w []time.Time
	for _, h := range s.hits[ip] {
		if t.Sub(h) < time.Minute {
			w = append(w, h)
		}
	}
	w = append(w, t)
	s.hits[ip] = w
	return len(w) > perMin
}

// ── helpers ──

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func newID(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func clean(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		s = string(r[:n])
	}
	return s
}

var handleRe = regexp.MustCompile(`[^\w.-]`)

func handle(s string) string {
	return handleRe.ReplaceAllString(strings.TrimPrefix(clean(s, 40), "@"), "")
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	b, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		return err
	}
	if len(b) > maxBody {
		return errors.New("too large")
	}
	if len(b) == 0 {
		return nil
	}
	return json.Unmarshal(b, v)
}

func (s *server) base(r *http.Request) string {
	if s.opt.PublicURL != "" {
		return strings.TrimRight(s.opt.PublicURL, "/")
	}
	proto := r.Header.Get("X-Forwarded-Proto")
	if proto == "" {
		proto = "http"
	}
	return proto + "://" + r.Host
}

// ── publish payload ──

type publish struct {
	Repo     string    `json:"repo"`
	Adr      *AdrRef   `json:"adr"`
	Mode     string    `json:"mode"`
	Question *string   `json:"question"`
	Context  *string   `json:"context"`
	Snapshot *Snapshot `json:"snapshot"`
	Final    *Final    `json:"final"`
}

func (p *publish) apply(it *Item) {
	if p.Adr != nil {
		it.Adr = AdrRef{clean(p.Adr.ID, 20), clean(p.Adr.Title, 300), clean(p.Adr.Status, 40)}
	}
	if p.Mode != "" {
		if slices.Contains([]string{"notes", "review", "closed", "final"}, p.Mode) {
			it.Mode = p.Mode
		} else {
			it.Mode = "closed"
		}
	}
	if p.Question != nil {
		it.Question = clean(*p.Question, 1000)
	}
	if p.Context != nil {
		it.Context = clean(*p.Context, 20000)
	}
	if p.Snapshot != nil {
		sn := *p.Snapshot
		if len(sn.Source) > 2_000_000 {
			sn.Source = sn.Source[:2_000_000]
		}
		if len(sn.Options) > 26 {
			sn.Options = sn.Options[:26]
		}
		if len(sn.Questions) > 50 {
			sn.Questions = sn.Questions[:50]
		}
		for i := range sn.Questions {
			sn.Questions[i].To = strings.TrimPrefix(clean(sn.Questions[i].To, 40), "@")
			sn.Questions[i].Text = clean(sn.Questions[i].Text, 1000)
		}
		sn.At = now()
		it.Snapshot = &sn
		it.Versions++
	}
	if p.Final != nil {
		it.Final = &Final{clean(p.Final.Option, 4), clean(p.Final.Decision, 4000), now()}
	}
}

// ── routes ──

var itemRoute = regexp.MustCompile(`^/api/items/([a-z0-9]+)(?:/(entries|events)(?:/([a-z0-9]+)(?:/(reply))?)?)?$`)

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	p := r.URL.Path
	switch {
	case p == "/healthz":
		writeJSON(w, 200, map[string]bool{"ok": true})
		return
	case strings.HasPrefix(p, "/assets/"):
		s.asset(w, r, strings.TrimPrefix(p, "/assets/"))
		return
	case p == "/":
		page(w, pageOpts{Landing: true})
		return
	case p == "/api/login" && r.Method == http.MethodPost:
		var b struct{ Passcode string }
		_ = readJSON(r, &b)
		if s.opt.Passcode == "" || subtle.ConstantTimeCompare([]byte(b.Passcode), []byte(s.opt.Passcode)) != 1 {
			fail(w, 403, "wrong passcode")
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "crux_team", Value: s.cookie, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 31536000, Secure: strings.HasPrefix(s.base(r), "https")})
		writeJSON(w, 200, map[string]bool{"ok": true})
		return
	case p == "/api/me":
		if me := s.ownerOf(r); me != "" {
			writeJSON(w, 200, map[string]string{"handle": me})
		} else {
			fail(w, 401, "bad token")
		}
		return
	case strings.HasPrefix(p, "/i/"):
		slug := strings.TrimPrefix(p, "/i/")
		if s.load(slug) == nil {
			w.WriteHeader(404)
			page(w, pageOpts{Missing: true})
			return
		}
		page(w, pageOpts{Slug: slug, NeedPass: !s.isTeam(r)})
		return
	case p == "/api/items" && r.Method == http.MethodGet:
		me := s.ownerOf(r)
		if me == "" {
			fail(w, 401, "token required")
			return
		}
		list := []map[string]any{}
		for _, it := range s.all() {
			if it.Owner == me {
				list = append(list, map[string]any{"slug": it.Slug, "adr": it.Adr, "mode": it.Mode, "repo": it.Repo, "entries": len(it.Entries), "updatedAt": it.UpdatedAt, "url": s.base(r) + "/i/" + it.Slug})
			}
		}
		writeJSON(w, 200, list)
		return
	case p == "/api/items" && r.Method == http.MethodPost:
		me := s.ownerOf(r)
		if me == "" {
			fail(w, 401, "token required")
			return
		}
		var b publish
		if err := readJSON(r, &b); err != nil {
			fail(w, 400, err.Error())
			return
		}
		repo := clean(b.Repo, 200)
		var it *Item
		for _, x := range s.all() {
			if x.Owner == me && x.Repo == repo && b.Adr != nil && x.Adr.ID == b.Adr.ID {
				it = x
				break
			}
		}
		if it == nil {
			it = &Item{Slug: newID(8), Owner: me, Repo: repo, CreatedAt: now(), Entries: []Entry{}, Mode: "closed"}
		}
		b.apply(it)
		if err := s.save(it); err != nil {
			fail(w, 500, err.Error())
			return
		}
		s.notify(it.Slug, "item")
		it.URL = s.base(r) + "/i/" + it.Slug
		writeJSON(w, 200, it)
		return
	}
	m := itemRoute.FindStringSubmatch(p)
	if m == nil {
		fail(w, 404, "not found")
		return
	}
	slug, sub, eid, reply := m[1], m[2], m[3], m[4]
	it := s.load(slug)
	if it == nil {
		fail(w, 404, "not found")
		return
	}
	me := s.ownerOf(r)
	isOwner := me != "" && me == it.Owner
	switch {
	case sub == "" && r.Method == http.MethodGet:
		if !s.isTeam(r) {
			fail(w, 403, "passcode required")
			return
		}
		writeJSON(w, 200, it)
	case sub == "" && r.Method == http.MethodPatch:
		if !isOwner {
			fail(w, 403, "owner only")
			return
		}
		var b publish
		if err := readJSON(r, &b); err != nil {
			fail(w, 400, err.Error())
			return
		}
		b.apply(it)
		_ = s.save(it)
		s.notify(slug, "item")
		writeJSON(w, 200, it)
	case sub == "events":
		if !s.isTeam(r) {
			fail(w, 403, "passcode required")
			return
		}
		s.events(w, r, slug)
	case sub == "entries" && eid == "" && r.Method == http.MethodPost:
		s.addEntry(w, r, it)
	case sub == "entries" && reply != "" && r.Method == http.MethodPost:
		if !isOwner {
			fail(w, 403, "owner only")
			return
		}
		var b struct{ Kind, Text string }
		_ = readJSON(r, &b)
		for i := range it.Entries {
			if it.Entries[i].ID == eid {
				k := clean(b.Kind, 20)
				if k == "" {
					k = "replied"
				}
				it.Entries[i].Reply = &Reply{k, clean(b.Text, maxText), now()}
				_ = s.save(it)
				s.notify(slug, "entry")
				writeJSON(w, 200, it.Entries[i])
				return
			}
		}
		fail(w, 404, "no entry")
	case sub == "entries" && eid != "" && r.Method == http.MethodDelete:
		if !isOwner {
			fail(w, 403, "owner only")
			return
		}
		it.Entries = slices.DeleteFunc(it.Entries, func(e Entry) bool { return e.ID == eid })
		_ = s.save(it)
		s.notify(slug, "item")
		writeJSON(w, 200, map[string]bool{"ok": true})
	default:
		fail(w, 405, "method not allowed")
	}
}

func (s *server) addEntry(w http.ResponseWriter, r *http.Request, it *Item) {
	if !s.isTeam(r) {
		fail(w, 403, "passcode required")
		return
	}
	if s.limited(r) {
		fail(w, 429, "slow down")
		return
	}
	var b struct {
		Kind, By, Text, Why, Opt, Target string
		Conf                             float64
	}
	if err := readJSON(r, &b); err != nil {
		fail(w, 400, err.Error())
		return
	}
	if !slices.Contains(kinds[it.Mode], b.Kind) {
		if it.Mode == "final" {
			fail(w, 409, "this decision is closed")
		} else {
			fail(w, 409, fmt.Sprintf("“%s” is not open right now", b.Kind))
		}
		return
	}
	by := handle(b.By)
	if by == "" {
		fail(w, 400, "name required")
		return
	}
	e := Entry{ID: newID(5), Kind: b.Kind, By: by, Text: clean(b.Text, maxText), Why: clean(b.Why, maxText), At: now()}
	if b.Kind == "pro" || b.Kind == "con" {
		if e.Why == "" {
			fail(w, 400, "a reason is required")
			return
		}
	}
	if b.Kind == "pro" || b.Kind == "con" || b.Kind == "pick" {
		ok := false
		if it.Snapshot != nil {
			for _, o := range it.Snapshot.Options {
				ok = ok || o.Key == b.Opt
			}
		}
		if !ok {
			fail(w, 400, "unknown option")
			return
		}
		opt := clean(b.Opt, 4)
		e.Opt = &opt
	}
	if t := clean(b.Target, 200); t != "" {
		e.Target = &t
	}
	if b.Kind == "pick" {
		c := int(math.Max(0, math.Min(100, b.Conf)))
		e.Conf = &c
		it.Entries = slices.DeleteFunc(it.Entries, func(x Entry) bool { return x.Kind == "pick" && x.By == by })
	} else if e.Text == "" {
		fail(w, 400, "text required")
		return
	}
	it.Entries = append(it.Entries, e)
	if err := s.save(it); err != nil {
		fail(w, 500, err.Error())
		return
	}
	s.notify(it.Slug, "entry")
	writeJSON(w, 200, e)
}

func (s *server) events(w http.ResponseWriter, r *http.Request, slug string) {
	fl, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	ch := make(chan string, 8)
	s.mu.Lock()
	if s.subs[slug] == nil {
		s.subs[slug] = map[chan string]bool{}
	}
	s.subs[slug][ch] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.subs[slug], ch)
		s.mu.Unlock()
	}()
	fmt.Fprint(w, "retry: 2000\n\n")
	fl.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case t := <-ch:
			fmt.Fprintf(w, "data: {\"type\":%q}\n\n", t)
			fl.Flush()
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		}
	}
}

func (s *server) asset(w http.ResponseWriter, r *http.Request, name string) {
	// shared with the local app: app.css and the renderer; the share page's own files: share.css, *.js
	src, f := fs.FS(web.FS), ""
	switch name {
	case "app.css":
		f = "app.css"
	case "crux-render.js":
		f = "vendor/crux-render.js"
	case "share.css", "review.js", "gate.js":
		src, f = assets, "assets/"+name
	default:
		http.NotFound(w, r)
		return
	}
	b, err := fs.ReadFile(src, f)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ct := "text/css; charset=utf-8"
	if strings.HasSuffix(f, ".js") {
		ct = "text/javascript; charset=utf-8"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(b)
}

// Serve runs the share server until it fails.
func Serve(opt ServerOptions) error {
	h, owners, err := NewServer(opt)
	if err != nil {
		return err
	}
	if len(owners) == 0 {
		log.Println("! CRUX_TOKENS is empty: nobody can publish. Set CRUX_TOKENS=\"handle:token\".")
	}
	srv := &http.Server{Addr: opt.Addr, Handler: h, ReadHeaderTimeout: 10 * time.Second}
	fmt.Printf("● crux share server on %s · owners: %s · passcode: %v\n", opt.Addr, strings.Join(owners, ", "), opt.Passcode != "")
	return srv.ListenAndServe()
}
