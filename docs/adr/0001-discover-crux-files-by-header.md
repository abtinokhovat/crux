---
title: Discover crux files by their header, not by name or folder
status: Accepted
date: 2026-10-06
author: abtin
tags: [format, discovery]
components: [graph]
applies_to: [internal/adr/**]
reopen_when: ["header scan takes more than 1 s on a 10k-file repo"]
---

## Decision {span=3}
```callout ok Decision
Any `.md` file whose frontmatter has a `crux:` key joins the graph, wherever it is. The value is the kind. File names and folders carry no meaning, except that a code kind's folder is its default `code:` path and an enclosing container is its default parent.
```

## Context {span=3}
- Teams keep docs in different places; a naming convention would fight every existing layout.
- A service's description belongs next to its code, where agents and reviewers already look.
- The previous model needed one `architecture.yaml`; it grew large and drifted from the code.

## Options {span=3}
| Option | Pros | Cons | Fit |
|---|---|---|---|
| A — Header key `crux:` anywhere | No convention. Files live next to code. | Must walk the repo. | ok |
| B — Fixed folders (`docs/system/…`) | Cheap to find. | Far from code; a second tree to keep in sync. | no |
| C — One YAML map | One file to read. | Grows unreadable; merge conflicts; no prose. | no |

## Consequences {span=3}
- Positive: files sit next to the code; `code:` and parents need no typing.
- Cost: every load walks the repo; `.gitignore`, hidden and vendor folders are skipped and only the frontmatter is read.
- Follow-up: `architecture.yaml` stays optional for hand-drawn layouts.
