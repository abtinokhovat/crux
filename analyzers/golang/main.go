// crux-analyze-go: the Go analyzer for crux's code index. It type-checks a repository with
// go/packages and prints a language-neutral Program (see internal/index/ir.go in crux) on
// stdout: every function, every call with its arguments evaluated as far as the types allow
// (constants folded, parameters tracked, patterns for partly known strings), composite literals
// of library types, and references to functions used as values. Interface calls are expanded to
// the repository's implementations so reachability does not stop at an interface.
//
//	crux-analyze-go [--root DIR] [--match FILE]
//
// --match is a JSON array of callee-id globs (the recognizer rules' match patterns). Calls to
// code outside the repository are kept only when one matches, which keeps the output small.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// The JSON contract with crux (internal/index/ir.go). Kept in step by hand: it is the protocol.
type Program struct {
	Lang  string   `json:"lang"`
	Units []Unit   `json:"units"`
	Funcs []Func   `json:"funcs"`
	Calls []Call   `json:"calls"`
	Types []Type   `json:"types,omitempty"`
	Notes []string `json:"notes,omitempty"`
}
type Type struct {
	ID     string  `json:"id"`
	Unit   string  `json:"unit"`
	File   string  `json:"file"`
	Line   int     `json:"line"`
	Fields []Field `json:"fields"`
	Table  string  `json:"table,omitempty"`
}
type Field struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Tag      string `json:"tag,omitempty"`
	Embedded bool   `json:"embedded,omitempty"`
}
type Unit struct {
	ID   string `json:"id"`
	Dir  string `json:"dir"`
	Main bool   `json:"main"`
}
type Func struct {
	ID   string `json:"id"`
	Unit string `json:"unit"`
	File string `json:"file"`
	Line int    `json:"line"`
}
type Call struct {
	Caller string           `json:"caller"`
	Callee string           `json:"callee"`
	Unit   string           `json:"unit"`
	File   string           `json:"file"`
	Line   int              `json:"line"`
	Args   []Value          `json:"args,omitempty"`
	Fields map[string]Value `json:"fields,omitempty"`
	Ref    bool             `json:"ref,omitempty"`
}
type Value struct {
	Kind  string  `json:"kind"`
	Str   string  `json:"str,omitempty"`
	Param int     `json:"param,omitempty"`
	Elem  bool    `json:"elem,omitempty"` // param: an element of the argument, not the argument
	Type  string  `json:"type,omitempty"`
	Items []Value `json:"items,omitempty"`
}

func main() {
	root := flag.String("root", ".", "repository root")
	matchFile := flag.String("match", "", "JSON array of callee-id globs to keep for external code")
	flag.Parse()
	abs, err := filepath.Abs(*root)
	if err != nil {
		fail(err)
	}
	var globs []*regexp.Regexp
	if *matchFile != "" {
		b, err := os.ReadFile(*matchFile)
		if err != nil {
			fail(err)
		}
		var ms []string
		if err := json.Unmarshal(b, &ms); err != nil {
			fail(err)
		}
		for _, m := range ms {
			parts := strings.Split(m, "*")
			for i := range parts {
				parts[i] = regexp.QuoteMeta(parts[i])
			}
			globs = append(globs, regexp.MustCompile("^"+strings.Join(parts, ".*")+"$"))
		}
	}
	prog, err := analyze(abs, globs)
	if err != nil {
		fail(err)
	}
	sort.Slice(prog.Units, func(i, j int) bool { return prog.Units[i].ID < prog.Units[j].ID })
	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(prog); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "crux-analyze-go:", err)
	os.Exit(1)
}
