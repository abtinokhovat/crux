---
title: Code facts come from language adapters; lint compares docs with code
status: Accepted
date: 2026-10-06
author: abtin
tags: [lint, scan]
components: [scanner, linter]
applies_to: [internal/scan/**, internal/lint/**]
reopen_when: ["a team needs a language without an adapter and a facts-printing command is not enough"]
---

## Decision {span=3}
```callout ok Decision
A language-agnostic core compares what crux files declare with facts from the code: modules and imports, HTTP routes, gRPC services, topics and queues with their side, technologies, deployables and infrastructure. Built-in adapters cover Go, TypeScript/JavaScript and infra files; any other language plugs in a command that prints the facts JSON.
```

## Options {span=3}
| Option | Pros | Cons | Fit |
|---|---|---|---|
| A — Pattern adapters in the binary + command plug-ins | No toolchain needed; fast (2.6 s on 2,600 Go files). | Patterns miss wrapped clients; config adds more. | ok |
| B — Full type-checked analysis (go/packages, tsc) | Exact. | Needs toolchains and builds; slow; per-language depth. | warn |
| C — No code checks | Simple. | Docs drift silently. | no |

## Consequences {span=3}
- Positive: drift shows up as lint findings with a fix line; `crux scan` feeds the adopt skill.
- Cost: findings are heuristics; `lint.ignore` and `lint.topics` tune them per project.
