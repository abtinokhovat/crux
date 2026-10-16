// Package index is the language-neutral heart of crux's code index. A language analyzer (a
// separate program per language: Go types, the TypeScript compiler, a SCIP indexer…) reads code
// and prints a Program: units, functions, and every call with its arguments evaluated as far as
// the language can. Recognizer rules (rules/*.yaml) say which library calls mean "publishes to a
// topic", "serves a route", "calls a gRPC service"; Interpret turns calls into observations,
// follows wrappers, and attributes each observation to the entry points that reach it. No part
// of this package knows a language — adding one means writing an analyzer, not editing the core.
package index

// Program is what an analyzer reports for one language in one repository.
type Program struct {
	Lang  string   `json:"lang"`
	Units []Unit   `json:"units"`
	Funcs []Func   `json:"funcs"`
	Calls []Call   `json:"calls"`
	Types []Type   `json:"types,omitempty"`
	Notes []string `json:"notes,omitempty"` // what the analyzer could not do (load errors, unresolved calls)
}

// Type is a declared record type (a struct, a class, an interface of fields): what Candidates
// reads to find the entities. Analyzers skip generated files.
type Type struct {
	ID     string  `json:"id"` // "<unit>.<Name>"
	Unit   string  `json:"unit"`
	File   string  `json:"file"`
	Line   int     `json:"line"`
	Fields []Field `json:"fields"`
	Table  string  `json:"table,omitempty"` // when the code names its table (a TableName() method)
}

type Field struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Tag      string `json:"tag,omitempty"`
	Embedded bool   `json:"embedded,omitempty"`
}

// Unit is a package or module: the thing a callee id is qualified by.
type Unit struct {
	ID   string `json:"id"`   // import path / npm package
	Dir  string `json:"dir"`  // slash path from the repo root
	Main bool   `json:"main"` // builds a program: its main/init start the call graph
}

// Func is a declared function or method. ID is "<unit>.<Name>" or "<unit>.<Type>.<Method>".
type Func struct {
	ID   string `json:"id"`
	Unit string `json:"unit"`
	File string `json:"file"`
	Line int    `json:"line"`
}

// Call is one call, or one composite literal (Callee ends in "{}", Fields set), or one
// reference to a function used as a value (Ref).
type Call struct {
	Caller string           `json:"caller"` // Func id; "<unit>.init" at package level
	Callee string           `json:"callee"` // same id form as Func
	Unit   string           `json:"unit"`
	File   string           `json:"file"`
	Line   int              `json:"line"`
	Args   []Value          `json:"args,omitempty"`
	Fields map[string]Value `json:"fields,omitempty"`
	Ref    bool             `json:"ref,omitempty"`
}

// Value is an argument as far as the analyzer could evaluate it. Kinds:
//
//	const    Str is the exact value
//	pattern  Str is a value with * where a part is not known ("parser.*")
//	param    flows from the caller's parameter number Param (how wrappers are followed); Elem: each element of it
//	list     Items are the elements (as a name: each one names a separate thing)
//	field    read from a struct field; Str is "Type.Field"
//	env      read from environment variable Str
//	dynamic  anything else; Str is the expression text
type Value struct {
	Kind  string  `json:"kind"`
	Str   string  `json:"str,omitempty"`
	Param int     `json:"param,omitempty"`
	Elem  bool    `json:"elem,omitempty"` // param: an element of the argument, not the argument
	Type  string  `json:"type,omitempty"`
	Items []Value `json:"items,omitempty"`
}

func (v Value) Exact() bool { return v.Kind == "const" }
