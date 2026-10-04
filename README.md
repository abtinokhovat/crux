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

## The decision flow

```
capture ──▶ enrich ──▶ shape ──▶ review ──▶ finalize ──▶ agents use it
  you      your Claude    you       team        you       every agent
```

1. **Capture** — `adr q "Which broker do we use for v1?"` (or **＋ Question** in the app). A private
   Draft with the question and rough notes. In a meeting: `adr q "…" --notes` or **Open for notes** —
   the room gets a link, sees only the question, and adds notes you fold into the draft later.
2. **Enrich** — in Claude Code: `/adr enrich 20`. Your Claude researches the code and other ADRs and
   writes options, scenarios, questions for people, and the links (relates / depends on / supersedes,
   tags, components, `applies_to`). Its blocks show as “from your Claude” with **Keep / Drop**.
3. **Shape** — edit, set your leaning, assign `- @handle: question` lines. Still private.
4. **Review** — `adr share 20` (or **Share for review**). Teammates open the link and pick an option
   with confidence, add pros/cons (a reason is required), answer the questions for them, comment.
   You see it live on the ADR page and reply (Agree / Added / Noted / Reply). `adr pull 20` +
   `/adr digest 20` lets your Claude summarize and draft edits.
5. **Finalize** — the Finalize panel or `adr finalize 20 --option C --decision "…" --reopen "…"`:
   decision callout, verdicts, dissent from differing picks, reopen triggers, status Accepted;
   reviewers see the decision. **You commit** — adr-kit never touches git.
6. **Agents use it** — `adr context services/inbox kafka` tells any agent what is decided, what was
   rejected and why, and when to reopen. The `adr` skill makes Claude check it before changing code.

Your Claude is personal: it works on your files and never posts to the team.

## Share server

A small service for notes and reviews. Deploy it once for the team:

```bash
docker build -t adr-share .
docker run -d -p 8080:8080 -v adr-data:/data \
  -e ADR_TOKENS="abtinokhovat:<long-random-token>,sara-dev:<token>" \
  -e ADR_PASSCODE="<team passcode>" \
  -e ADR_PUBLIC_URL="https://adr.example.com" adr-share
```

Or `deploy/docker-compose.yml` (adr + Caddy with automatic HTTPS for your domain). Without Docker:
`ADR_TOKENS=… adr server --port 8080`.

- **Owners** (people who publish questions) have tokens in `ADR_TOKENS`. Generate with `openssl rand -hex 24`.
- **Teammates** enter `ADR_PASSCODE` once per browser and their git handle; no accounts.
- Data is one JSON file per question in `/data`. Back up the volume.

Then on your laptop:

```bash
adr login https://adr.example.com --token <your token>   # stored in ~/.config/adr-kit/user.json
```

and in the project's `adr.config.yaml`:

```yaml
share: https://adr.example.com
```

Share links and pulled reviews live in `.adr/share.json` and `.adr/reviews/` (git-ignored for you).

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
| `adr q <question> [--notes] [-c notes] [--due]` | Captures a private Draft; `--notes` opens it for meeting notes |
| `adr notes <id> [--close] [--import]` | Opens for notes / closes / imports notes into `## Notes` |
| `adr share <id> [--close]` | Publishes (or updates) the ADR for team review |
| `adr pull <id>` | Writes team input to `.adr/reviews/<id>.md` for you and your Claude |
| `adr finalize <id> --option X [--decision] [--reopen "a; b"]` | Accepts an option, records dissent and triggers |
| `adr link <a> <rel> <b>` | Links two ADRs on both sides |
| `adr context [paths…] [terms…] [--json]` | What is decided here — for agents |
| `adr server` · `adr login <url> --token` · `adr me` | Share server and your identity |

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

- `skills/adr`: your personal side of the flow — `/adr enrich`, `/adr digest`, `/adr finalize`, link upkeep, and checking `adr context` before changing code. It never posts to the team and never runs git.
- `skills/answer-me-with-html`: visual explainer pages. Its `scripts/am.mjs` is also the app's renderer (`src/am.mjs` re-exports it). Changes you make to its components or themes show up in the app.

Edit the skills here and reinstall or update the plugin to pick up your changes.

## Layout

```
bin/adr.mjs            CLI
src/                   config, parse (facts from panels), store (index, graph, architecture), render,
                       edit (safe markdown edits), flow (capture, link, finalize, context), server (local app)
src/share/             share server (server.mjs), the page teammates open (page.mjs), client used by CLI + app
src/components/        decision components (decision, options, compare, scenarios, proscons, tradeoff, stats, adr)
web/                   the local app (vanilla JS, no build step): overview, list, ADR page + flow, map, graph, tags, search
templates/             ADR templates (full, open question, draft) and the example component
skills/                Claude skills (plugin root: .claude-plugin/)
deploy/                docker-compose with Caddy for the share server; Dockerfile at the root
example/               demo project used by `npm run dev`
```
