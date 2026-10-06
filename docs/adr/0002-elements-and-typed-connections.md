---
title: Elements with typed connections; contracts as transport:name
status: Accepted
date: 2026-10-06
author: abtin
tags: [format, graph]
components: [graph]
depends_on: [0001]
applies_to: [internal/adr/**, skills/crux/reference.md]
---

## Decision {span=3}
```callout ok Decision
Describe the system as elements of about twenty kinds (service, store, broker, contract, entity, flow, question…). Connect them with typed frontmatter lists (`calls`, `exposes`, `uses`, `publishes`, `consumes`, `reads`, `writes`, `owns`, `decided_by`, `blocked_by`…). A connection to an interface is a contract reference `transport:name`; a reference creates the contract, a contract file adds detail.
```

## Context {span=3}
- Agents need to answer "how does X reach Y" by walking hops, not by grepping.
- A bare arrow loses the protocol; a separate interface file for every endpoint is too much work.
- Publisher and consumer are written by different teams and should not have to name each other.

## Options {span=3}
| Option | Pros | Cons | Fit |
|---|---|---|---|
| A — Typed lists + contract refs, derived edges | Each side writes its own fact. Topics connect producers and consumers automatically. | A vocabulary to learn. | ok |
| B — Free arrows with labels | Easy to write. | No protocol, no checks, no derived links. | no |
| C — Full C4 / Structurizr model | Rich and known. | A second DSL; far from the code; no decisions or flows. | warn |

## Consequences {span=3}
- Positive: lint can check flow hops and contract sides; the map and element pages need no extra input.
- Cost: the vocabulary must stay small and stable — aliases absorb common words (`worker`, `database`, `emits`).
