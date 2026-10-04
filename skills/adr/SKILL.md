---
name: adr
description: Record, backfill, update and review Architecture Decision Records with the adr-kit CLI, so decisions show up in the visual ADR app (graph, architecture drill-down, tags, search). Use when a decision is made or is being weighed (picking a library, database, broker, protocol, layout, convention, deployment shape), when the user says "write an ADR", "record this decision", "document why we chose X", "backfill ADRs", "what decisions did we make about X", "supersede ADR N", or when a design/plan produces a choice that is hard to reverse, crosses services, or changes a convention. Also use to answer questions about past decisions — search the ADRs before guessing. Not for choices a code comment can explain.
---

# adr — decisions as connected, visual records

ADRs are markdown files in the repo (`docs/adr/NNNN-kebab-title.md` by default; see `adr.config.yaml`).
The `adr` CLI indexes them; `adr serve` shows them as a dashboard, a decision graph, an architecture
map (e.g. *Message broker → Kafka → its ADRs*), tags and full-text search. **Your job is to write ADRs
whose structure the app can read**, so the decision, options and links are visual, not buried in prose.

## 0. Run the CLI

Use the first that works:

```bash
adr --help                                   # installed globally / via npm link
npx adr-kit --help                           # from npm
node "${CLAUDE_PLUGIN_ROOT}/bin/adr.mjs" --help   # from this plugin (run once: npm i --prefix "${CLAUDE_PLUGIN_ROOT}" --omit=dev)
```

Below, `adr` means whichever worked. No `adr.config.yaml` in the repo? Ask before running `adr init`.

## 1. Look before you write

```bash
adr list --json            # all ADRs: id, status, tags, components, facts
adr search <words>         # does a decision already exist?
adr show <id>              # decision, options, open questions, links
adr tags                   # reuse existing tags — do not invent synonyms
```

Also read `architecture.yaml` (path in `adr.config.yaml`) to find the component ids to link.
If a decision already exists: **update it** or **supersede it** — never write a duplicate.

## 2. Create

```bash
adr new "Use Kafka-protocol log for domain events" --tags kafka,messaging --components kafka
adr new "Which database engine for v1?" --open --tags database     # a question still to decide
```

Then edit the created file. Frontmatter:

```yaml
---
title: ADR-0004 — Kafka-protocol event log
subtitle: One line — the decision itself (shown on cards and hovers)
status: Proposed            # Open → Proposed → Accepted | Rejected; later "Superseded by 0009" / Deprecated
date: 2026-10-03
author: architect           # or the human's name, or "backfill"
tags: [kafka, messaging]    # 2–5, lowercase, reuse existing ones
components: [kafka]         # ids from architecture.yaml — places the ADR on the map
depends_on: [0001]          # relations draw typed edges in the graph
supersedes: [0002]          # also: relates, amends, superseded_by
---
```

Mentions like `ADR-0007` in the body link automatically (status-colored, with hover preview).

## 3. Write for the eye, not the scroll

Every `## Heading` is a panel. The app upgrades these panels — use the names exactly:

| Panel | Write | Becomes |
|---|---|---|
| `## Decision` | one ```` ```callout ok Decision ```` with 1–3 active sentences | bold hero banner, status-colored |
| `## Question` (Open ADRs) | one ```` ```callout info Decision to make ```` | amber hero |
| `## Options` / `## Options: <topic>` | table with a **verdict column** (`ok` chosen / `warn` possible / `no` rejected); columns `Option`, `Pros`, `Cons`, any others; optional `Topic` column groups rows | option cards: chosen = green & bold, rejected = struck through; pros/cons as `+`/`−` bullets |
| `## Recommendation` | ```` ```callout ok Recommendation (non-binding) ```` then triggers | blue dashed hero |
| `## Consequences` | bullets prefixed `Positive:`, `Cost we accept:` / `Negative:`, `Follow-ups:` | three colored columns |
| `## Questions for the user` | numbered list | "needs answer" cards; counted on the dashboard |
| `## Evaluation criteria` | numbered list | numbered criteria tiles |

Write pros/cons as short sentences ending in `.` — each becomes one bullet.

Prefer a component over a paragraph whenever the content has shape:

| Shape | Component |
|---|---|
| scored comparison of options | ```` ```compare ```` — `Criterion \| weight \| A \| B` rows, scores 0–5 → heatmap + ranked bars |
| leaning between two poles | ```` ```tradeoff ```` — `Simplicity <-> Scale \| 0.3 \| note` |
| key numbers (load, latency, cost) | ```` ```stats ```` — `500 msg/s \| Peak inbound \| assumption` |
| pros / cons of one thing | ```` ```proscons ```` — `+ …` / `- …` / `~ …` |
| options with fields (YAML) | ```` ```options ```` |
| embed related ADRs | ```` ```adr ```` — one id per line, optional note |
| architecture / data flow | ```` ```flow LR ```` — `A -> B: label`, `[(DB)]`, `{decision?}` |
| messages over time | ```` ```sequence ```` |
| hierarchy, phases, limits | ```` ```tree ````, ```` ```timeline ````, ```` ```limits ```` |
| code / config / schema | any language fence (`go`, `sql`, `proto`, `yaml`, `ts`…) — highlighted |

Run `adr components` for the full list (projects can add their own in `.adr/components/*.mjs`).
Writing rules: facts in Context, no opinions; active voice; one idea per sentence; never invent numbers —
mark assumptions "(assumption)" and unverified claims "(U)".

## 4. Backfill decisions already in the code

When asked to record past decisions ("backfill", "document our stack", "why do we use X"):

1. Inventory evidence: dependency manifests (`go.mod`, `package.json`, `pyproject.toml`, `Cargo.toml`),
   infra (`docker-compose*`, `k8s/`, `terraform/`, CI files), repo layout, conventions docs.
2. Date and author each choice from history: `git log --diff-filter=A --format='%h %ad %an' --date=short -- <file>`,
   `git log -S '<dependency>' --format='%h %ad %s' --date=short | tail -1`.
3. One ADR per decision, `status: Accepted`, `date:` = date of the introducing commit, `author: backfill`.
4. Add a `## Evidence` panel listing files and commit hashes. Mark rationale you inferred with "(inferred)";
   put what only a human knows under `## Questions for the user`.
5. Rejected alternatives: list only ones you have evidence for (removed deps, reverted commits, docs).
   Otherwise say "No record of alternatives considered."
6. Add or update nodes in `architecture.yaml` so each ADR sits under the right component.

## 5. Change status / supersede

- Decision taken on an Open ADR: rewrite `## Question` → `## Decision` callout, set the chosen option to `ok`, set `status: Accepted`, answer or remove the questions.
- Replacing a decision: new ADR with `supersedes: [N]`; in the old one set `status: Superseded by <new>`. Never delete or renumber.

## 6. Finish

```bash
adr lint        # must report 0 errors; fix warnings where you can (missing Decision, no tags)
adr index       # refresh the table in the ADR folder's README
```

Tell the user in 2–3 lines: the ADR id + title, the decision in one sentence, and `adr serve` to view it
(if it is running, the page reloads by itself).
