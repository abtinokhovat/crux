package scan

import (
	"bufio"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/abtinokhovat/crux/internal/catalog"
	"github.com/abtinokhovat/crux/internal/code"
	"github.com/abtinokhovat/crux/internal/config"
)

type patterns struct {
	topics []*regexp.Regexp
	routes []*regexp.Regexp
	pubs   []*regexp.Regexp // lint.publishes: wrappers that publish
	subs   []*regexp.Regexp // lint.consumes: wrappers that consume
}

// directed returns the topics a line names through the project's own wrappers.
func (p patterns) directed(line string) (out [][2]string) {
	for d, res := range map[string][]*regexp.Regexp{"pub": p.pubs, "sub": p.subs} {
		for _, re := range res {
			for _, m := range re.FindAllStringSubmatch(line, -1) {
				if len(m) > 1 && m[1] != "" {
					out = append(out, [2]string{m[1], d})
				}
			}
		}
	}
	return out
}

func extraPatterns(cfg *config.Config) patterns {
	var p patterns
	for _, s := range cfg.Lint.Topics {
		if re, err := regexp.Compile(s); err == nil {
			p.topics = append(p.topics, re)
		}
	}
	for _, s := range cfg.Lint.Routes {
		if re, err := regexp.Compile(s); err == nil {
			p.routes = append(p.routes, re)
		}
	}
	for _, s := range cfg.Lint.Publishes {
		if re, err := regexp.Compile(s); err == nil {
			p.pubs = append(p.pubs, re)
		}
	}
	for _, s := range cfg.Lint.Consumes {
		if re, err := regexp.Compile(s); err == nil {
			p.subs = append(p.subs, re)
		}
	}
	return p
}

type goMod struct {
	dir, path string
	requires  []string
}

// A literal or an identifier (resolved through the package's string constants).
const goArg = `(?:"([^"]+)"|([A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)?))`

var (
	goRouteRe   = regexp.MustCompile(`\.(Get|Post|Put|Patch|Delete|Head|Options|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any)\(\s*"(/[^"]*)"(?:\s*,\s*([A-Za-z_][\w.]*)\s*[,)])?`)
	goHandleRe  = regexp.MustCompile(`\b(?:HandleFunc|Handle)\(\s*"([^"]+)"(?:\s*,\s*([A-Za-z_][\w.]*)\s*[,)])?`)
	goMethodsRe = regexp.MustCompile(`\.Methods\(\s*"([A-Z]+)"`)
	goGRPCRe    = regexp.MustCompile(`\bRegister(\w+)Server\(`)
	goGQLRe     = regexp.MustCompile(`handler\.NewDefaultServer\(|graphql\.MustParseSchema\(`)
	goConstRe   = regexp.MustCompile(`^\s*(?:const\s+)?([A-Za-z_]\w*)\s*(?:string\s*)?=\s*"([^"]+)"`)
	// Constants named like messaging endpoints: FooQueueName, OrderTopic, BillingExchange…
	goNamedRe   = regexp.MustCompile(`\b(?:([a-z_]\w*)\.)?([A-Za-z_]\w*?(?:QueueName|TopicName|Queue|Topic|Exchange|ExchangeName|RoutingKey|Subject|StreamName|Channel))\b`)
	goGenerated = regexp.MustCompile(`^// Code generated .* DO NOT EDIT\.$`)
	goTopicRes  = []struct {
		re   *regexp.Regexp
		dir  string
		kind string
	}{
		// kafka-go: a Message or Writer names the topic it writes, a ReaderConfig the one it reads
		{regexp.MustCompile(`\bkafka\.(?:Message|Writer)\{[^}]*?\bTopic\s*:\s*` + goArg), "pub", "topic"},
		{regexp.MustCompile(`\bReaderConfig\{[^}]*?\bTopic\s*:\s*` + goArg), "sub", "topic"},
		{regexp.MustCompile(`\bTopic\s*:\s*` + goArg), "", "topic"},
		{regexp.MustCompile(`\bTopics\s*:\s*\[\]string\{\s*` + goArg), "sub", "topic"},
		{regexp.MustCompile(`\.(?:Publish|PublishMsg|PublishMessage|Produce|ProduceSync|Emit|SendMessage)\(\s*(?:ctx\s*,\s*)?` + goArg), "pub", "topic"},
		{regexp.MustCompile(`\.(?:Subscribe|QueueSubscribe|SubscribeSync|ChanSubscribe|Consume|ConsumeMessages)\(\s*(?:ctx\s*,\s*)?` + goArg), "sub", "topic"},
		{regexp.MustCompile(`\bAddNoPublisherHandler\(\s*` + goArg + `\s*,\s*` + goArg), "sub2", "topic"},
		{regexp.MustCompile(`\bAddHandler\(\s*` + goArg + `\s*,\s*` + goArg + `\s*,\s*\w+\s*,\s*` + goArg), "watermill", "topic"},
		{regexp.MustCompile(`\basynq\.NewTask\(\s*` + goArg), "pub", "queue"},
		{regexp.MustCompile(`\bQueueDeclare\(\s*` + goArg), "", "queue"},
		{regexp.MustCompile(`\bExchangeDeclare\(\s*` + goArg), "", "topic"},
	}
)

func goAdapter(cfg *config.Config, cat *catalog.Catalog, files []string, f *Facts, extra patterns) {
	var mods []goMod
	for _, p := range files {
		if path.Base(p) == "go.mod" {
			if m := readGoMod(cfg.Abs(p)); m.path != "" {
				m.dir = path.Dir(p)
				mods = append(mods, m)
			}
		}
	}
	if len(mods) == 0 {
		return
	}
	sort.Slice(mods, func(i, j int) bool { return len(mods[i].dir) > len(mods[j].dir) })
	modFor := func(dir string) *goMod {
		for i := range mods {
			if mods[i].dir == "." || dir == mods[i].dir || strings.HasPrefix(dir, mods[i].dir+"/") {
				return &mods[i]
			}
		}
		return nil
	}
	type pkg struct {
		mod     *Module
		imports map[string]bool
		ext     map[string]bool
		files   []string
		gm      *goMod
	}
	pkgs := map[string]*pkg{}
	var order []string
	for _, p := range files {
		if !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			continue
		}
		dir := path.Dir(p)
		gm := modFor(dir)
		if gm == nil {
			continue
		}
		pk := pkgs[dir]
		if pk == nil {
			pk = &pkg{mod: &Module{Dir: dir, Lang: "go", Imports: []string{}, External: []string{}}, imports: map[string]bool{}, ext: map[string]bool{}, gm: gm}
			pkgs[dir] = pk
			order = append(order, dir)
		}
		pk.files = append(pk.files, p)
	}
	fset := token.NewFileSet()
	consts := map[string]string{} // Name and pkg.Name → value, repo-wide
	pkgConsts := map[string]map[string]string{}
	for _, dir := range order {
		pk := pkgs[dir]
		pkgConsts[dir] = map[string]string{}
		for _, p := range pk.files {
			af, err := parser.ParseFile(fset, cfg.Abs(p), nil, parser.ImportsOnly)
			if err != nil {
				continue
			}
			pk.mod.Files++
			if af.Name.Name == "main" {
				pk.mod.Main = true
			}
			if pk.mod.Name == "" {
				pk.mod.Name = af.Name.Name
			}
			for _, im := range af.Imports {
				ip, _ := strconv.Unquote(im.Path.Value)
				if strings.HasPrefix(ip, pk.gm.path+"/") || ip == pk.gm.path {
					target := path.Join(pk.gm.dir, strings.TrimPrefix(ip, pk.gm.path))
					if target != dir {
						pk.imports[target] = true
					}
					continue
				}
				first := strings.SplitN(ip, "/", 2)[0]
				if !strings.Contains(first, ".") {
					continue // standard library
				}
				pk.ext[requireOf(pk.gm, ip)] = true
				for _, id := range cat.DetectGo(ip) {
					f.Tech = append(f.Tech, TechHit{ID: id, Via: ip, Dir: dir, Evidence: p})
				}
			}
			// string constants for topic names
			if fh, err := os.Open(cfg.Abs(p)); err == nil {
				sc := bufio.NewScanner(fh)
				sc.Buffer(make([]byte, 1024*1024), 1024*1024)
				for sc.Scan() {
					if m := goConstRe.FindStringSubmatch(sc.Text()); m != nil {
						pkgConsts[dir][m[1]] = m[2]
						consts[pk.mod.Name+"."+m[1]] = m[2]
						if _, ok := consts[m[1]]; !ok {
							consts[m[1]] = m[2]
						}
					}
				}
				fh.Close()
			}
		}
	}
	resolve := func(dir, lit, ident string) string {
		if lit != "" {
			return lit
		}
		if v, ok := pkgConsts[dir][ident]; ok {
			return v
		}
		if v, ok := consts[ident]; ok {
			return v
		}
		if i := strings.LastIndex(ident, "."); i > 0 {
			if v, ok := consts[ident[i+1:]]; ok && strings.Contains(ident, ".") {
				return v
			}
		}
		return ""
	}
	for _, dir := range order {
		pk := pkgs[dir]
		for x := range pk.imports {
			if pkgs[x] != nil {
				pk.mod.Imports = append(pk.mod.Imports, x)
			}
		}
		for x := range pk.ext {
			pk.mod.External = append(pk.mod.External, x)
		}
		sort.Strings(pk.mod.Imports)
		sort.Strings(pk.mod.External)
		usesAsynq := pk.ext["github.com/hibiken/asynq"]
		from := len(f.Routes)
		for _, p := range pk.files {
			scanGoSource(cfg.Abs(p), p, dir, usesAsynq, f, extra, resolve)
		}
		if len(f.Routes) > from {
			goAnchors(cfg, pk.files, f.Routes[from:], f)
		}
		f.Modules = append(f.Modules, pk.mod)
		if pk.mod.Main {
			name := path.Base(dir)
			if name == "." || name == "cmd" {
				name = path.Base(pk.gm.path)
			}
			kind := "service"
			if regexp.MustCompile(`(?i)worker|cron|job|consumer|scheduler|migrat|batch`).MatchString(dir) {
				kind = "job"
			}
			if regexp.MustCompile(`(?i)(^|/)(cli|tools?|scripts?|playground|example|examples|hack|test|tests|e2e|bench|mocks?|seeds?|mongo_seed|fixtures?)(/|$)`).MatchString(dir) {
				kind = "app"
			}
			f.Services = append(f.Services, Candidate{Name: name, Dir: dir, Kind: kind, Lang: "go", Evidence: []string{dir + " (package main)"}})
		}
	}
}

func scanGoSource(abs, rel, dir string, asynq bool, f *Facts, extra patterns, resolve func(dir, lit, ident string) string) {
	if strings.HasSuffix(rel, ".pb.go") || strings.HasSuffix(rel, "_mock.go") || strings.HasSuffix(rel, "_mocks.go") || strings.Contains(rel, "/mocks/") || strings.Contains(rel, "/mock/") {
		return
	}
	fh, err := os.Open(abs)
	if err != nil {
		return
	}
	defer fh.Close()
	sc := bufio.NewScanner(fh)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	n := 0
	for sc.Scan() {
		n++
		line := sc.Text()
		t := strings.TrimSpace(line)
		if n < 5 && goGenerated.MatchString(t) {
			return
		}
		if strings.HasPrefix(t, "//") {
			continue
		}
		if !strings.HasPrefix(t, "func ") {
			for _, m := range goNamedRe.FindAllStringSubmatch(line, -1) {
				ident := m[2]
				if m[1] != "" {
					ident = m[1] + "." + m[2]
				}
				name := resolve(dir, "", ident)
				if name == "" || strings.ContainsAny(name, " /%") || len(name) > 100 {
					continue
				}
				low := strings.ToLower(line)
				d := ""
				switch {
				case strings.Contains(low, "publish") || strings.Contains(low, "produce") || strings.Contains(low, "send") || strings.Contains(low, "emit") || strings.Contains(low, "enqueue"):
					d = "pub"
				case strings.Contains(low, "worker") || strings.Contains(low, "consum") || strings.Contains(low, "subscri") || strings.Contains(low, "listen") || strings.Contains(low, "handle"):
					d = "sub"
				}
				kind := "topic"
				if strings.Contains(strings.ToLower(m[2]), "queue") {
					kind = "queue"
				}
				f.Topics = append(f.Topics, Topic{Name: name, Kind: kind, Dir: d, Mod: dir, File: rel, Line: n, Guess: d != ""})
			}
		}
		for _, m := range goRouteRe.FindAllStringSubmatch(line, -1) {
			method := strings.ToUpper(m[1])
			if method == "ANY" {
				method = ""
			}
			f.Routes = append(f.Routes, Route{Kind: "http", Method: method, Path: m[2], Dir: dir, File: rel, Line: n, Handler: m[3]})
		}
		for _, m := range goHandleRe.FindAllStringSubmatch(line, -1) {
			arg := m[1]
			method, p := "", arg
			if i := strings.Index(arg, " "); i > 0 && strings.ToUpper(arg[:i]) == arg[:i] {
				method, p = arg[:i], strings.TrimSpace(arg[i+1:])
			}
			if strings.HasPrefix(p, "/") {
				if mm := goMethodsRe.FindStringSubmatch(line); mm != nil && method == "" {
					method = mm[1]
				}
				f.Routes = append(f.Routes, Route{Kind: "http", Method: method, Path: p, Dir: dir, File: rel, Line: n, Handler: m[2]})
			} else if asynq {
				f.Topics = append(f.Topics, Topic{Name: arg, Kind: "queue", Dir: "sub", Mod: dir, File: rel, Line: n})
			}
		}
		for _, m := range goGRPCRe.FindAllStringSubmatch(line, -1) {
			if !strings.HasPrefix(m[1], "Unimplemented") && !strings.HasPrefix(t, "func ") {
				f.Routes = append(f.Routes, Route{Kind: "grpc", Path: m[1], Dir: dir, File: rel, Line: n})
			}
		}
		wireLine(line, dir, rel, n, goEnvRe, goClientRe, goEnvTagRe, f)
		if goGQLRe.MatchString(line) {
			f.Routes = append(f.Routes, Route{Kind: "graphql", Path: "/graphql", Dir: dir, File: rel, Line: n})
		}
		for _, tp := range goTopicRes {
			for _, m := range tp.re.FindAllStringSubmatch(line, -1) {
				guess := false
				add := func(lit, ident, d string) {
					if name := resolve(dir, lit, ident); name != "" && !strings.Contains(name, " ") && len(name) < 120 {
						f.Topics = append(f.Topics, Topic{Name: name, Kind: tp.kind, Dir: d, Mod: dir, File: rel, Line: n, Guess: guess})
					}
				}
				switch tp.dir {
				case "sub2": // AddNoPublisherHandler(name, topic, …)
					add(m[3], m[4], "sub")
				case "watermill": // AddHandler(name, inTopic, sub, outTopic, …)
					add(m[3], m[4], "sub")
					add(m[5], m[6], "pub")
				default:
					d := tp.dir
					if d == "" {
						low := strings.ToLower(line)
						switch {
						case strings.Contains(low, "writer") || strings.Contains(low, "produc") || strings.Contains(low, "publish") || strings.Contains(low, "message{"):
							d = "pub"
						case strings.Contains(low, "reader") || strings.Contains(low, "consum") || strings.Contains(low, "subscri") || strings.Contains(low, "group"):
							d = "sub"
						}
						guess = d != ""
					}
					add(m[1], m[2], d)
				}
			}
		}
		for _, re := range extra.topics {
			if m := re.FindStringSubmatch(line); len(m) > 1 && m[1] != "" {
				f.Topics = append(f.Topics, Topic{Name: m[1], Kind: "topic", Mod: dir, File: rel, Line: n})
			}
		}
		for _, x := range extra.directed(line) {
			name := resolve(dir, "", x[0]) // a constant, when the wrapper is given one
			if name == "" {
				name = x[0]
			}
			if name != "" {
				f.Topics = append(f.Topics, Topic{Name: name, Kind: "topic", Dir: x[1], Mod: dir, File: rel, Line: n})
			}
		}
		for _, re := range extra.routes {
			if m := re.FindStringSubmatch(line); len(m) > 1 {
				r := Route{Kind: "http", Path: m[len(m)-1], Dir: dir, File: rel, Line: n}
				if len(m) > 2 {
					r.Method = strings.ToUpper(m[1])
				}
				f.Routes = append(f.Routes, r)
			}
		}
	}
}

func readGoMod(p string) goMod {
	var m goMod
	b, err := os.ReadFile(p)
	if err != nil {
		return m
	}
	inReq := false
	for _, line := range strings.Split(string(b), "\n") {
		t := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(t, "module "):
			m.path = strings.Trim(strings.TrimSpace(strings.TrimPrefix(t, "module ")), `"`)
		case t == "require (":
			inReq = true
		case inReq && t == ")":
			inReq = false
		case inReq && t != "" && !strings.HasPrefix(t, "//"):
			m.requires = append(m.requires, strings.Fields(t)[0])
		case strings.HasPrefix(t, "require "):
			if fs := strings.Fields(strings.TrimPrefix(t, "require ")); len(fs) > 0 {
				m.requires = append(m.requires, fs[0])
			}
		}
	}
	return m
}

// requireOf maps an import path to the required module that provides it (longest prefix).
func requireOf(m *goMod, ip string) string {
	best := ""
	for _, r := range m.requires {
		if (ip == r || strings.HasPrefix(ip, r+"/")) && len(r) > len(best) {
			best = r
		}
	}
	if best == "" {
		return ip
	}
	return best
}

// GRPCImpl: a Go type that serves a gRPC service — it embeds Unimplemented<Service>Server.
type GRPCImpl struct {
	Service string            `json:"service"`
	Type    string            `json:"type"`
	Dir     string            `json:"dir"`
	At      string            `json:"at"`      // the type: path#Type
	Methods map[string]string `json:"methods"` // rpc name → path#Type.Method
}

// goAnchors finds, in one package, the functions registered as HTTP handlers and the types that
// implement registered gRPC services, and anchors the routes to them.
func goAnchors(cfg *config.Config, files []string, routes []Route, f *Facts) {
	syms := map[string]map[string]code.Span{} // file → symbols
	for _, p := range files {
		if s, err := code.FileSymbols(cfg.Abs(p)); err == nil {
			syms[p] = s
		}
	}
	// find one symbol across the package: an exact top-level name, else the only method with it
	find := func(name string, methodsOnly bool) string {
		var hits []string
		for _, p := range files {
			for k := range syms[p] {
				if (!methodsOnly && k == name) || strings.HasSuffix(k, "."+name) {
					hits = append(hits, p+"#"+k)
				}
			}
		}
		if len(hits) == 1 {
			return hits[0]
		}
		return ""
	}
	for i := range routes {
		r := &routes[i]
		if r.Handler == "" || r.Handler == "nil" {
			continue
		}
		if !strings.Contains(r.Handler, ".") {
			r.At = find(r.Handler, false)
		} else {
			r.At = find(r.Handler[strings.LastIndex(r.Handler, ".")+1:], true) // h.Create: a method value
		}
	}
	served := map[string]bool{}
	for _, r := range routes {
		if r.Kind == "grpc" {
			served[r.Path] = true
		}
	}
	if len(served) == 0 {
		return
	}
	fset := token.NewFileSet()
	for _, p := range files {
		af, err := parser.ParseFile(fset, cfg.Abs(p), nil, parser.SkipObjectResolution)
		if err != nil {
			continue
		}
		for _, d := range af.Decls {
			g, ok := d.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, sp := range g.Specs {
				ts, ok := sp.(*ast.TypeSpec)
				if !ok {
					continue
				}
				st, ok := ts.Type.(*ast.StructType)
				if !ok {
					continue
				}
				for _, fld := range st.Fields.List {
					if len(fld.Names) > 0 {
						continue
					}
					name := ""
					switch x := fld.Type.(type) {
					case *ast.SelectorExpr:
						name = x.Sel.Name
					case *ast.Ident:
						name = x.Name
					case *ast.StarExpr:
						if sel, ok := x.X.(*ast.SelectorExpr); ok {
							name = sel.Sel.Name
						}
					}
					svc := strings.TrimSuffix(strings.TrimPrefix(name, "Unimplemented"), "Server")
					if !strings.HasPrefix(name, "Unimplemented") || !served[svc] {
						continue
					}
					impl := GRPCImpl{Service: svc, Type: ts.Name.Name, Dir: path.Dir(p), At: p + "#" + ts.Name.Name, Methods: map[string]string{}}
					for _, q := range files {
						for k := range syms[q] {
							if strings.HasPrefix(k, ts.Name.Name+".") {
								impl.Methods[strings.TrimPrefix(k, ts.Name.Name+".")] = q + "#" + k
							}
						}
					}
					f.GRPCImpls = append(f.GRPCImpls, impl)
					for i := range routes {
						if routes[i].Kind == "grpc" && routes[i].Path == svc {
							routes[i].At = impl.At
						}
					}
				}
			}
		}
	}
}
