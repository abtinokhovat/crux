// Package code resolves anchors: references from the crux model into the code. An anchor is
//
//	path/to/file.go#Symbol        a function, type, const or var
//	path/to/file.go#Type.Method   a method (Go receivers, TS/Python class methods, proto rpcs)
//	path/to/file.go:42            a line (a fallback: lines drift, symbols do not)
//	path/to/file.go               a whole file (or a folder)
//
// Symbols are found by parsing, never by guessing: Go through go/parser; TypeScript, JavaScript,
// Python, proto and SQL through declaration patterns. A symbol that is missing or ambiguous is
// an error the caller reports.
package code

import (
	"bufio"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Anchor is a resolved reference into the code.
type Anchor struct {
	Ref    string `json:"ref"`
	File   string `json:"file"`
	Symbol string `json:"symbol,omitempty"`
	Line   int    `json:"line,omitempty"`
	End    int    `json:"end,omitempty"`
	Err    string `json:"error,omitempty"`
}

// String is file:line (or the file) — the form editors and agents open.
func (a Anchor) String() string {
	if a.Line > 0 {
		return fmt.Sprintf("%s:%d", a.File, a.Line)
	}
	return a.File
}

var lineSuffix = regexp.MustCompile(`^(.+):(\d+)$`)

// Split reads an anchor reference into file, symbol and line. It does not touch the disk.
func Split(ref string) (file, symbol string, line int) {
	ref = strings.TrimSpace(ref)
	if i := strings.Index(ref, "#"); i >= 0 {
		return ref[:i], ref[i+1:], 0
	}
	if m := lineSuffix.FindStringSubmatch(ref); m != nil {
		n, _ := strconv.Atoi(m[2])
		return m[1], "", n
	}
	return ref, "", 0
}

// Looks reports whether s has the shape of an anchor: a relative path with a file extension or
// a folder, optionally followed by #Symbol or :line.
func Looks(s string) bool {
	f, _, _ := Split(s)
	return f != "" && !strings.ContainsAny(f, " \t*") && (strings.Contains(f, "/") || strings.Contains(path.Base(f), "."))
}

// Span is where a symbol is declared.
type Span struct {
	Line, End int
}

// Resolver resolves anchors under a root, caching each file's symbols.
type Resolver struct {
	root  string
	syms  map[string]map[string]Span
	lines map[string]int
	errs  map[string]error
}

func NewResolver(root string) *Resolver {
	return &Resolver{root: root, syms: map[string]map[string]Span{}, lines: map[string]int{}, errs: map[string]error{}}
}

// Resolve checks an anchor against the code and fills in its line.
func (r *Resolver) Resolve(ref string) Anchor {
	file, sym, line := Split(ref)
	a := Anchor{Ref: strings.TrimSpace(ref), File: file, Symbol: sym, Line: line}
	if file == "" {
		a.Err = "empty anchor"
		return a
	}
	if filepath.IsAbs(file) || strings.HasPrefix(path.Clean(file), "..") {
		a.Err = "anchor must be a path relative to the project root"
		return a
	}
	st, err := os.Stat(filepath.Join(r.root, file))
	if err != nil {
		a.Err = "no such file"
		return a
	}
	if st.IsDir() {
		if sym != "" || line > 0 {
			a.Err = "a folder has no symbols or lines"
		}
		return a
	}
	if line > 0 {
		if n := r.lineCount(file); line > n {
			a.Err = fmt.Sprintf("line %d is past the end of the file (%d lines)", line, n)
		}
		return a
	}
	if sym == "" {
		return a
	}
	syms, err := r.Symbols(file)
	if err != nil {
		a.Err = err.Error()
		return a
	}
	sp, err := Find(syms, sym)
	if err != nil {
		a.Err = err.Error()
		return a
	}
	a.Line, a.End = sp.Line, sp.End
	return a
}

// Find looks a symbol up: an exact name, else (for a bare name) the one method with that name.
func Find(syms map[string]Span, sym string) (Span, error) {
	if sp, ok := syms[sym]; ok {
		return sp, nil
	}
	if !strings.Contains(sym, ".") {
		var hits []string
		for k := range syms {
			if strings.HasSuffix(k, "."+sym) {
				hits = append(hits, k)
			}
		}
		sort.Strings(hits)
		switch len(hits) {
		case 1:
			return syms[hits[0]], nil
		case 0:
		default:
			return Span{}, fmt.Errorf("%s is ambiguous: %s — anchor one of them", sym, strings.Join(hits, ", "))
		}
	}
	return Span{}, fmt.Errorf("no symbol %s in this file", sym)
}

func (r *Resolver) lineCount(file string) int {
	if n, ok := r.lines[file]; ok {
		return n
	}
	n := 0
	if fh, err := os.Open(filepath.Join(r.root, file)); err == nil {
		sc := bufio.NewScanner(fh)
		sc.Buffer(make([]byte, 1024*1024), 1024*1024)
		for sc.Scan() {
			n++
		}
		fh.Close()
	}
	r.lines[file] = n
	return n
}

// Symbols lists the declarations in a file, by name. Supported: Go, TypeScript/JavaScript,
// Python, proto and SQL.
func (r *Resolver) Symbols(file string) (map[string]Span, error) {
	if s, ok := r.syms[file]; ok {
		return s, r.errs[file]
	}
	s, err := FileSymbols(filepath.Join(r.root, file))
	r.syms[file], r.errs[file] = s, err
	return s, err
}

// FileSymbols parses one file for its declarations.
func FileSymbols(abs string) (map[string]Span, error) {
	switch ext := strings.ToLower(filepath.Ext(abs)); ext {
	case ".go":
		return goSymbols(abs)
	case ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts":
		return lineSymbols(abs, tsDecl, true)
	case ".py":
		return lineSymbols(abs, pyDecl, false)
	case ".proto":
		return lineSymbols(abs, protoDecl, true)
	case ".sql":
		return lineSymbols(abs, sqlDecl, false)
	default:
		return nil, fmt.Errorf("crux cannot read symbols in %s files — anchor a line (file:line) instead", ext)
	}
}

func goSymbols(abs string) (map[string]Span, error) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, abs, nil, parser.SkipObjectResolution)
	if err != nil {
		return nil, fmt.Errorf("cannot parse: %v", err)
	}
	out := map[string]Span{}
	span := func(n ast.Node) Span { return Span{fset.Position(n.Pos()).Line, fset.Position(n.End()).Line} }
	for _, d := range f.Decls {
		switch x := d.(type) {
		case *ast.FuncDecl:
			name := x.Name.Name
			if x.Recv != nil && len(x.Recv.List) > 0 {
				name = RecvName(x.Recv.List[0].Type) + "." + name
			}
			out[name] = span(x)
		case *ast.GenDecl:
			for _, sp := range x.Specs {
				switch y := sp.(type) {
				case *ast.TypeSpec:
					out[y.Name.Name] = span(y)
					if it, ok := y.Type.(*ast.InterfaceType); ok {
						for _, m := range it.Methods.List {
							for _, n := range m.Names {
								out[y.Name.Name+"."+n.Name] = span(m)
							}
						}
					}
				case *ast.ValueSpec:
					for _, n := range y.Names {
						if n.Name != "_" {
							out[n.Name] = span(y)
						}
					}
				}
			}
		}
	}
	return out, nil
}

// RecvName is the type name of a Go method receiver: *Server[T] → Server.
func RecvName(e ast.Expr) string {
	for {
		switch x := e.(type) {
		case *ast.StarExpr:
			e = x.X
		case *ast.IndexExpr:
			e = x.X
		case *ast.IndexListExpr:
			e = x.X
		case *ast.ParenExpr:
			e = x.X
		case *ast.Ident:
			return x.Name
		default:
			return ""
		}
	}
}

// decl reads one line: it returns a declared name (with its kind) or nothing.
type declFn func(line string, st *declState) (name string, container bool)

type declState struct {
	class      string // the class (or service) being read
	classDepth int    // brace depth at which the class body sits (TS, proto)
	classInd   int    // indentation of the class line (Python)
	depth      int
}

var (
	tsFunc   = regexp.MustCompile(`^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)`)
	tsClass  = regexp.MustCompile(`^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)`)
	tsVar    = regexp.MustCompile(`^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=`)
	tsType   = regexp.MustCompile(`^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)`)
	tsMethod = regexp.MustCompile(`^\s*(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(`)
	tsField  = regexp.MustCompile(`^\s*(?:(?:public|private|protected|static|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>`)
	tsNotFn  = map[string]bool{"if": true, "for": true, "while": true, "switch": true, "catch": true, "return": true, "function": true, "constructor": false, "super": true, "await": true, "new": true, "typeof": true}
	pyDef    = regexp.MustCompile(`^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)`)
	pyClass  = regexp.MustCompile(`^(\s*)class\s+([A-Za-z_]\w*)`)
	pbMsg    = regexp.MustCompile(`^\s*(?:message|enum)\s+(\w+)`)
	pbSvc    = regexp.MustCompile(`^\s*service\s+(\w+)`)
	pbRPC    = regexp.MustCompile(`^\s*rpc\s+(\w+)`)
	sqlTable = regexp.MustCompile(`(?i)^\s*create\s+(?:or\s+replace\s+)?(?:unlogged\s+|temporary\s+|temp\s+)?(table|view|materialized\s+view|type|function|index|unique\s+index)\s+(?:if\s+not\s+exists\s+)?(?:[\w"]+\.)?"?(\w+)"?`)
)

func tsDecl(line string, st *declState) (string, bool) {
	if st.class != "" && st.depth == st.classDepth {
		if m := tsMethod.FindStringSubmatch(line); m != nil && !tsNotFn[m[1]] {
			return st.class + "." + m[1], false
		}
		if m := tsField.FindStringSubmatch(line); m != nil {
			return st.class + "." + m[1], false
		}
		return "", false
	}
	if st.depth != 0 {
		return "", false
	}
	if m := tsClass.FindStringSubmatch(line); m != nil {
		return m[1], true
	}
	for _, re := range []*regexp.Regexp{tsFunc, tsVar, tsType} {
		if m := re.FindStringSubmatch(line); m != nil {
			return m[1], false
		}
	}
	return "", false
}

func pyDecl(line string, st *declState) (string, bool) {
	ind := len(line) - len(strings.TrimLeft(line, " \t"))
	if st.class != "" && strings.TrimSpace(line) != "" && ind <= st.classInd {
		st.class = ""
	}
	if m := pyClass.FindStringSubmatch(line); m != nil && len(m[1]) == 0 {
		st.classInd = 0
		return m[2], true
	}
	if m := pyDef.FindStringSubmatch(line); m != nil {
		if len(m[1]) == 0 {
			return m[2], false
		}
		if st.class != "" {
			return st.class + "." + m[2], false
		}
	}
	return "", false
}

func protoDecl(line string, st *declState) (string, bool) {
	if m := pbSvc.FindStringSubmatch(line); m != nil {
		return m[1], true
	}
	if m := pbRPC.FindStringSubmatch(line); m != nil && st.class != "" {
		return st.class + "." + m[1], false
	}
	if m := pbMsg.FindStringSubmatch(line); m != nil && st.depth == 0 {
		return m[1], false
	}
	return "", false
}

func sqlDecl(line string, _ *declState) (string, bool) {
	if m := sqlTable.FindStringSubmatch(line); m != nil {
		return m[2], false
	}
	return "", false
}

// lineSymbols reads declarations line by line. With braces, it tracks brace depth so it knows
// which class (or proto service) body a line sits in; without, decl tracks indentation itself.
func lineSymbols(abs string, decl declFn, braces bool) (map[string]Span, error) {
	fh, err := os.Open(abs)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	out := map[string]Span{}
	st := &declState{}
	sc := bufio.NewScanner(fh)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	n := 0
	for sc.Scan() {
		n++
		line := sc.Text()
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "//") || strings.HasPrefix(t, "*") || strings.HasPrefix(t, "--") {
			continue
		}
		if name, container := decl(line, st); name != "" {
			if _, dup := out[name]; !dup {
				out[name] = Span{Line: n}
			}
			if container {
				st.class, st.classDepth, st.classInd = name, st.depth+1, len(line)-len(strings.TrimLeft(line, " \t"))
			}
		}
		if braces {
			bare := stripStrings(line)
			st.depth += strings.Count(bare, "{") - strings.Count(bare, "}")
			if st.depth < 0 {
				st.depth = 0
			}
		}
		if braces && st.class != "" && st.depth < st.classDepth {
			st.class = ""
		}
	}
	return out, sc.Err()
}

var strLit = regexp.MustCompile(`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|` + "`[^`]*`")

func stripStrings(s string) string { return strLit.ReplaceAllString(s, "") }
