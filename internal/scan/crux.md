---
crux: module
id: scanner
in: cli
summary: facts from code — Go, TS/JS and infra adapters; wiring, tables, protos, handlers
tech: [go]
reads: [repo]
depends_on: [graph, catalog, anchors]
decided_by: [5]
---
# Scanner

## Deep mode

`crux scan --deep` adds the type-aware analyzers on top of the text adapters. An analyzer is a
program per language (`crux-analyze-go` today, found next to `crux` or on PATH, or set in
`scan.analyzers`) that prints a language-neutral Program (`internal/index`): functions, calls
with evaluated arguments, library struct literals, field writes. `internal/index` holds the rules
(`rules/*.yaml`: which library call means publish, consume, route, gRPC client, store use), follows
a name through wrapper functions, struct fields and ranges, and names the entry points whose
call graph reaches each observation. What it cannot resolve stays in `Facts.Obs` with the
expression and its location, never guessed.

