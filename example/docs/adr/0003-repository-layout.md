---
title: ADR-0003 — Repository layout
subtitle: One Go module; services under services/, binaries under cmd/, shared code in pkg/
status: Accepted
date: 2026-09-20
author: backfill
tags: [layout, go]
components: [backend]
---

## Decision {span=3}
```callout ok Decision
Use one Go module at the repo root. Put each service in `services/<svc>/`, its binary in `cmd/<svc>/`, and shared code in `pkg/`.
```

## Layout {span=3}
```tree
repo
  `cmd/` binaries | one main per deployable
  `services/` bounded contexts | no cross-imports
  `pkg/` shared | kafka, db, errors
  `contract/` APIs | proto and OpenAPI
```

## Evidence {span=3}
- `go.mod` added in commit `a1b2c3d` on 2026-09-20 (inferred from history).
- No record of alternatives considered.

## Consequences {span=3}
- Positive: one `go test ./...`, one dependency graph.
- Cost we accept: every service upgrades shared dependencies together.
- Follow-ups: add a lint rule that blocks `services/a` importing `services/b`.
