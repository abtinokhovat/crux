---
crux: service
id: cli
title: crux CLI
summary: the binary — every command, the local app and the share server
tech: [go]
code: [cmd/crux/**, internal/cli/**]
depends_on: [graph, scanner, linter, workflow, app]
calls: ["share-server via http:POST /api/items", "share-server via http:PATCH /api/items/{id}", "share-server via http:GET /api/items/{id}"]
decided_by: [1, 5]
---
# crux CLI

Entry point for every command. `crux serve` starts the local [[app]]; `crux server` runs the
[[share-server]].
