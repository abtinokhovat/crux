package home

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScaffoldTrustAndApplies(t *testing.T) {
	t.Setenv("CRUX_HOME", t.TempDir())
	dir, err := Scaffold("demo")
	if err != nil {
		t.Fatal(err)
	}
	ms, err := List()
	if err != nil || len(ms) != 1 || ms[0].ID != "demo" {
		t.Fatalf("list: %v %v", ms, err)
	}
	m := ms[0]
	if m.Trusted() {
		t.Fatal("a new extractor must not be trusted")
	}
	if err := m.Trust(); err != nil {
		t.Fatal(err)
	}
	if !m.Trusted() {
		t.Fatal("trust did not stick")
	}
	os.WriteFile(filepath.Join(dir, "extract.py"), []byte("print('{}')"), 0o755)
	if m.Trusted() {
		t.Fatal("a changed script must need approval again")
	}

	repo := t.TempDir()
	os.WriteFile(filepath.Join(repo, "go.mod"), []byte("module x\nrequire github.com/go-kit/kit v1\n"), 0o644)
	m.AppliesWhen = When{Files: []string{"go.mod"}, Contains: []Contains{{File: "go.mod", Text: "go-kit/kit"}}}
	if !m.Applies(repo, []string{"go.mod", "main.go"}) {
		t.Fatal("should apply")
	}
	m.AppliesWhen.Contains[0].Text = "nats"
	if m.Applies(repo, []string{"go.mod"}) {
		t.Fatal("should not apply")
	}
}
