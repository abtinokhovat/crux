package index

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Languages maps a file that marks a language in a repository to the analyzer that reads it.
var Languages = []struct{ Lang, Marker string }{
	{"go", "go.mod"},
}

// Find locates an analyzer program: CRUX_ANALYZER_<LANG>, a configured command, crux-analyze-<lang>
// next to the crux binary, then on PATH.
func Find(lang string, configured string) (string, bool) {
	if configured != "" {
		return configured, true
	}
	if v := os.Getenv("CRUX_ANALYZER_" + strings.ToUpper(lang)); v != "" {
		return v, true
	}
	name := "crux-analyze-" + lang
	if self, err := os.Executable(); err == nil {
		p := filepath.Join(filepath.Dir(self), name)
		if _, err := os.Stat(p); err == nil {
			return p, true
		}
	}
	if p, err := exec.LookPath(name); err == nil {
		return p, true
	}
	return "", false
}

// Analyze runs one analyzer over root. The rules' match patterns go with it so the analyzer
// can keep its output to what the rules and the call graph need.
func Analyze(command, root string, rules []Rule) (*Program, error) {
	var matches []string
	for _, r := range rules {
		matches = append(matches, r.Match)
	}
	tmp, err := os.CreateTemp("", "crux-match-*.json")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp.Name())
	if err := json.NewEncoder(tmp).Encode(matches); err != nil {
		return nil, err
	}
	tmp.Close()
	cmd := exec.Command(command, "--root", root, "--match", tmp.Name())
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%s: %v: %s", filepath.Base(command), err, strings.TrimSpace(errb.String()))
	}
	var p Program
	if err := json.Unmarshal(out.Bytes(), &p); err != nil {
		return nil, fmt.Errorf("%s printed no program: %v", filepath.Base(command), err)
	}
	return &p, nil
}
