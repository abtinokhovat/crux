# adr-kit

Architecture Decision Records you can **see**. ADRs stay plain markdown in your repo; `adr serve`
turns them into a connected, visual app:

- **Overview**: a blueprint sheet with numbered and lettered rulers, a title block, the open questions that still need a decision, a decision register (✓ Accepted / ? Open / ○ Proposed), an architecture tree, status bars per area, a history timeline and a tag cloud.
- **Decision pages**: the decision is a bold hero banner. Options tables become cards (chosen = green and bold, rejected = struck through). Consequences split into Positive / Costs / Follow-ups. Open questions become "needs answer" cards. Every `ADR-0007` mention is a status-colored link with a hover preview.
- **Architecture map**: a zoomable map from `architecture.yaml`. For example *Message broker → Kafka → the ADRs about Kafka*. Each box shows how many decisions sit inside it, colored by status.
- **Graph**: every ADR and doc, with typed edges (supersedes, depends on, amends, relates, mentions). You can filter by status, link type and tag.
- **Tags and search**: tag pages with related tags, plus ⌘K full-text search with highlighted snippets.
- **Components**: fenced blocks for decision content (`compare`, `tradeoff`, `stats`, `proscons`, `options`, `decision`, `adr`), plus diagrams (`flow`, `sequence`, `tree`, `timeline`, `limits`, `kv`, `callout`, `annot`), plus syntax highlighting for any code fence. Projects can add their own components.
- **Live reload**: save a `.md` file and the open page updates.
- **Claude plugin**: the `adr` skill writes, backfills and supersedes ADRs in this format. The `answer-me-with-html` skill is the renderer. It is bundled here, so you can customize it.

## Quick start

```bash
npm i -D adr-kit            # or: npm link inside this repo for local development
npx adr init                # adr.config.yaml, docs/adr/, architecture.yaml, template, example component
npx adr new "Use Kafka for domain events" --tags kafka,messaging --components kafka
npx adr serve --open        # http://127.0.0.1:4321, live reload
```

Try it on the bundled example: `npm run dev` (serves `example/`).

## Commands

| Command | What it does |
|---|---|
| `adr init` | Creates the config, the ADR folder, an architecture map, a template and an example component |
| `adr serve [--port] [--host] [--open]` | Runs the web app with live reload |
| `adr build [-o dist/adr]` | Exports a static site for GitHub Pages, S3 or nginx |
| `adr new <title> [--open] [--tags] [--components] [--status]` | Creates the next ADR from the template. `--open` uses the question template |
| `adr list / show <id> / search <q>` | Terminal views. Add `--json` for scripts and agents |
| `adr lint` | Checks broken references, unknown statuses or components, render errors, and missing Decision panels or tags. Exits 1 on errors, so it works in CI |
| `adr index` | Rewrites the index table in `docs/adr/README.md` between the `adr:index` markers |
| `adr graph [--json\|--mermaid]` | Prints the relation graph |
| `adr tags`, `adr components`, `adr next` | Tag counts, available components, next free number |
| `adr skill install` | Copies the bundled skills into `.claude/skills/` if you don't use the marketplace |

## Writing ADRs the app can read

````markdown
---
title: ADR-0004 — Kafka-protocol event log
subtitle: One line: the decision itself
status: Proposed                # Open | Proposed | Accepted | Rejected | Superseded by 0009 | Deprecated
date: 2026-10-03
tags: [kafka, messaging]
components: [kafka]             # ids from architecture.yaml
depends_on: [0001]              # also: supersedes, superseded_by, amends, relates
---

## Decision {span=3}
```callout ok Decision
Use a Kafka-protocol broker as the durable log between services.
```

## Options {span=3}
| Option | Pros | Cons | Verdict |
|---|---|---|---|
| A — Kafka | Replay. Ordered partitions. | One more cluster. | ok |
| B — RabbitMQ | Simple. | No replay. | no |

## Scoring {span=3}
```compare
Criterion | weight | Kafka | RabbitMQ
Replay    | 3      | 5     | 1
Ops load  | 2      | 2     | 4
```
````

Panels named `Decision`, `Question`, `Recommendation`, `Options…`, `Consequences`,
`Questions for the user` and `Evaluation criteria` get the visual upgrades described above. See
`skills/adr/SKILL.md` for the full guide, and the **Components** tab in the app for every block's syntax.

### Architecture map

```yaml
# docs/adr/architecture.yaml
title: Platform
nodes:
  - id: messaging
    label: Message broker
    kind: infra                  # context | infra | store | tech | topic | external | actor | planned | …
    children:
      - id: kafka
        label: Kafka
        kind: tech
        adrs: [4, 16]            # or components: [kafka] in the ADR
    x: 380                       # optional: pin boxes in pixels (x, y, w, h) like a hand-drawn map
    y: 470
    tag: EVENT LOG               # optional: text of the mono tag line (default: kind)
    groups:                      # optional: dashed frames around children at this node's level
      - { label: Session workers, nodes: [session, dispatch] }
edges:
  - api -> kafka: domain events  # any two nodes; each level shows edges between its visible boxes
  - identity --> api: token      # --> dashed, <-> both ways
  - { from: a, to: b, label: x, lp: 0.3, lo: [0, -12], sel: true }  # label position/offset; sel = only when selected
```

Edges are straight lines, clipped at the box borders, with the label on the line. If a level has no
pinned boxes, the boxes are placed in columns that follow the edges. Zooming grows the next level out
of the box you open. Navigation: double-click or Enter to open a box, Esc or the breadcrumb to go
back, `+`/`-`, or a trackpad pinch.

If a node has children, zooming into it shows the children plus a band with the node's own ADRs.
If a node has no children, zooming into it shows its ADRs as cards, connected by their relations.

### Custom components

Each `*.mjs` file in `.adr/components/` is loaded and hot-reloaded:

```js
export default {
  name: "risks",
  summary: "Likelihood × impact matrix",
  css: `.x-risk { … }`,                       // optional; use theme tokens (--paper, --accent, --err …)
  render(text, { args, md, mdInline, esc, highlight, ComponentError, ctx }) {
    return `<div class="x-risk">…</div>`;    // ctx.adr, ctx.store, ctx.cfg are available
  },
};
```

Use it in an ADR with a ```` ```risks ```` fence. Throw `ComponentError(msg, line)` to report an
author error. The page shows it inline, and `adr lint` reports it.

## Config: `adr.config.yaml`

```yaml
title: x — decisions
dir: docs/adr
architecture: docs/adr/architecture.yaml
components: .adr/components
template: .adr/template.md
docs: [docs/design, docs/research]     # extra markdown to index, link and search (not ADRs)
prefix: ADR
statuses:                              # add or recolor: ok | info | warn | err | mute | purple | #hex
  piloting: { label: Piloting, color: purple, order: 2 }
tags:
  kafka: { desc: Event log and topics }
```

## Claude Code plugin and marketplace

This repo is both a plugin and a marketplace:

```
/plugin marketplace add abtinokhovat/adr-kit     # or a local path to this repo
/plugin install adr-kit@adr-kit
```

- `skills/adr`: records, backfills (from the code and git history), supersedes and reviews ADRs with the CLI.
- `skills/answer-me-with-html`: visual explainer pages. Its `scripts/am.mjs` is also the app's renderer (`src/am.mjs` re-exports it). Changes you make to its components or themes show up in the app.

Edit the skills here and reinstall or update the plugin to pick up your changes.

## Layout

```
bin/adr.mjs            CLI
src/                   config, parse (facts from panels), store (index, graph, architecture), render, server, build
src/components/        decision components (decision, options, compare, proscons, tradeoff, stats, adr)
web/                   the SPA (vanilla JS, no build step): overview, list, ADR page, map, graph, tags, search
templates/             ADR templates and the example component
skills/                Claude skills (plugin root: .claude-plugin/)
example/               demo project used by `npm run dev` and the tests
```
