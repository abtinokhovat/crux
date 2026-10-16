// Package scan extracts facts from code: modules and their imports, HTTP routes, gRPC services,
// topics and queues, technologies, deployable services and infrastructure. Each language is an
// adapter that adds to one Facts value; any other language can plug in a command that prints
// Facts as JSON. Lint compares these facts with what the crux files declare, and the adopt skill
// starts from them.
package scan

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/abtinokhovat/crux/internal/adr"
	"github.com/abtinokhovat/crux/internal/catalog"
	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/index"
)

type Facts struct {
	Root       string      `json:"root"`
	Adapters   []string    `json:"adapters"`
	Modules    []*Module   `json:"modules"`
	Routes     []Route     `json:"routes"`
	Topics     []Topic     `json:"topics"`
	Tech       []TechHit   `json:"tech"`
	Services   []Candidate `json:"services"`
	Infra      []Infra     `json:"infra"`
	Schemas    []string    `json:"schemas"`
	Migrations []string    `json:"migrations"`
	Problems   []string    `json:"problems,omitempty"`
	// Extractors: which crux-home extractors (id@hash) contributed, so a result can be reproduced.
	Extractors []string `json:"extractors,omitempty"`

	// wiring (wire.go)
	Env         []EnvUse       `json:"env"`
	Hosts       []HostUse      `json:"hosts"`
	Clients     []Client       `json:"clients"`
	Wires       []Wire         `json:"wires"`
	EnvSet      []EnvSet       `json:"envSet"`
	Unwired     []Unwired      `json:"unwired"`
	Aliases     [][2]string    `json:"aliases"` // another name for a host → the host
	K8sServices []K8sService   `json:"k8sServices"`
	Ingress     []IngressRule  `json:"ingress"`
	Tables      []Table        `json:"tables"`
	Protos      []ProtoService `json:"protos"`
	Messages    []ProtoMessage `json:"messages"`
	Owners      []OwnerRule    `json:"owners"`
	GRPCImpls   []GRPCImpl     `json:"grpcImpls"`

	// deep: what the type-aware analyzers saw, one entry per recognized call (see internal/index)
	Obs []index.Obs `json:"obs,omitempty"`
	// Entities: record types that look like domain entities (stored, or in a model folder), best first.
	Entities []index.Candidate `json:"entities,omitempty"`
}

// Module is a unit of code: a Go package or a JS/TS package (package.json folder).
type Module struct {
	Dir      string   `json:"dir"` // slash path from the root
	Name     string   `json:"name"`
	Lang     string   `json:"lang"`
	Main     bool     `json:"main,omitempty"` // builds a binary / starts a server
	Files    int      `json:"files"`
	Imports  []string `json:"imports"`  // other modules in this repo (dirs)
	External []string `json:"external"` // third-party modules or packages
}

type Route struct {
	Kind   string `json:"kind"` // http | grpc | graphql
	Method string `json:"method,omitempty"`
	Path   string `json:"path"`
	Dir    string `json:"dir"`
	File   string `json:"file"`
	Line   int    `json:"line"`
	// Handler: the function registered for the route, as written; At: its anchor (path#Symbol)
	// when crux found its declaration.
	Handler string `json:"handler,omitempty"`
	At      string `json:"at,omitempty"`
}

type Topic struct {
	Name string `json:"name"`
	Kind string `json:"kind"` // topic | queue
	Dir  string `json:"dir"`  // pub | sub | "" (unknown)
	// Guess: the direction comes from words on the line (writer, consumer…), not from the API
	// called. Guessed directions are never turned into connections.
	Guess bool   `json:"guess,omitempty"`
	Mod   string `json:"module"`
	File  string `json:"file"`
	Line  int    `json:"line"`
}

type TechHit struct {
	ID       string `json:"id"`
	Via      string `json:"via"` // module path, package or image that implied it
	Dir      string `json:"dir"`
	Evidence string `json:"evidence"`
}

// Candidate is something that looks deployable: a Go main package, a server package.json, a
// compose service with a build context, a Dockerfile folder, a Kubernetes workload.
type Candidate struct {
	Name     string            `json:"name"`
	Dir      string            `json:"dir"`
	Kind     string            `json:"kind"` // service | job | app
	Lang     string            `json:"lang,omitempty"`
	Evidence []string          `json:"evidence"`
	Labels   map[string]string `json:"labels,omitempty"` // Kubernetes pod labels
}

type Infra struct {
	Name   string            `json:"name"`
	Image  string            `json:"image,omitempty"`
	Tech   string            `json:"tech,omitempty"`
	Kind   string            `json:"kind"` // store | cache | broker | gateway | infra
	File   string            `json:"file"`
	Labels map[string]string `json:"labels,omitempty"`
}

// Run walks the project once and lets every adapter look at the files it understands.
func Run(cfg *config.Config, cat *catalog.Catalog, adapters []string) *Facts {
	f := &Facts{Root: cfg.Root, Modules: []*Module{}, Routes: []Route{}, Topics: []Topic{}, Tech: []TechHit{}, Services: []Candidate{}, Infra: []Infra{}, Schemas: []string{}, Migrations: []string{},
		Env: []EnvUse{}, Hosts: []HostUse{}, Clients: []Client{}, Wires: []Wire{}, EnvSet: []EnvSet{}, Unwired: []Unwired{}, Aliases: [][2]string{}, K8sServices: []K8sService{}, Ingress: []IngressRule{}, Tables: []Table{}, Protos: []ProtoService{}, Messages: []ProtoMessage{}, Owners: []OwnerRule{}, GRPCImpls: []GRPCImpl{}}
	if len(adapters) == 0 {
		adapters = cfg.Lint.Adapters
	}
	if len(adapters) == 0 {
		adapters = []string{"go", "ts", "infra", "extractors", "deep-auto"}
	}
	var files []string
	adr.WalkProject(cfg, adr.LoadIgnore(cfg), func(abs, rel string, e os.DirEntry) {
		files = append(files, rel)
	})
	sort.Strings(files)
	extra := extraPatterns(cfg)
	for _, a := range adapters {
		switch strings.TrimSpace(a) {
		case "go":
			goAdapter(cfg, cat, files, f, extra)
			f.Adapters = append(f.Adapters, "go")
		case "ts", "js", "node":
			tsAdapter(cfg, cat, files, f, extra)
			f.Adapters = append(f.Adapters, "ts")
		case "deep":
			deepAdapter(cfg, files, f, true)
		case "deep-auto":
			deepAdapter(cfg, files, f, false)
		case "extractors":
			extractorsAdapter(cfg, files, f)
		case "infra":
			infraAdapter(cfg, cat, files, f)
			f.Adapters = append(f.Adapters, "infra")
		case "":
		default:
			if err := commandAdapter(cfg, a, f); err != nil {
				f.Problems = append(f.Problems, fmt.Sprintf("adapter %q: %v", a, err))
			} else {
				f.Adapters = append(f.Adapters, a)
			}
		}
	}
	for _, p := range files {
		low := strings.ToLower(p)
		switch {
		case strings.HasSuffix(low, ".proto"), strings.HasSuffix(low, ".graphql"), strings.HasSuffix(low, ".gql"), strings.HasSuffix(low, ".avsc"),
			strings.Contains(path.Base(low), "openapi") && (strings.HasSuffix(low, ".yaml") || strings.HasSuffix(low, ".yml") || strings.HasSuffix(low, ".json")),
			strings.Contains(path.Base(low), "swagger") && (strings.HasSuffix(low, ".yaml") || strings.HasSuffix(low, ".yml") || strings.HasSuffix(low, ".json")),
			strings.Contains(path.Base(low), "asyncapi"):
			f.Schemas = append(f.Schemas, p)
		case strings.Contains(low, "migration") && (strings.HasSuffix(low, ".sql") || strings.HasSuffix(low, ".go") || strings.HasSuffix(low, ".ts")),
			strings.HasSuffix(low, ".sql") && (strings.Contains(low, "migrat") || path.Base(low) == "schema.sql" || strings.Contains(low, "/schema/")):
			f.Migrations = append(f.Migrations, p)
		}
		if strings.HasSuffix(low, ".proto") {
			protoFile(cfg.Abs(p), p, f)
		}
		if p == "CODEOWNERS" || p == ".github/CODEOWNERS" || p == "docs/CODEOWNERS" || p == ".gitlab/CODEOWNERS" {
			codeowners(cfg.Abs(p), p, f)
		}
	}
	migrationTables(cfg, f.Migrations, f)
	dedupe(f)
	return f
}

// commandAdapter runs a project command that prints Facts JSON and merges what it reports.
func commandAdapter(cfg *config.Config, command string, f *Facts) error {
	c := exec.Command("sh", "-c", command)
	c.Dir = cfg.Root
	out, err := c.Output()
	if err != nil {
		return err
	}
	var g Facts
	if err := json.Unmarshal(out, &g); err != nil {
		return fmt.Errorf("output is not facts JSON: %w", err)
	}
	f.Modules = append(f.Modules, g.Modules...)
	f.Routes = append(f.Routes, g.Routes...)
	f.Topics = append(f.Topics, g.Topics...)
	f.Tech = append(f.Tech, g.Tech...)
	f.Services = append(f.Services, g.Services...)
	f.Infra = append(f.Infra, g.Infra...)
	return nil
}

func dedupe(f *Facts) {
	seenT := map[string]bool{}
	var tech []TechHit
	for _, t := range f.Tech {
		k := t.ID + "|" + t.Dir
		if !seenT[k] {
			seenT[k] = true
			tech = append(tech, t)
		}
	}
	sort.Slice(tech, func(i, j int) bool { return tech[i].ID+tech[i].Dir < tech[j].ID+tech[j].Dir })
	f.Tech = orEmpty(tech)
	// one deployable seen several ways (cmd/x main, deploy/x Dockerfile, compose service x):
	// merge by name, keeping the code location
	byName := map[string]int{}
	var svcs []Candidate
	for _, c := range f.Services {
		k := candKey(c.Name)
		if i, ok := byName[k]; ok {
			if svcs[i].Lang == "" && c.Lang != "" {
				c.Evidence = uniq(append(c.Evidence, svcs[i].Evidence...))
				if c.Labels == nil {
					c.Labels = svcs[i].Labels
				}
				svcs[i] = c
			} else {
				svcs[i].Evidence = uniq(append(svcs[i].Evidence, c.Evidence...))
			}
			continue
		}
		byName[k] = len(svcs)
		svcs = append(svcs, c)
	}

	sort.Slice(svcs, func(i, j int) bool { return svcs[i].Dir < svcs[j].Dir })
	f.Services = orEmpty(svcs)
	seenR := map[string]bool{}
	var routes []Route
	for _, r := range f.Routes {
		k := r.Kind + r.Method + r.Path + r.Dir
		if !seenR[k] {
			seenR[k] = true
			routes = append(routes, r)
		}
	}
	f.Routes = orEmpty(routes)
	// a line matched by an API pattern (sure direction) and by a generic one (guessed): keep
	// the sure one
	sure := map[string]bool{}
	for _, t := range f.Topics {
		if !t.Guess && t.Dir != "" {
			sure[fmt.Sprintf("%s|%s:%d", t.Name, t.File, t.Line)] = true
		}
	}
	seenTp := map[string]bool{}
	var topics []Topic
	for _, t := range f.Topics {
		if (t.Guess || t.Dir == "") && sure[fmt.Sprintf("%s|%s:%d", t.Name, t.File, t.Line)] {
			continue
		}
		k := fmt.Sprintf("%s|%s|%s|%v", t.Name, t.Dir, t.Mod, t.Guess)
		if !seenTp[k] {
			seenTp[k] = true
			topics = append(topics, t)
		}
	}
	f.Topics = orEmpty(topics)
	sort.Slice(f.Modules, func(i, j int) bool { return f.Modules[i].Dir < f.Modules[j].Dir })
}

func orEmpty[T any](xs []T) []T {
	if xs == nil {
		return []T{}
	}
	return xs
}

func uniq(xs []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, x := range xs {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}

// ModuleOf returns the module that holds a file (the deepest module dir that prefixes it).
func (f *Facts) ModuleOf(file string) *Module {
	var best *Module
	for _, m := range f.Modules {
		if (m.Dir == "." || file == m.Dir || strings.HasPrefix(file, m.Dir+"/")) && (best == nil || len(m.Dir) > len(best.Dir)) {
			best = m
		}
	}
	return best
}

var candSuffix = regexp.MustCompile(`(svc|service|server|srv|app|api)$`)

func candKey(name string) string {
	k := strings.ToLower(regexp.MustCompile(`[^A-Za-z0-9]`).ReplaceAllString(name, ""))
	if t := candSuffix.ReplaceAllString(k, ""); t != "" {
		k = t
	}
	return k
}
