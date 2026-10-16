package scan

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/home"
)

func TestExtractorRunsOnlyWhenApprovedAndMerges(t *testing.T) {
	t.Setenv("CRUX_HOME", t.TempDir())
	dir, err := home.Scaffold("q")
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(dir, "extract.py"), nil, 0o644)
	os.WriteFile(filepath.Join(dir, "manifest.yaml"), []byte(`id: q
version: 1
run: 'echo "{\"topics\":[{\"name\":\"a.b\",\"kind\":\"queue\",\"dir\":\"sub\",\"module\":\"svc\",\"file\":\"x.go\",\"line\":3}]}"'
applies_when: {files: [go.mod]}
`), 0o644)
	repo := t.TempDir()
	os.WriteFile(filepath.Join(repo, "go.mod"), []byte("module x\n"), 0o644)
	cfg := &config.Config{Root: repo}

	f := &Facts{}
	extractorsAdapter(cfg, []string{"go.mod"}, f)
	if len(f.Topics) != 0 || len(f.Problems) != 1 {
		t.Fatalf("an unapproved extractor must not run: %+v", f)
	}

	m, _ := home.Load(dir)
	if err := m.Trust(); err != nil {
		t.Fatal(err)
	}
	f = &Facts{}
	extractorsAdapter(cfg, []string{"go.mod"}, f)
	if len(f.Topics) != 1 || f.Topics[0].Name != "a.b" || len(f.Extractors) != 1 {
		t.Fatalf("got %+v", f)
	}
}
