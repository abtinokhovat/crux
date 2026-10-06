# crux

**Decisions and system design your team and your agents can see.** Services, stores, contracts,
entities, business flows, open questions and Architecture Decision Records — all plain markdown
in your repo, next to the code. crux links them into one graph, draws it (architecture map, flow
routes, element pages, decision pages), checks it against the code, and hands it to every coding
agent before it changes anything.

```
adopt ──▶ design ──▶ model ──▶ build ──▶ lint
 map the    options &   entities,   implement,   docs ↔ code
 repo       decisions   modules     ask instead   stay true
               ▲            ▲        of guessing
               └──────── questions ◀─┘
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/abtinokhovat/crux/main/install.sh | sh
```

One binary for macOS and Linux (amd64/arm64). Windows: download the zip from
[Releases](https://github.com/abtinokhovat/crux/releases). With Go: `go install github.com/abtinokhovat/crux/cmd/crux@latest`.

Then in your project:

```bash
crux init            # crux.config.yaml, docs/adr/, a system file, template
crux skill install   # the agent skills → .claude/skills/ (see below for other harnesses)
crux serve --open    # the app, live-reloading as files change
```

Existing codebase? Ask your agent: **`/crux adopt`**. It scans the code, proposes services,
infrastructure, connections, flows and conventions, and writes them once you confirm.

## Everything is markdown with a header

No naming convention, no central YAML. Any `.md` file whose frontmatter has a `crux:` key joins
the graph — put a service's file next to its code:

```markdown
---
crux: service
tech: [go, postgres, kafka]
exposes: ["grpc:orders.v1.Orders/Create"]
publishes: ["topic:order.created"]
consumes: ["topic:payment.settled"]
writes: [orders-db]
owns: [order]
decided_by: [1]
---
# Orders

Source of truth for orders. Pricing lives in [[pricing]].
```

`services/orders/crux.md` becomes a box on the map inside its context, colored and labelled from
the catalog, with its code path (`services/orders/**`), its contracts, the flows it takes part
in, the decisions that govern it and the questions that block it.

**Kinds:** `system` `context` `service` `app` `job` `library` `module` `actor` `external` `store`
`cache` `broker` `gateway` `infra` · `contract` `entity` `flow` · `question` `session`
`convention` · `adr` `doc`.

**Connections:** `calls` `exposes` `uses` `publishes` `consumes` `reads` `writes` `owns`
`depends_on` `runs_on` `implements` `decided_by` `blocked_by` `relates`, and `[[id]]` in prose.

**Contracts** are `transport:name` — `http:POST /orders`, `grpc:orders.v1.Orders/Create`,
`topic:order.created`, `queue:emails`, `webhook:…`. A reference creates the contract; a
`crux: contract` file adds schema and payload. Publisher + consumer of the same topic are
connected automatically.

**Flows** are routes through the graph:

````markdown
---
crux: flow
trigger: customer submits the cart
outcome: order paid
---
# Checkout

```steps
place:  customer -> api : http POST /orders
emit:   orders --> billing : topic order.created
charge: billing -> psp : http POST /v1/payment_intents
  ? declined -> failed
failed: billing --> orders : topic payment.failed
```
````

The app shows the route step by step, plays it as a sequence diagram, and replays it on the
architecture map. Lint checks every hop is a declared connection.

The full vocabulary is [skills/crux/reference.md](skills/crux/reference.md).

## The loop — in the agent you already use

| Skill | What it does | Writes |
|---|---|---|
| `/crux adopt` | maps an existing repo from `crux scan` facts; you confirm each area | services, infra, contracts, flows, conventions, recovered ADRs — `origin: inferred` until you confirm |
| `/crux design` | system design session: problem → options with tradeoffs → your choice | ADRs, services, contracts, flows, questions, a session record |
| `/crux model` | code design: entities, invariants, modules, ports, placement | entities, modules, conventions |
| `/crux build` | implements from the graph; an unknown becomes a `question` pinned to the flow step | code + updated crux files |
| `/crux enrich` `digest` `finalize` | the team decision flow for one ADR | options, scenarios, review digest, decision |

Every agent checks the graph before changing code: `crux context services/orders` returns the
binding decisions, the element and its connections, the conventions for that path, and open
questions. `crux trace checkout` returns a flow hop by hop.

### Skills for your coding agent

| Harness | Install | Lands in |
|---|---|---|
| Claude Code | `crux skill install` — or as a plugin: `/plugin marketplace add abtinokhovat/crux` then `/plugin install crux@crux` | `.claude/skills/` |
| Codex | `crux skill install --agent codex` | `.agents/skills/` |
| Cursor | `crux skill install --agent cursor` | `.cursor/skills/` |
| Gemini CLI | `crux skill install --agent gemini` | `.gemini/skills/` |
| GitHub Copilot | `crux skill install --agent copilot` | `.github/skills/` |
| OpenCode | `crux skill install --agent opencode` | `.opencode/skills/` |

Several at once: `--agent claude,codex`, or `--agent all`. Existing skills are kept unless you pass `--force`.

## What you see

- **Overview** — what needs a decision, system tiles, *what's missing* across the system, the
  decision register, status by area, history.
- **System** — every element by group with tech icons, connection counts, flows, decisions,
  open questions and warnings; a contract table with providers and consumers.
- **Element pages** — a connection diagram (sync, async and data lines in their own styles),
  interfaces with the other side of each contract, data, what is inside, flows through it,
  decisions, questions, impact (what depends on it, what it depends on), and a checklist of
  what is missing.
- **Flows** — trigger → route → outcome, phases, branches, notes, questions pinned to steps,
  sequence playback, and *play on map*.
- **Architecture map** — zoom from the system to a context to a service; boxes from the crux
  files, colored by technology; edges labelled with their transport.
- **Questions** board and **Sessions** timeline; decision graph, tags, ⌘K search.
- **Components** — fenced blocks for decisions (`decision`, `options`, `compare`, `scenarios`,
  `proscons`, `tradeoff`, `stats`, `adr`), the system (`steps`, `entity`, `contract`, `element`,
  `catalog`) and diagrams (`sequence`, `flow`, `tree`, `arch`, `rules`, `timeline`, `limits`,
  `kv`, `callout`, `annot`). Add your own in `.crux/components/*.mjs`.

The **catalog** knows ~150 technologies (icon, color, category, detection rules) and the
transports (http, grpc, graphql, topic, queue, webhook, ws, sse, sql, kv, blob, cron…). Extend it
in `.crux/catalog.yaml`.

## Docs and code stay true

```bash
crux scan          # facts from code: modules, imports, routes, gRPC services, topics/queues, tech, deployables, infra
crux lint          # graph: references, flow hops, contract sides, code paths, ADR panels
crux lint --code   # + imports between elements, declared vs real routes and topics, tech drift, undocumented services
```

The scanner is language-agnostic at the core; Go, TypeScript/JavaScript and infra (compose,
Kubernetes, Dockerfiles, Terraform) adapters are built in. Any other language can plug in a
command that prints the facts as JSON (`lint.adapters` in the config).

## Decisions with your team

1. **Capture** — `crux q "Which broker do we use for v1?"` or **＋ Question** in the app. A private Draft.
   In a meeting: `crux q "…" --notes` — the room gets a link, sees only the question, adds notes.
2. **Enrich** — `/crux enrich 20`: your agent researches the code, the system graph and other ADRs and
   writes options, scenarios, questions for people, and the links. Its panels show as “from your Claude”
   with **Keep / Drop**.
3. **Review** — `crux share 20`: teammates pick an option with confidence, add pros and cons (a reason is
   required), answer questions, comment. `crux pull 20` + `/crux digest 20` summarizes it.
4. **Finalize** — `crux finalize 20 --option C --decision "…" --reopen "…"`: decision, verdicts, dissent,
   reopen triggers, status Accepted. **You commit** — crux never touches git.

### Share server

A small service for meeting notes and team review. Deploy it once:

```bash
docker run -d -p 8080:8080 -v crux-data:/data \
  -e CRUX_TOKENS="abtinokhovat:$(openssl rand -hex 24)" \
  -e CRUX_PASSCODE="team-secret" \
  -e CRUX_PUBLIC_URL="https://crux.example.com" \
  ghcr.io/abtinokhovat/crux:latest
```

[`deploy/docker-compose.yml`](deploy/docker-compose.yml) adds Caddy for HTTPS on your domain. Owners
(who publish) have tokens in `CRUX_TOKENS`; teammates enter `CRUX_PASSCODE` once per browser plus their
git handle — no accounts. On your laptop: `crux login https://crux.example.com --token <token>` and
`share: https://crux.example.com` in `crux.config.yaml`.

## Commands

| | |
|---|---|
| `crux serve [--port] [--open]` · `crux build [-o dir]` | App with live reload · static export |
| `crux new <kind> <title> [--dir] [--in]` · `crux new <title>` | Element from a template · ADR |
| `crux trace <id>` · `crux context [paths…] [terms…]` | How it works · what is decided and described here |
| `crux scan` · `crux lint [--code] [--info]` | Code facts · graph and drift checks |
| `crux list [--kind service\|flow\|…\|all] · show · search · graph · tags · components · next` | Everyday tools (`--json` for scripts) |
| `crux q · notes · share · pull · finalize · link` | The team decision flow |
| `crux init · skill install · server · login · me` | Setup and the share server |

## Develop

```bash
go run ./cmd/crux serve --root example      # backend: Go (cmd/, internal/)
npm install && npm run build:web            # renderer: web-src/ → web/vendor/crux-render.js (committed)
npm run build:icons                         # catalog icons → web/vendor/icons.js (committed)
go test ./... && node --test web/test/system.test.mjs
```

```
cmd/crux/            entry point
internal/adr         parse markdown, crux headers, elements, links, flows, the map
internal/catalog     technologies, categories and transports (catalog.yaml)
internal/scan        code facts: Go, TS/JS and infra adapters
internal/lint        graph and code checks
internal/flow        capture, link, finalize, context, trace, new elements (+ templates/)
internal/share       share server, its page (assets/), and the client
internal/app         local app server, live reload, actions, static build
internal/cli         commands (+ help.txt)
web/                 the app (vanilla JS, embedded); web/vendor/* is generated
web-src/             renderer sources · skills/ agent skills · example/ a small shop system
```

The browser renders pages with the bundled [answer-me-with-html](skills/answer-me-with-html) renderer.
Icons: [Simple Icons](https://simpleicons.org) (CC0). Releases: push a `v*` tag — GoReleaser publishes
binaries and the share-server image.
