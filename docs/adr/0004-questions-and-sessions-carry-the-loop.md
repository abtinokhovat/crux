---
title: Questions and sessions carry the design → model → build loop
status: Accepted
date: 2026-10-06
author: abtin
tags: [workflow, agents]
components: [workflow]
applies_to: [internal/flow/**, skills/**]
---

## Decision {span=3}
```callout ok Decision
Sessions run in the user's agent harness; crux stores their results. An unknown becomes a `crux: question` with `raised_from` (a flow step or element) and `blocks`. Each session ends with a `crux: session` file listing what it produced. Agents never fill an unknown with an assumption.
```

## Context {span=3}
- Design happens in conversation; without a record it must be recapped later.
- Implementation agents hit known unknowns; guessing hides them until production.

## Consequences {span=3}
- Positive: the question board, flow routes and element pages show exactly what is open and what it blocks.
- Cost: agents must follow the skills; lint reports questions pointing at missing steps.
