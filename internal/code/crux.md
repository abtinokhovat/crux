---
crux: module
id: anchors
in: cli
summary: code anchors — path#Symbol resolved to file:line (Go, TS/JS, Python, proto, SQL)
tech: [go]
reads: [repo]
at: [internal/code/anchor.go#Resolver.Resolve]
---
# Anchors

Resolves the anchors crux files write (`at:`, ` @ ` on steps and connections) and the ones the
scanner finds (route handlers, gRPC server methods, tables) to file and line. Symbols are
parsed, never guessed: a missing or ambiguous symbol is an error lint reports.
