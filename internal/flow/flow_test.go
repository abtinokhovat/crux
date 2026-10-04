package flow

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/abtinokhovat/crux/internal/adr"
	"github.com/abtinokhovat/crux/internal/config"
)

func project(t *testing.T) *config.Config {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	if err := os.WriteFile(filepath.Join(dir, "crux.config.yaml"), []byte("title: t\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestTitleFromQuestion(t *testing.T) {
	for q, want := range map[string]string{"Which broker do we use for v1?": "Broker for v1", "Should we cache contacts in Redis?": "Cache contacts in Redis"} {
		if got := TitleFromQuestion(q); got != want {
			t.Errorf("%q → %q, want %q", q, got, want)
		}
	}
}

func TestDraftLinkFinalizeContext(t *testing.T) {
	cfg := project(t)
	a, err := CreateDraft(cfg, adr.Load(cfg), "Which cache do we use?", "redis?", "", "me")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := CreateDraft(cfg, adr.Load(cfg), "Which queue do we use?", "", "", "me")
	if _, err := Link(cfg, adr.Load(cfg), a.ID, "relates", b.ID); err != nil {
		t.Fatal(err)
	}
	path := cfg.Abs(a.File)
	text, _ := os.ReadFile(path)
	text = append(text, []byte("\n## Options\n| Option | Pros | Cons | Fit |\n|---|---|---|---|\n| A — Redis | Fast. | RAM. | warn |\n| B — Memcached | Simple. | Another system. | warn |\n")...)
	_ = os.WriteFile(path, text, 0o644)
	s := adr.Load(cfg)
	if err := Finalize(cfg, s.ByID[a.ID], "A", "Use Redis.", []Dissent{{"sara", "B", "simpler"}}, []string{"memory > 70%"}); err != nil {
		t.Fatal(err)
	}
	s = adr.Load(cfg)
	d := s.ByID[a.ID]
	if d.StatusKey != "accepted" || d.Facts.Decision == nil || *d.Facts.Decision != "Use Redis." {
		t.Fatalf("not finalized: %s %v", d.Status, d.Facts.Decision)
	}
	if !strings.Contains(d.Source, "@sara prefers B") || len(s.ByID[b.ID].Rel["relates"]) != 1 {
		t.Fatalf("dissent or link missing")
	}
	ctx := Context(cfg, s, []string{"cache"})
	if len(ctx) == 0 || ctx[0].ID != a.ID || len(ctx[0].Rejected) != 1 || ctx[0].ReopenWhen[0] != "memory > 70%" {
		t.Fatalf("context: %+v", ctx)
	}
}
