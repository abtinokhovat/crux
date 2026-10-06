package adr

import (
	"bufio"
	"bytes"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/abtinokhovat/crux/internal/config"
)

// Folders no project wants scanned for docs.
var skipDirs = map[string]bool{
	"node_modules": true, "vendor": true, "dist": true, "build": true, "target": true, "out": true,
	"coverage": true, "bin": true, "obj": true, "__pycache__": true, "venv": true, ".venv": true,
	"bower_components": true, "jspm_packages": true, "Pods": true, "DerivedData": true,
}

// Ignore is a small .gitignore matcher: root .gitignore plus config scan.exclude. It covers the
// common forms (names, globs, dir/, /anchored, a/b paths); negations are not supported.
type Ignore struct {
	pats []ignorePat
}

type ignorePat struct {
	glob     string
	dirOnly  bool
	anchored bool
}

func LoadIgnore(cfg *config.Config) *Ignore {
	ig := &Ignore{}
	if f, err := os.Open(filepath.Join(cfg.Root, ".gitignore")); err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			ig.add(sc.Text())
		}
		f.Close()
	}
	for _, x := range cfg.Scan.Exclude {
		ig.add(x)
	}
	return ig
}

func (ig *Ignore) add(line string) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
		return
	}
	p := ignorePat{}
	if strings.HasSuffix(line, "/") {
		p.dirOnly = true
		line = strings.TrimSuffix(line, "/")
	}
	if strings.HasPrefix(line, "/") {
		p.anchored = true
		line = strings.TrimPrefix(line, "/")
	} else if strings.Contains(line, "/") {
		p.anchored = true
	}
	line = strings.TrimSuffix(strings.TrimPrefix(line, "**/"), "/**")
	p.glob = line
	ig.pats = append(ig.pats, p)
}

// Match reports whether rel (slash path from the root) is ignored.
func (ig *Ignore) Match(rel string, isDir bool) bool {
	base := path.Base(rel)
	for _, p := range ig.pats {
		if p.dirOnly && !isDir {
			continue
		}
		if p.anchored {
			if ok, _ := path.Match(p.glob, rel); ok {
				return true
			}
			continue
		}
		if ok, _ := path.Match(p.glob, base); ok {
			return true
		}
	}
	return false
}

// WalkProject visits every file under the root that is not ignored. fn gets the absolute path
// and the slash path relative to the root.
func WalkProject(cfg *config.Config, ig *Ignore, fn func(abs, rel string, e os.DirEntry)) {
	_ = filepath.WalkDir(cfg.Root, func(p string, e os.DirEntry, err error) error {
		if err != nil {
			if e != nil && e.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if p == cfg.Root {
			return nil
		}
		rel := cfg.Rel(p)
		name := e.Name()
		if e.IsDir() {
			if strings.HasPrefix(name, ".") && name != ".crux" || skipDirs[name] || ig.Match(rel, true) {
				return filepath.SkipDir
			}
			return nil
		}
		if ig.Match(rel, false) {
			return nil
		}
		fn(p, rel, e)
		return nil
	})
}

var cruxKey = []byte("crux:")

// HasCruxHeader reports whether a markdown file starts with frontmatter that has a top-level
// "crux:" key. Only the frontmatter is read.
func HasCruxHeader(p string) bool {
	f, err := os.Open(p)
	if err != nil {
		return false
	}
	defer f.Close()
	r := bufio.NewReader(io.LimitReader(f, 16<<10))
	first, err := r.ReadString('\n')
	if err != nil && first == "" || strings.TrimRight(first, "\r\n") != "---" {
		return false
	}
	for {
		line, err := r.ReadBytes('\n')
		t := bytes.TrimRight(line, "\r\n")
		if string(t) == "---" {
			return false
		}
		if bytes.HasPrefix(t, cruxKey) {
			return true
		}
		if err != nil {
			return false
		}
	}
}
