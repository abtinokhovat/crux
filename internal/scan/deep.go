package scan

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/home"
	"github.com/abtinokhovat/crux/internal/index"
)

// deepCache is what an analyzer run produced, kept in crux's home (never in the repo) so the
// next command costs a file-stat pass instead of a type-check. Key covers the source files,
// the rules and the analyzer binary: any change re-runs the analyzer.
type deepCache struct {
	Key   string            `json:"key"`
	Obs   []index.Obs       `json:"obs"`
	Ents  []index.Candidate `json:"entities,omitempty"`
	Units map[string]string `json:"units"`
	Notes []string          `json:"notes,omitempty"`
}

func cachePath(root, lang string) string {
	return filepath.Join(home.ProjectDir(root), "index-"+lang+".json")
}

func deepKey(cfg *config.Config, files []string, rules []index.Rule, analyzer string) string {
	h := sha256.New()
	b, _ := json.Marshal(rules)
	h.Write(b)
	if st, err := os.Stat(analyzer); err == nil {
		fmt.Fprintf(h, "%s|%d|%d\n", analyzer, st.Size(), st.ModTime().UnixNano())
	}
	if self, err := os.Executable(); err == nil { // the interpretation logic is part of the result
		if st, err := os.Stat(self); err == nil {
			fmt.Fprintf(h, "crux|%d|%d\n", st.Size(), st.ModTime().UnixNano())
		}
	}
	for _, f := range files {
		if strings.HasSuffix(f, ".go") || f == "go.mod" || strings.HasSuffix(f, "/go.mod") || strings.HasSuffix(f, "go.sum") {
			if st, err := os.Stat(cfg.Abs(f)); err == nil {
				fmt.Fprintf(h, "%s|%d|%d\n", f, st.Size(), st.ModTime().UnixNano())
			}
		}
	}
	return hex.EncodeToString(h.Sum(nil))
}

// deepAdapter runs the language analyzers (type-aware, one program per language) and turns what
// the recognizer rules see into the same facts the text adapters produce — but exact: the call
// is resolved by the compiler's types, the name is a folded constant, and every fact names the
// entry points that reach it.
func deepAdapter(cfg *config.Config, files []string, f *Facts, explicit bool) {
	rules, err := index.DefaultRules()
	if err != nil {
		f.Problems = append(f.Problems, "index rules: "+err.Error())
		return
	}
	ran := false
	for _, l := range index.Languages {
		if _, err := os.Stat(cfg.Abs(l.Marker)); err != nil && !hasMarker(cfg, l.Marker) {
			continue
		}
		cmd, ok := index.Find(l.Lang, cfg.Scan.Analyzers[l.Lang])
		if !ok {
			if explicit { // by default a repo without the analyzer just gets the text adapters
				f.Problems = append(f.Problems, fmt.Sprintf("deep: no crux-analyze-%s found (put it next to crux or on PATH); using text adapters only", l.Lang))
			}
			continue
		}
		key := deepKey(cfg, files, rules, cmd)
		var dc deepCache
		if b, err := os.ReadFile(cachePath(cfg.Root, l.Lang)); err != nil || json.Unmarshal(b, &dc) != nil || dc.Key != key {
			prog, err := index.Analyze(cmd, cfg.Root, rules)
			if err != nil {
				f.Problems = append(f.Problems, "deep: "+err.Error())
				continue
			}
			res := index.Interpret(prog, rules)
			dc = deepCache{Key: key, Obs: res.Obs, Ents: index.Candidates(prog), Units: map[string]string{}, Notes: prog.Notes}
			for _, u := range prog.Units {
				dc.Units[u.ID] = u.Dir
			}
			if b, err := json.Marshal(dc); err == nil {
				if os.MkdirAll(filepath.Dir(cachePath(cfg.Root, l.Lang)), 0o755) == nil {
					_ = os.WriteFile(cachePath(cfg.Root, l.Lang), b, 0o644)
				}
			}
		}
		ran = true
		f.Problems = append(f.Problems, prefix("deep "+l.Lang+": ", dc.Notes)...)
		mergeObs(f, &index.Result{Obs: dc.Obs}, dc.Units)
		f.Entities = append(f.Entities, dc.Ents...)
	}
	if ran {
		f.Adapters = append(f.Adapters, "deep")
	}
}

func hasMarker(cfg *config.Config, name string) bool {
	_, err := os.Stat(path.Join(cfg.Root, name))
	return err == nil
}

func prefix(p string, xs []string) []string {
	var out []string
	for i, x := range xs {
		if i == 8 {
			out = append(out, fmt.Sprintf("%s… %d more notes", p, len(xs)-8))
			break
		}
		out = append(out, p+x)
	}
	return out
}

func mergeObs(f *Facts, res *index.Result, unitDir map[string]string) {
	f.Obs = append(f.Obs, res.Obs...)
	seenClient := map[string]bool{}
	for _, o := range res.Obs {
		var mods []string
		for _, e := range o.Entries {
			mods = append(mods, unitDir[e])
		}
		if len(mods) == 0 {
			if m := f.ModuleOf(o.File); m != nil {
				mods = []string{m.Dir}
			}
		}
		for _, mod := range mods {
			switch o.Role {
			case "publish", "consume", "declare":
				if o.Name.Kind != "const" && o.Name.Kind != "pattern" {
					continue
				}
				dir := map[string]string{"publish": "pub", "consume": "sub"}[o.Role]
				f.Topics = append(f.Topics, Topic{Name: o.Name.Str, Kind: o.Kind, Dir: dir, Mod: mod, File: o.File, Line: o.Line})
			case "route":
				if o.Name.Kind == "const" {
					f.Routes = append(f.Routes, Route{Kind: "http", Method: o.Method, Path: o.Name.Str, Dir: mod, File: o.File, Line: o.Line})
				}
			case "serve-grpc":
				f.Routes = append(f.Routes, Route{Kind: "grpc", Path: o.Service, Dir: mod, File: o.File, Line: o.Line})
			case "client-grpc":
				svc := o.Service
				if svc == "" && o.Name.Kind == "const" { // "pb.Domain" → Domain
					svc = o.Name.Str[strings.LastIndex(o.Name.Str, ".")+1:]
				}
				if k := svc + "|" + mod; svc != "" && !seenClient[k] { // one per caller and service; the methods stay in Obs
					seenClient[k] = true
					f.Clients = append(f.Clients, Client{Service: svc, Mod: mod, File: o.File, Line: o.Line})
				}
			}
			if o.Tech != "" {
				f.Tech = append(f.Tech, TechHit{ID: o.Tech, Via: o.Rule, Dir: mod, Evidence: fmt.Sprintf("%s:%d", o.File, o.Line)})
			}
		}
	}
}
