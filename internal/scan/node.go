package scan

import (
	"bufio"
	"encoding/json"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/abtinokhovat/crux/internal/catalog"
	"github.com/abtinokhovat/crux/internal/code"
	"github.com/abtinokhovat/crux/internal/config"
)

type pkgJSON struct {
	Name            string            `json:"name"`
	Main            string            `json:"main"`
	Bin             any               `json:"bin"`
	Scripts         map[string]string `json:"scripts"`
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
	Workspaces      any               `json:"workspaces"`
}

var (
	tsImportRe  = regexp.MustCompile(`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]`)
	tsRouteRe   = regexp.MustCompile(`\b(?:app|router|server|api|r|routes|fastify|instance|hono)\.(get|post|put|patch|delete|head|options|all)\(\s*['"\x60]([^'"\x60]+)['"\x60](?:\s*,\s*([A-Za-z_$][\w$.]*)\s*[,)])?`)
	tsRouteObj  = regexp.MustCompile(`\.route\(\s*\{[^}]*method:\s*['"](\w+)['"][^}]*url:\s*['"]([^'"]+)['"]`)
	tsNestCtl   = regexp.MustCompile(`@Controller\(\s*['"]?([^'")]*)['"]?\s*\)`)
	tsNestRoute = regexp.MustCompile(`@(Get|Post|Put|Patch|Delete|Head|Options|All)\(\s*['"]?([^'")]*)['"]?\s*\)`)
	tsNestMsg   = regexp.MustCompile(`@(MessagePattern|EventPattern)\(\s*['"]([^'"]+)['"]`)
	tsTopicRes  = []struct {
		re   *regexp.Regexp
		dir  string
		kind string
	}{
		// kafkajs: consumer.subscribe({ topic(s) }) reads, producer.send({ topic }) writes
		{regexp.MustCompile(`\.subscribe\(\s*\{\s*topics?\s*:\s*\[?\s*['"]([^'"]+)['"]`), "sub", "topic"},
		{regexp.MustCompile(`\.send(?:Batch)?\(\s*\{\s*topic\s*:\s*['"]([^'"]+)['"]`), "pub", "topic"},
		{regexp.MustCompile(`\btopics?\s*:\s*\[?\s*['"]([^'"]+)['"]`), "", "topic"},
		{regexp.MustCompile(`\.(?:publish|produce|emit|sendMessage)\(\s*['"]([^'"]+)['"]`), "pub", "topic"},
		{regexp.MustCompile(`\.(?:subscribe|consume|on)\(\s*['"]([a-z][\w.:-]*[.:][\w.:-]+)['"]`), "sub", "topic"},
		{regexp.MustCompile(`new\s+Queue\(\s*['"]([^'"]+)['"]`), "pub", "queue"},
		{regexp.MustCompile(`new\s+Worker\(\s*['"]([^'"]+)['"]`), "sub", "queue"},
		{regexp.MustCompile(`\bQueueUrl\s*:\s*['"]([^'"]+)['"]`), "", "queue"},
		{regexp.MustCompile(`\bassertQueue\(\s*['"]([^'"]+)['"]`), "", "queue"},
		{regexp.MustCompile(`\bassertExchange\(\s*['"]([^'"]+)['"]`), "", "topic"},
	}
	serverDeps = []string{"express", "fastify", "@nestjs/core", "hono", "koa", "@hapi/hapi", "next", "nuxt", "@sveltejs/kit", "@remix-run/node", "@trpc/server", "@apollo/server", "graphql-yoga"}
	appDeps    = []string{"react", "vue", "svelte", "@angular/core", "react-native", "expo"}
)

func tsAdapter(cfg *config.Config, cat *catalog.Catalog, files []string, f *Facts, extra patterns) {
	type tsPkg struct {
		mod   *Module
		pj    pkgJSON
		deps  map[string]bool
		files []string
	}
	pkgs := map[string]*tsPkg{}
	names := map[string]string{} // npm name → dir
	var dirs []string
	for _, p := range files {
		if path.Base(p) != "package.json" {
			continue
		}
		b, err := os.ReadFile(cfg.Abs(p))
		if err != nil {
			continue
		}
		var pj pkgJSON
		if json.Unmarshal(b, &pj) != nil {
			continue
		}
		dir := path.Dir(p)
		deps := map[string]bool{}
		for d := range pj.Dependencies {
			deps[d] = true
		}
		for d := range pj.DevDependencies {
			deps[d] = true
		}
		name := pj.Name
		if name == "" {
			name = path.Base(dir)
		}
		pkgs[dir] = &tsPkg{mod: &Module{Dir: dir, Name: name, Lang: "ts", Imports: []string{}, External: []string{}}, pj: pj, deps: deps}
		names[name] = dir
		dirs = append(dirs, dir)
	}
	if len(pkgs) == 0 {
		return
	}
	sort.Slice(dirs, func(i, j int) bool { return len(dirs[i]) > len(dirs[j]) })
	pkgOf := func(file string) *tsPkg {
		for _, d := range dirs {
			if d == "." || strings.HasPrefix(file, d+"/") {
				return pkgs[d]
			}
		}
		return nil
	}
	for _, p := range files {
		ext := path.Ext(p)
		if ext != ".ts" && ext != ".tsx" && ext != ".js" && ext != ".mjs" && ext != ".cjs" && ext != ".jsx" && ext != ".mts" {
			continue
		}
		if strings.HasSuffix(p, ".d.ts") || strings.Contains(p, ".test.") || strings.Contains(p, ".spec.") {
			continue
		}
		pk := pkgOf(p)
		if pk == nil {
			continue
		}
		pk.mod.Files++
		pk.files = append(pk.files, p)
		scanTSSource(cfg.Abs(p), p, pk.mod, names, f, extra)
	}
	for _, d := range dirs {
		var rs []int
		for i := range f.Routes {
			if f.Routes[i].Dir == d && f.Routes[i].Handler != "" {
				rs = append(rs, i)
			}
		}
		if len(rs) > 0 {
			sub := make([]Route, len(rs))
			for j, i := range rs {
				sub[j] = f.Routes[i]
			}
			tsAnchors(cfg, pkgs[d].files, sub)
			for j, i := range rs {
				f.Routes[i] = sub[j]
			}
		}
	}
	for _, d := range dirs {
		pk := pkgs[d]
		for dep := range pk.deps {
			if other, ok := names[dep]; ok && other != d {
				pk.mod.Imports = append(pk.mod.Imports, other)
				continue
			}
			if pk.pj.Dependencies[dep] != "" {
				pk.mod.External = append(pk.mod.External, dep)
			}
			for _, id := range cat.DetectNpm(dep) {
				f.Tech = append(f.Tech, TechHit{ID: id, Via: dep, Dir: d, Evidence: path.Join(d, "package.json")})
			}
		}
		pk.mod.Imports = uniq(pk.mod.Imports)
		sort.Strings(pk.mod.Imports)
		sort.Strings(pk.mod.External)
		has := func(list []string) bool {
			for _, x := range list {
				if pk.deps[x] {
					return true
				}
			}
			return false
		}
		_, hasStart := pk.pj.Scripts["start"]
		if has(serverDeps) || (hasStart && pk.mod.Files > 0 && pk.pj.Workspaces == nil) {
			pk.mod.Main = true
			kind := "service"
			if has(appDeps) && !pk.deps["express"] && !pk.deps["fastify"] && !pk.deps["@nestjs/core"] {
				kind = "app"
			}
			if pk.deps["next"] || pk.deps["nuxt"] || pk.deps["@sveltejs/kit"] {
				kind = "app"
			}
			f.Services = append(f.Services, Candidate{Name: shortName(pk.mod.Name), Dir: d, Kind: kind, Lang: "ts", Evidence: []string{path.Join(d, "package.json")}})
		} else if has(appDeps) && pk.pj.Workspaces == nil {
			f.Services = append(f.Services, Candidate{Name: shortName(pk.mod.Name), Dir: d, Kind: "app", Lang: "ts", Evidence: []string{path.Join(d, "package.json")}})
		}
		f.Modules = append(f.Modules, pk.mod)
	}
}

func shortName(n string) string {
	if i := strings.LastIndex(n, "/"); i >= 0 {
		return n[i+1:]
	}
	return n
}

func scanTSSource(abs, rel string, mod *Module, names map[string]string, f *Facts, extra patterns) {
	fh, err := os.Open(abs)
	if err != nil {
		return
	}
	defer fh.Close()
	sc := bufio.NewScanner(fh)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	prefix := ""
	n := 0
	dir := mod.Dir
	// Next.js app router: app/**/route.ts serves the folder path; pages/api/** too.
	if base := path.Base(rel); strings.HasPrefix(base, "route.") {
		if i := strings.Index(rel, "/app/"); i >= 0 || strings.HasPrefix(rel, "app/") {
			p := rel[strings.Index(rel, "app/")+3 : len(rel)-len(base)-1]
			f.Routes = append(f.Routes, Route{Kind: "http", Path: nextPath(p), Dir: dir, File: rel, Line: 1})
		}
	} else if i := strings.Index(rel, "pages/api/"); i >= 0 {
		p := strings.TrimSuffix(rel[i+len("pages"):], path.Ext(rel))
		f.Routes = append(f.Routes, Route{Kind: "http", Path: nextPath(strings.TrimSuffix(p, "/index")), Dir: dir, File: rel, Line: 1})
	}
	for sc.Scan() {
		n++
		line := sc.Text()
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "//") || strings.HasPrefix(t, "*") {
			continue
		}
		for _, m := range tsImportRe.FindAllStringSubmatch(line, -1) {
			spec := m[1]
			if strings.HasPrefix(spec, ".") {
				continue // inside the package
			}
			pkgName := spec
			if strings.HasPrefix(spec, "@") {
				parts := strings.SplitN(spec, "/", 3)
				if len(parts) >= 2 {
					pkgName = parts[0] + "/" + parts[1]
				}
			} else {
				pkgName = strings.SplitN(spec, "/", 2)[0]
			}
			if other, ok := names[pkgName]; ok && other != dir {
				mod.Imports = append(mod.Imports, other)
			}
		}
		if m := tsNestCtl.FindStringSubmatch(line); m != nil {
			prefix = "/" + strings.Trim(m[1], "/")
		}
		for _, m := range tsRouteRe.FindAllStringSubmatch(line, -1) {
			method := strings.ToUpper(m[1])
			if method == "ALL" {
				method = ""
			}
			if strings.HasPrefix(m[2], "/") {
				f.Routes = append(f.Routes, Route{Kind: "http", Method: method, Path: m[2], Dir: dir, File: rel, Line: n, Handler: m[3]})
			}
		}
		for _, m := range tsRouteObj.FindAllStringSubmatch(line, -1) {
			f.Routes = append(f.Routes, Route{Kind: "http", Method: strings.ToUpper(m[1]), Path: m[2], Dir: dir, File: rel, Line: n})
		}
		for _, m := range tsNestRoute.FindAllStringSubmatch(line, -1) {
			p := strings.TrimRight(prefix, "/") + "/" + strings.Trim(m[2], "/")
			if p != "/" {
				p = strings.TrimRight(p, "/")
			}
			method := strings.ToUpper(m[1])
			if method == "ALL" {
				method = ""
			}
			f.Routes = append(f.Routes, Route{Kind: "http", Method: method, Path: p, Dir: dir, File: rel, Line: n})
		}
		for _, m := range tsNestMsg.FindAllStringSubmatch(line, -1) {
			f.Topics = append(f.Topics, Topic{Name: m[2], Kind: "topic", Dir: "sub", Mod: dir, File: rel, Line: n})
		}
		for _, tp := range tsTopicRes {
			for _, m := range tp.re.FindAllStringSubmatch(line, -1) {
				d, guess := tp.dir, false
				if d == "" {
					low := strings.ToLower(line)
					switch {
					case strings.Contains(low, "produc") || strings.Contains(low, "send") || strings.Contains(low, "publish"):
						d = "pub"
					case strings.Contains(low, "consum") || strings.Contains(low, "subscri") || strings.Contains(low, "receive"):
						d = "sub"
					}
					guess = d != ""
				}
				if !strings.Contains(m[1], " ") {
					f.Topics = append(f.Topics, Topic{Name: m[1], Kind: tp.kind, Dir: d, Mod: dir, File: rel, Line: n, Guess: guess})
				}
			}
		}
		for _, re := range extra.topics {
			if m := re.FindStringSubmatch(line); len(m) > 1 && m[1] != "" {
				f.Topics = append(f.Topics, Topic{Name: m[1], Kind: "topic", Mod: dir, File: rel, Line: n})
			}
		}
		for _, x := range extra.directed(line) {
			f.Topics = append(f.Topics, Topic{Name: x[0], Kind: "topic", Dir: x[1], Mod: dir, File: rel, Line: n})
		}
		wireLine(line, dir, rel, n, tsEnvRe, tsClientRe, nil, f)
	}
}

// tsAnchors anchors routes whose handler is a named function or method declared in the package.
func tsAnchors(cfg *config.Config, files []string, routes []Route) {
	syms := map[string]map[string]code.Span{}
	for _, p := range files {
		if s, err := code.FileSymbols(cfg.Abs(p)); err == nil {
			syms[p] = s
		}
	}
	for i := range routes {
		r := &routes[i]
		if r.Handler == "" {
			continue
		}
		name := r.Handler[strings.LastIndex(r.Handler, ".")+1:]
		var hits []string
		for _, p := range files {
			for k := range syms[p] {
				if (!strings.Contains(r.Handler, ".") && k == name) || (strings.Contains(r.Handler, ".") && strings.HasSuffix(k, "."+name)) {
					hits = append(hits, p+"#"+k)
				}
			}
		}
		if len(hits) == 1 {
			r.At = hits[0]
		}
	}
}

// nextPath turns app router folders into a URL path: (group) dropped, [id] → {id}.
func nextPath(p string) string {
	var out []string
	for _, s := range strings.Split(p, "/") {
		if s == "" || strings.HasPrefix(s, "(") || strings.HasPrefix(s, "@") {
			continue
		}
		if strings.HasPrefix(s, "[") {
			s = "{" + strings.Trim(s, "[].") + "}"
		}
		out = append(out, s)
	}
	return "/" + strings.Join(out, "/")
}
