---
title: A built-in catalog styles technologies and transports
status: Accepted
date: 2026-10-06
author: abtin
tags: [visual, catalog]
components: [catalog, app]
applies_to: [internal/catalog/**, web/**]
---

## Decision {span=3}
```callout ok Decision
Ship a catalog of technologies (label, category, color, icon, shape, detect rules) and transports (mode: sync, async, stream, data, trigger). Authors only name `tech:` and transports; boxes, chips, edge styles, icons and legends follow. Icons come from Simple Icons (CC0), bundled only for catalog entries. Projects extend it in `.crux/catalog.yaml`.
```

## Context {span=3}
- People skim pictures; every diagram should look finished without styling work.
- The scanner needs the same detect rules to suggest `tech:` from go.mod, package.json and images.

## Consequences {span=3}
- Positive: one source for look and detection; consistent across map, element pages and components.
- Cost: the catalog needs care as tools change; unknown tech still works with a monogram.
