// Package home is crux's own folder on the user's machine (CRUX_HOME, default ~/.crux), where
// what crux learns about reading code is kept for reuse across repositories — extractor scripts
// written for a pattern (go-kit services, consul-driven queues…), their trust decisions, and
// per-project working data. Nothing here is written into a repository.
//
//	~/.crux/extractors/<id>/manifest.yaml, <script>, fixtures/   one folder per extractor
//	~/.crux/trust.json                                           extractor id → hash the user approved
//	~/.crux/projects/<name>-<hash>/                              working data for one repository
package home

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Dir is crux's home folder.
func Dir() string {
	if d := os.Getenv("CRUX_HOME"); d != "" {
		return d
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".crux")
}

func ExtractorsDir() string { return filepath.Join(Dir(), "extractors") }

// ProjectDir is the working folder for one repository, keyed by its path.
func ProjectDir(root string) string {
	abs, err := filepath.Abs(root)
	if err != nil {
		abs = root
	}
	sum := sha256.Sum256([]byte(abs))
	return filepath.Join(Dir(), "projects", filepath.Base(abs)+"-"+hex.EncodeToString(sum[:])[:8])
}

// Manifest describes one extractor: a program that reads a repository that follows some pattern
// and prints facts JSON (the same shape as `crux scan --json`).
type Manifest struct {
	ID      string `yaml:"id"`
	Summary string `yaml:"summary"`
	Version int    `yaml:"version"`
	// Run is the command, started in the repository root with CRUX_ROOT set; the extractor's own
	// folder is $CRUX_EXTRACTOR (so: python3 "$CRUX_EXTRACTOR/extract.py"). It prints facts JSON on stdout.
	Run string `yaml:"run"`
	// AppliesWhen: every condition must hold for the extractor to run on a repository.
	AppliesWhen When   `yaml:"applies_when"`
	Timeout     int    `yaml:"timeout"` // seconds, default 120
	Dir         string `yaml:"-"`
}

type When struct {
	Files    []string   `yaml:"files"`    // each must match a file (path, or base-name glob when it has no /)
	Contains []Contains `yaml:"contains"` // each must hold
}

type Contains struct {
	File string `yaml:"file"` // same matching as files; any matching file may hold the text
	Text string `yaml:"text"`
}

// List reads the installed extractors, sorted by id.
func List() ([]*Manifest, error) {
	ents, err := os.ReadDir(ExtractorsDir())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []*Manifest
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		m, err := Load(filepath.Join(ExtractorsDir(), e.Name()))
		if err != nil {
			return nil, fmt.Errorf("extractor %s: %w", e.Name(), err)
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func Load(dir string) (*Manifest, error) {
	b, err := os.ReadFile(filepath.Join(dir, "manifest.yaml"))
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := yaml.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	if m.ID == "" {
		m.ID = filepath.Base(dir)
	}
	if m.Run == "" {
		return nil, fmt.Errorf("manifest has no run command")
	}
	m.Dir = dir
	return &m, nil
}

// Applies reports whether the repository (its slash-relative files, read from root) matches.
func (m *Manifest) Applies(root string, files []string) bool {
	match := func(pattern string) (hits []string) {
		for _, f := range files {
			if pattern == f {
				hits = append(hits, f)
			} else if !strings.Contains(pattern, "/") {
				if ok, _ := path.Match(pattern, path.Base(f)); ok {
					hits = append(hits, f)
				}
			} else if ok, _ := path.Match(pattern, f); ok {
				hits = append(hits, f)
			}
		}
		return hits
	}
	for _, p := range m.AppliesWhen.Files {
		if len(match(p)) == 0 {
			return false
		}
	}
	for _, c := range m.AppliesWhen.Contains {
		found := false
		for _, f := range match(c.File) {
			if b, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(f))); err == nil && strings.Contains(string(b), c.Text) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// Hash fingerprints everything in the extractor's folder, so a changed script needs approval again.
func (m *Manifest) Hash() string {
	h := sha256.New()
	filepath.WalkDir(m.Dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(m.Dir, p)
		b, _ := os.ReadFile(p)
		fmt.Fprintf(h, "%s\x00%d\x00", filepath.ToSlash(rel), len(b))
		h.Write(b)
		return nil
	})
	return hex.EncodeToString(h.Sum(nil))[:16]
}

func trustFile() string { return filepath.Join(Dir(), "trust.json") }

func loadTrust() map[string]string {
	t := map[string]string{}
	if b, err := os.ReadFile(trustFile()); err == nil {
		_ = json.Unmarshal(b, &t)
	}
	return t
}

// Trusted: the user approved exactly this version of the extractor.
func (m *Manifest) Trusted() bool { return loadTrust()[m.ID] == m.Hash() }

// Trust records the user's approval of the extractor as it is now.
func (m *Manifest) Trust() error {
	t := loadTrust()
	t[m.ID] = m.Hash()
	if err := os.MkdirAll(Dir(), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(t, "", "  ")
	return os.WriteFile(trustFile(), b, 0o600)
}

const scaffoldManifest = `id: %[1]s
summary: what pattern this reads, in one line
version: 1
run: python3 "$CRUX_EXTRACTOR/extract.py"   # starts in the repository root; CRUX_ROOT is the root
# every condition must hold for crux to run it on a repository
applies_when:
  files: [go.mod]
  # contains:
  #   - {file: go.mod, text: github.com/go-kit/kit}
`

const scaffoldScript = `#!/usr/bin/env python3
"""Extractor: reads the repository at $CRUX_ROOT (also the working directory) and prints facts
JSON on stdout — the shape of 'crux scan --json'. Fill only the lists you can fill exactly; every
fact needs the file and line that prove it. Do not guess: leave out what the code does not state."""
import json, os

root = os.environ.get("CRUX_ROOT", ".")
facts = {
    "topics": [],   # {"name", "kind": "topic|queue", "dir": "pub|sub|", "module": <dir>, "file", "line"}
    "clients": [],  # {"service", "module", "file", "line"}
    "routes": [],   # {"kind": "http|grpc", "method", "path", "dir", "file", "line"}
    "tech": [],     # {"id", "via", "dir", "evidence"}
    "obs": [],      # raw observations, as in 'crux scan --deep --json'
}
print(json.dumps(facts))
`

// Scaffold creates a new extractor folder with a manifest and a script to fill in.
func Scaffold(id string) (string, error) {
	if id == "" || strings.ContainsAny(id, `/\ `) {
		return "", fmt.Errorf("extractor id must be a plain name")
	}
	dir := filepath.Join(ExtractorsDir(), id)
	if _, err := os.Stat(dir); err == nil {
		return "", fmt.Errorf("%s already exists", dir)
	}
	if err := os.MkdirAll(filepath.Join(dir, "fixtures"), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.yaml"), []byte(fmt.Sprintf(scaffoldManifest, id)), 0o644); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, "extract.py"), []byte(scaffoldScript), 0o755); err != nil {
		return "", err
	}
	return dir, nil
}
