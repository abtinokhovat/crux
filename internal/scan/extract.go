package scan

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/home"
)

// extractorsAdapter runs the extractors in crux's home that apply to this repository and that
// the user has approved. An extractor is a script (any language) written for a pattern — it
// prints facts JSON, which is merged in. The scripts live in crux's home, never in the repo.
// This is a trust boundary, not a sandbox: a script runs with the user's rights, so a new or
// changed one is skipped until `crux extract trust <id>`.
func extractorsAdapter(cfg *config.Config, files []string, f *Facts) {
	ms, err := home.List()
	if err != nil {
		f.Problems = append(f.Problems, "extractors: "+err.Error())
		return
	}
	for _, m := range ms {
		if !m.Applies(cfg.Root, files) {
			continue
		}
		if !m.Trusted() {
			f.Problems = append(f.Problems, fmt.Sprintf("extractor %s applies here but is not approved (review %s, then: crux extract trust %s)", m.ID, m.Dir, m.ID))
			continue
		}
		g, err := RunExtractor(cfg.Root, m)
		if err != nil {
			f.Problems = append(f.Problems, fmt.Sprintf("extractor %s: %v", m.ID, err))
			continue
		}
		merge(f, g)
		f.Extractors = append(f.Extractors, fmt.Sprintf("%s@%s", m.ID, m.Hash()))
	}
}

// RunExtractor runs one extractor against root and returns the facts it printed.
func RunExtractor(root string, m *home.Manifest) (*Facts, error) {
	secs := m.Timeout
	if secs <= 0 {
		secs = 120
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(secs)*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, "sh", "-c", m.Run)
	c.Dir = root
	c.Env = []string{"CRUX_ROOT=" + root, "CRUX_EXTRACTOR=" + m.Dir}
	for _, k := range []string{"PATH", "HOME", "LANG", "TMPDIR"} { // not the user's secrets
		if v := os.Getenv(k); v != "" {
			c.Env = append(c.Env, k+"="+v)
		}
	}
	var out, errb bytes.Buffer
	c.Stdout, c.Stderr = &out, &errb
	if err := c.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("timed out after %ds", secs)
		}
		return nil, fmt.Errorf("%v: %s", err, strings.TrimSpace(tail(errb.String(), 400)))
	}
	var g Facts
	if err := json.Unmarshal(out.Bytes(), &g); err != nil {
		return nil, fmt.Errorf("printed no facts JSON: %v", err)
	}
	return &g, nil
}

func tail(s string, n int) string {
	if len(s) > n {
		return "…" + s[len(s)-n:]
	}
	return s
}

// merge adds every list in g to f.
func merge(f, g *Facts) {
	f.Modules = append(f.Modules, g.Modules...)
	f.Routes = append(f.Routes, g.Routes...)
	f.Topics = append(f.Topics, g.Topics...)
	f.Tech = append(f.Tech, g.Tech...)
	f.Services = append(f.Services, g.Services...)
	f.Infra = append(f.Infra, g.Infra...)
	f.Schemas = append(f.Schemas, g.Schemas...)
	f.Migrations = append(f.Migrations, g.Migrations...)
	f.Env = append(f.Env, g.Env...)
	f.Hosts = append(f.Hosts, g.Hosts...)
	f.Clients = append(f.Clients, g.Clients...)
	f.Wires = append(f.Wires, g.Wires...)
	f.EnvSet = append(f.EnvSet, g.EnvSet...)
	f.Aliases = append(f.Aliases, g.Aliases...)
	f.Tables = append(f.Tables, g.Tables...)
	f.Protos = append(f.Protos, g.Protos...)
	f.Messages = append(f.Messages, g.Messages...)
	f.Obs = append(f.Obs, g.Obs...)
}
