package main

import (
	"fmt"
	"go/ast"
	"go/constant"
	"go/token"
	"go/types"
	"io/fs"
	"path/filepath"
	"regexp"
	"strings"

	"golang.org/x/tools/go/packages"
)

type analyzer struct {
	root  string
	globs []*regexp.Regexp
	prog  *Program
	seen  map[string]bool // package paths already analyzed (a package can load from two modules)
	// repo-wide, for interface expansion
	repoNamed                 []*types.Named
	stores                    []Call                  // writes to struct fields (Callee "<unit>.<Type>.<field>=")
	assigns                   map[*types.Var][]assign // every assignment to a variable; exactly one means it can be followed
	tables                    map[string]string       // type id → table name from a TableName() method
	impls                     map[string][]string
	ifaceCalls, ifaceExpanded int
}

func analyze(root string, globs []*regexp.Regexp) (*Program, error) {
	a := &analyzer{root: root, globs: globs, prog: &Program{Lang: "go"}, seen: map[string]bool{}, impls: map[string][]string{}, assigns: map[*types.Var][]assign{}, tables: map[string]string{}}
	var all []*packages.Package
	for _, dir := range goModDirs(root) {
		cfg := &packages.Config{Dir: dir, Mode: packages.NeedName | packages.NeedFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedDeps}
		pkgs, err := packages.Load(cfg, "./...")
		if err != nil {
			a.prog.Notes = append(a.prog.Notes, fmt.Sprintf("load %s: %v", rel(root, dir), err))
			continue
		}
		for _, p := range pkgs {
			if len(p.Errors) > 0 {
				a.prog.Notes = append(a.prog.Notes, fmt.Sprintf("%s: %d load errors, e.g. %s", p.PkgPath, len(p.Errors), p.Errors[0].Msg))
			}
			all = append(all, p)
		}
	}
	var mine []*packages.Package
	for _, p := range all {
		if a.seen[p.PkgPath] || !a.inRepo(p) {
			continue
		}
		a.seen[p.PkgPath] = true
		mine = append(mine, p)
		if p.Types != nil {
			for _, n := range p.Types.Scope().Names() {
				if tn, ok := p.Types.Scope().Lookup(n).(*types.TypeName); ok {
					if nt, ok := tn.Type().(*types.Named); ok {
						a.repoNamed = append(a.repoNamed, nt)
					}
				}
			}
		}
	}
	for _, p := range mine {
		a.unit(p)
		a.collectAssigns(p)
	}
	for _, p := range mine {
		a.walk(p)
		a.types(p)
	}
	for i := range a.prog.Types {
		a.prog.Types[i].Table = a.tables[a.prog.Types[i].ID]
	}
	a.keepStores()
	if a.ifaceCalls > 0 {
		a.prog.Notes = append(a.prog.Notes, fmt.Sprintf("%d calls through the repository's interfaces, expanded to %d implementing methods", a.ifaceCalls, a.ifaceExpanded))
	}
	return a.prog, nil
}

// goModDirs lists every module root (a go.mod folder) — a monorepo may hold several, and
// go/packages loads one module at a time.
func goModDirs(root string) []string {
	var dirs []string
	filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			switch d.Name() {
			case ".git", "node_modules", "vendor", "testdata":
				return filepath.SkipDir
			}
			return nil
		}
		if d.Name() == "go.mod" {
			dirs = append(dirs, filepath.Dir(p))
		}
		return nil
	})
	if len(dirs) == 0 {
		dirs = []string{root}
	}
	return dirs
}

func (a *analyzer) inRepo(p *packages.Package) bool {
	if len(p.GoFiles) == 0 {
		return false
	}
	r := rel(a.root, p.GoFiles[0])
	return !strings.HasPrefix(r, "../")
}

func rel(root, p string) string {
	r, err := filepath.Rel(root, p)
	if err != nil {
		return p
	}
	return filepath.ToSlash(r)
}

func (a *analyzer) unit(p *packages.Package) {
	a.prog.Units = append(a.prog.Units, Unit{ID: p.PkgPath, Dir: filepath.ToSlash(filepath.Dir(rel(a.root, p.GoFiles[0]))), Main: p.Name == "main"})
}

func funcID(fo *types.Func) string {
	if fo == nil || fo.Pkg() == nil {
		return ""
	}
	fo = fo.Origin()
	if sig, ok := fo.Type().(*types.Signature); ok && sig.Recv() != nil {
		t := sig.Recv().Type()
		if ptr, ok := t.(*types.Pointer); ok {
			t = ptr.Elem()
		}
		if n, ok := t.(*types.Named); ok {
			return fo.Pkg().Path() + "." + n.Obj().Name() + "." + fo.Name()
		}
	}
	return fo.Pkg().Path() + "." + fo.Name()
}

func typeID(n *types.Named) string {
	if n.Obj().Pkg() == nil {
		return n.Obj().Name()
	}
	return n.Obj().Pkg().Path() + "." + n.Obj().Name()
}

func (a *analyzer) keep(id string) bool {
	for _, g := range a.globs {
		if g.MatchString(id) {
			return true
		}
	}
	return false
}

// ctx is what the walk knows about the enclosing function.
type ctx struct {
	p      *packages.Package
	caller string
	params map[*types.Var]int
	depth  int
}

// assign is one assignment to a variable. multi marks anything that is not a plain 1:1 write
// (tuple results, range, +=, ++), which makes the variable unresolvable.
type assign struct {
	expr  ast.Expr
	p     *packages.Package
	multi bool
	elem  bool // the variable takes each element of expr (for _, v := range expr)
}

func (a *analyzer) collectAssigns(p *packages.Package) {
	info := p.TypesInfo
	varOf := func(e ast.Expr) *types.Var {
		if id, ok := e.(*ast.Ident); ok {
			v, _ := info.ObjectOf(id).(*types.Var)
			return v
		}
		return nil
	}
	mark := func(e ast.Expr, expr ast.Expr, multi bool) {
		if v := varOf(e); v != nil {
			a.assigns[v] = append(a.assigns[v], assign{expr: expr, p: p, multi: multi})
		}
	}
	for _, f := range p.Syntax {
		ast.Inspect(f, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.AssignStmt:
				oneToOne := len(x.Lhs) == len(x.Rhs) && (x.Tok == token.ASSIGN || x.Tok == token.DEFINE)
				for i, l := range x.Lhs {
					if oneToOne {
						mark(l, x.Rhs[i], false)
					} else {
						mark(l, nil, true)
					}
				}
			case *ast.ValueSpec:
				for i, id := range x.Names {
					if len(x.Values) == len(x.Names) {
						mark(id, x.Values[i], false)
					} else if len(x.Values) > 0 {
						mark(id, nil, true)
					}
				}
			case *ast.IncDecStmt:
				mark(x.X, nil, true)
			case *ast.RangeStmt:
				if x.Key != nil {
					mark(x.Key, nil, true)
				}
				if x.Value != nil {
					if v := varOf(x.Value); v != nil {
						a.assigns[v] = append(a.assigns[v], assign{expr: x.X, p: p, elem: true})
					}
				}
			case *ast.UnaryExpr:
				if x.Op == token.AND { // address taken: it may be written anywhere
					mark(x.X, nil, true)
				}
			}
			return true
		})
	}
}

// follow resolves a variable that is written exactly once to what was written.
func (a *analyzer) follow(c *ctx, v *types.Var) (Value, bool) {
	as := a.assigns[v]
	if len(as) != 1 || as[0].multi || as[0].expr == nil || c.depth > 8 {
		return Value{}, false
	}
	nc := &ctx{p: as[0].p, caller: c.caller, params: c.params, depth: c.depth + 1}
	if v.Parent() != nil && v.Pkg() != nil && v.Parent() == v.Pkg().Scope() { // package-level
		nc.params = nil
		nc.caller = v.Pkg().Path() + ".init"
	}
	r := a.evalKind(nc, as[0].expr)
	if as[0].elem {
		switch r.Kind {
		case "param":
			r.Elem = true // each element of the argument passed for that parameter
		case "list":
		default:
			return Value{}, false
		}
	}
	if r.Kind == "dynamic" {
		return Value{}, false
	}
	return r, true
}

func (a *analyzer) walk(p *packages.Package) {
	for _, f := range p.Syntax {
		for _, d := range f.Decls {
			switch d := d.(type) {
			case *ast.FuncDecl:
				fo, _ := p.TypesInfo.Defs[d.Name].(*types.Func)
				id := funcID(fo)
				if id == "" {
					continue
				}
				a.tableName(p, d, fo)
				pos := p.Fset.Position(d.Pos())
				a.prog.Funcs = append(a.prog.Funcs, Func{ID: id, Unit: p.PkgPath, File: rel(a.root, pos.Filename), Line: pos.Line})
				c := &ctx{p: p, caller: id, params: map[*types.Var]int{}}
				if sig, ok := fo.Type().(*types.Signature); ok {
					for i := 0; i < sig.Params().Len(); i++ {
						c.params[sig.Params().At(i)] = i
					}
				}
				if d.Body != nil {
					a.visit(c, d.Body)
				}
			case *ast.GenDecl:
				c := &ctx{p: p, caller: p.PkgPath + ".init"}
				a.visit(c, d)
			}
		}
	}
}

func (a *analyzer) visit(c *ctx, root ast.Node) {
	funIdents := map[*ast.Ident]bool{}
	ast.Inspect(root, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.CallExpr:
			id := calleeIdent(x.Fun)
			if id != nil {
				funIdents[id] = true
			}
			a.call(c, x, id)
		case *ast.CompositeLit:
			a.literal(c, x)
			a.litStores(c, x)
		case *ast.AssignStmt:
			a.assignStores(c, x)
		case *ast.Ident:
			if !funIdents[x] {
				a.ref(c, x)
			}
		}
		return true
	})
}

func calleeIdent(e ast.Expr) *ast.Ident {
	switch f := e.(type) {
	case *ast.ParenExpr:
		return calleeIdent(f.X)
	case *ast.Ident:
		return f
	case *ast.SelectorExpr:
		return f.Sel
	case *ast.IndexExpr: // generic instantiation f[T](…)
		return calleeIdent(f.X)
	case *ast.IndexListExpr:
		return calleeIdent(f.X)
	}
	return nil
}

func (a *analyzer) call(c *ctx, x *ast.CallExpr, id *ast.Ident) {
	if id == nil {
		return
	}
	fo, _ := c.p.TypesInfo.Uses[id].(*types.Func)
	if fo == nil || fo.Pkg() == nil {
		return
	}
	callee := funcID(fo)
	pos := c.p.Fset.Position(x.Pos())
	base := Call{Caller: c.caller, Callee: callee, Unit: c.p.PkgPath, File: rel(a.root, pos.Filename), Line: pos.Line}
	if a.external(fo) && !a.keep(callee) {
		return
	}
	for _, arg := range x.Args {
		base.Args = append(base.Args, a.eval(c, arg))
	}
	a.prog.Calls = append(a.prog.Calls, base)
	a.expandInterface(c, x, fo, pos)
}

// expandInterface adds a reference to every repository type's method that can answer a call
// through one of the repository's own interfaces — class-hierarchy analysis, so reachability
// follows `svc.Create(...)` into the implementation.
func (a *analyzer) expandInterface(c *ctx, x *ast.CallExpr, fo *types.Func, pos token.Position) {
	sel, ok := x.Fun.(*ast.SelectorExpr)
	if !ok {
		return
	}
	s := c.p.TypesInfo.Selections[sel]
	if s == nil {
		return
	}
	named, ok := s.Recv().(*types.Named)
	if !ok {
		return
	}
	iface, ok := named.Underlying().(*types.Interface)
	if !ok || named.Obj().Pkg() == nil || !a.seen[named.Obj().Pkg().Path()] {
		return
	}
	a.ifaceCalls++
	key := typeID(named) + "." + fo.Name()
	targets, done := a.impls[key]
	if !done {
		for _, t := range a.repoNamed {
			if _, isIface := t.Underlying().(*types.Interface); isIface {
				continue
			}
			if types.Implements(t, iface) || types.Implements(types.NewPointer(t), iface) {
				targets = append(targets, t.Obj().Pkg().Path()+"."+t.Obj().Name()+"."+fo.Name())
			}
		}
		a.impls[key] = targets
	}
	for _, t := range targets {
		a.ifaceExpanded++
		a.prog.Calls = append(a.prog.Calls, Call{Caller: c.caller, Callee: t, Unit: c.p.PkgPath, File: rel(a.root, pos.Filename), Line: pos.Line, Ref: true})
	}
}

func (a *analyzer) external(fo *types.Func) bool {
	return !a.seen[fo.Pkg().Path()]
}

// ref records a function used as a value (a handler passed to a router, a callback), so the
// call graph reaches it.
func (a *analyzer) ref(c *ctx, id *ast.Ident) {
	fo, _ := c.p.TypesInfo.Uses[id].(*types.Func)
	if fo == nil || fo.Pkg() == nil || a.external(fo) {
		return
	}
	pos := c.p.Fset.Position(id.Pos())
	a.prog.Calls = append(a.prog.Calls, Call{Caller: c.caller, Callee: funcID(fo), Unit: c.p.PkgPath, File: rel(a.root, pos.Filename), Line: pos.Line, Ref: true})
}

// literal records a composite literal of a library struct (sarama.ProducerMessage{Topic: …}).
func (a *analyzer) literal(c *ctx, x *ast.CompositeLit) {
	t := c.p.TypesInfo.TypeOf(x)
	if t == nil {
		return
	}
	if ptr, ok := t.(*types.Pointer); ok {
		t = ptr.Elem()
	}
	n, ok := t.(*types.Named)
	if !ok || n.Obj().Pkg() == nil || a.seen[n.Obj().Pkg().Path()] {
		return
	}
	id := typeID(n) + "{}"
	if !a.keep(id) {
		return
	}
	fields := map[string]Value{}
	for _, el := range x.Elts {
		kv, ok := el.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if k, ok := kv.Key.(*ast.Ident); ok {
			fields[k.Name] = a.eval(c, kv.Value)
		}
	}
	pos := c.p.Fset.Position(x.Pos())
	a.prog.Calls = append(a.prog.Calls, Call{Caller: c.caller, Callee: id, Unit: c.p.PkgPath, File: rel(a.root, pos.Filename), Line: pos.Line, Fields: fields})
}

// litStores records the fields a struct literal of one of the repository's own types sets.
func (a *analyzer) litStores(c *ctx, x *ast.CompositeLit) {
	t := c.p.TypesInfo.TypeOf(x)
	if t == nil {
		return
	}
	if ptr, ok := t.(*types.Pointer); ok {
		t = ptr.Elem()
	}
	n, ok := t.(*types.Named)
	if !ok || n.Obj().Pkg() == nil || !a.seen[n.Obj().Pkg().Path()] {
		return
	}
	if _, ok := n.Underlying().(*types.Struct); !ok {
		return
	}
	for _, el := range x.Elts {
		kv, ok := el.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if k, ok := kv.Key.(*ast.Ident); ok {
			a.store(c, typeID(n)+"."+k.Name, kv.Value, kv.Pos())
		}
	}
}

// assignStores records `x.field = value`.
func (a *analyzer) assignStores(c *ctx, x *ast.AssignStmt) {
	if x.Tok != token.ASSIGN || len(x.Lhs) != len(x.Rhs) {
		return
	}
	for i, l := range x.Lhs {
		if sel, ok := l.(*ast.SelectorExpr); ok {
			if id := fieldID(c.p.TypesInfo, sel); id != "" {
				a.store(c, id, x.Rhs[i], x.Pos())
			}
		}
	}
}

func (a *analyzer) store(c *ctx, field string, value ast.Expr, p token.Pos) {
	v := a.eval(c, value)
	if v.Kind == "dynamic" {
		return
	}
	pos := c.p.Fset.Position(p)
	a.stores = append(a.stores, Call{Caller: c.caller, Callee: field + "=", Unit: c.p.PkgPath, File: rel(a.root, pos.Filename), Line: pos.Line, Args: []Value{v}})
}

// keepStores emits the field writes a recognized call can depend on: the fields it reads as
// names, and — following each write's own value — the fields those were copied from.
func (a *analyzer) keepStores() {
	want := map[string]bool{}
	var scan func(v Value)
	scan = func(v Value) {
		if v.Kind == "field" {
			want[v.Str] = true
		}
		for _, it := range v.Items {
			scan(it)
		}
	}
	for _, c := range a.prog.Calls {
		if c.Ref {
			continue
		}
		for _, v := range c.Args {
			scan(v)
		}
		for _, v := range c.Fields {
			scan(v)
		}
	}
	for changed := true; changed; {
		changed = false
		for _, s := range a.stores {
			if want[strings.TrimSuffix(s.Callee, "=")] && s.Args[0].Kind == "field" && !want[s.Args[0].Str] {
				want[s.Args[0].Str] = true
				changed = true
			}
		}
	}
	for _, s := range a.stores {
		if want[strings.TrimSuffix(s.Callee, "=")] {
			a.prog.Calls = append(a.prog.Calls, s)
		}
	}
}

func qualifier(p *types.Package) string { return p.Path() }

// fieldID names a struct field by the type that declares it ("<unit>.<Type>.<field>"), following
// embedded structs, so a write in one place and a read in another meet on the same id.
func fieldID(info *types.Info, x *ast.SelectorExpr) string {
	s := info.Selections[x]
	if s == nil || s.Kind() != types.FieldVal {
		return ""
	}
	t := s.Recv()
	idx := s.Index()
	for _, i := range idx[:len(idx)-1] {
		st := structOf(t)
		if st == nil {
			return ""
		}
		t = st.Field(i).Type()
	}
	if ptr, ok := t.(*types.Pointer); ok {
		t = ptr.Elem()
	}
	n, ok := t.(*types.Named)
	if !ok || n.Obj().Pkg() == nil {
		return ""
	}
	return typeID(n) + "." + x.Sel.Name
}

func structOf(t types.Type) *types.Struct {
	if ptr, ok := t.(*types.Pointer); ok {
		t = ptr.Elem()
	}
	st, _ := t.Underlying().(*types.Struct)
	return st
}

// eval evaluates an expression as far as the types allow.
func (a *analyzer) eval(c *ctx, e ast.Expr) Value {
	v := a.evalKind(c, e)
	if tv, ok := c.p.TypesInfo.Types[e]; ok && tv.Type != nil {
		v.Type = types.TypeString(tv.Type, qualifier)
	}
	return v
}

func (a *analyzer) evalKind(c *ctx, e ast.Expr) Value {
	info := c.p.TypesInfo
	if tv, ok := info.Types[e]; ok && tv.Value != nil {
		if tv.Value.Kind() == constant.String {
			return Value{Kind: "const", Str: constant.StringVal(tv.Value)}
		}
		return Value{Kind: "const", Str: tv.Value.ExactString()}
	}
	switch x := e.(type) {
	case *ast.ParenExpr:
		return a.evalKind(c, x.X)
	case *ast.Ident:
		if v, ok := info.Uses[x].(*types.Var); ok {
			if i, ok := c.params[v]; ok && len(a.assigns[v]) == 0 { // a reassigned parameter no longer carries the argument
				return Value{Kind: "param", Param: i}
			}
			if r, ok := a.follow(c, v); ok {
				return r
			}
		}
	case *ast.SelectorExpr:
		if id := fieldID(info, x); id != "" {
			return Value{Kind: "field", Str: id}
		}
	case *ast.BinaryExpr:
		if x.Op == token.ADD {
			return joinPattern(a.evalKind(c, x.X), a.evalKind(c, x.Y), types.ExprString(e))
		}
	case *ast.CallExpr:
		if tv, ok := info.Types[x.Fun]; ok && tv.IsType() && len(x.Args) == 1 { // a conversion: string(x)
			return a.evalKind(c, x.Args[0])
		}
		if id := calleeIdent(x.Fun); id != nil {
			if fo, _ := info.Uses[id].(*types.Func); fo != nil && fo.Pkg() != nil {
				switch funcID(fo) {
				case "fmt.Sprintf":
					if len(x.Args) > 0 {
						if f := a.evalKind(c, x.Args[0]); f.Kind == "const" {
							return Value{Kind: "pattern", Str: fmtVerbs.ReplaceAllString(f.Str, "*")}
						}
					}
				case "os.Getenv", "os.LookupEnv":
					if len(x.Args) > 0 {
						if n := a.evalKind(c, x.Args[0]); n.Kind == "const" {
							return Value{Kind: "env", Str: n.Str}
						}
					}
				}
			}
		}
	case *ast.CompositeLit:
		if _, ok := info.TypeOf(x).Underlying().(*types.Slice); ok {
			var items []Value
			for _, el := range x.Elts {
				items = append(items, a.eval(c, el))
			}
			return Value{Kind: "list", Items: items}
		}
	}
	return Value{Kind: "dynamic", Str: types.ExprString(e)}
}

var fmtVerbs = regexp.MustCompile(`%[-+# 0-9.]*[a-zA-Z]`)

// joinPattern concatenates two values: exact when both are, a pattern with * for the unknown
// part when one is, dynamic when neither is.
func joinPattern(l, r Value, expr string) Value {
	part := func(v Value) (string, bool) {
		switch v.Kind {
		case "const", "pattern":
			return v.Str, true
		}
		return "*", false
	}
	ls, lok := part(l)
	rs, rok := part(r)
	switch {
	case l.Kind == "const" && r.Kind == "const":
		return Value{Kind: "const", Str: ls + rs}
	case lok || rok:
		return Value{Kind: "pattern", Str: collapse(ls + rs)}
	}
	return Value{Kind: "dynamic", Str: expr}
}

func collapse(s string) string {
	for strings.Contains(s, "**") {
		s = strings.ReplaceAll(s, "**", "*")
	}
	return s
}

var generatedRe = regexp.MustCompile(`^// Code generated .* DO NOT EDIT\.?$`)

func generated(f *ast.File) bool {
	for _, cg := range f.Comments {
		for _, c := range cg.List {
			if generatedRe.MatchString(c.Text) {
				return true
			}
		}
		if cg.Pos() > f.Package {
			break
		}
	}
	return false
}

// types records the record types a package declares (exported structs, generated files
// skipped): the raw material for entity candidates.
func (a *analyzer) types(p *packages.Package) {
	for _, f := range p.Syntax {
		if generated(f) {
			continue
		}
		for _, d := range f.Decls {
			gd, ok := d.(*ast.GenDecl)
			if !ok || gd.Tok != token.TYPE {
				continue
			}
			for _, sp := range gd.Specs {
				ts, ok := sp.(*ast.TypeSpec)
				if !ok || !ts.Name.IsExported() {
					continue
				}
				st, ok := ts.Type.(*ast.StructType)
				if !ok || st.Fields == nil {
					continue
				}
				pos := p.Fset.Position(ts.Pos())
				t := Type{ID: p.PkgPath + "." + ts.Name.Name, Unit: p.PkgPath, File: rel(a.root, pos.Filename), Line: pos.Line}
				for _, fl := range st.Fields.List {
					typ := types.ExprString(fl.Type)
					tag := ""
					if fl.Tag != nil {
						tag = strings.Trim(fl.Tag.Value, "`\"")
					}
					if len(fl.Names) == 0 { // embedded
						t.Fields = append(t.Fields, Field{Name: strings.TrimLeft(typ, "*"), Type: typ, Tag: tag, Embedded: true})
					}
					for _, n := range fl.Names {
						t.Fields = append(t.Fields, Field{Name: n.Name, Type: typ, Tag: tag})
					}
					if len(t.Fields) >= 60 {
						break
					}
				}
				a.prog.Types = append(a.prog.Types, t)
			}
		}
	}
}

// tableName notices `func (T) TableName() string { return "x" }`.
func (a *analyzer) tableName(p *packages.Package, d *ast.FuncDecl, fo *types.Func) {
	if d.Name.Name != "TableName" || d.Recv == nil || d.Body == nil || len(d.Body.List) != 1 {
		return
	}
	ret, ok := d.Body.List[0].(*ast.ReturnStmt)
	if !ok || len(ret.Results) != 1 {
		return
	}
	c := &ctx{p: p, caller: funcID(fo)}
	if v := a.evalKind(c, ret.Results[0]); v.Kind == "const" {
		id := funcID(fo)
		a.tables[strings.TrimSuffix(id, ".TableName")] = v.Str
	}
}
