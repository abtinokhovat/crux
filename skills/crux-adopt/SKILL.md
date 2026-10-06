---
name: crux-adopt
description: Map an existing repository into crux — find services, apps, jobs, infrastructure, connections and protocols, contracts, entities, business flows, code conventions and decisions already made, and write them as crux files the user confirms. Use when the user says "/crux adopt", "add crux to this repo", "map this codebase", "document the architecture", "onboard crux", or runs crux in a repo with code but few crux files. Re-run with "/crux adopt --update" to find drift after the code changed. Proposes; never decides — every inferred item is marked and confirmed by the user.
---

# crux-adopt — map an existing repo, with the user confirming

You turn a codebase into a crux graph: elements next to their code, contracts, flows,
conventions and recovered decisions. Read `../crux/reference.md` first (the format).

**Ground rules**
- **Propose, then confirm.** You suggest; the user decides boundaries, names and what matters.
  Ask in short batches (one area at a time), with your proposal filled in so they can say "yes".
- **Never invent.** Every connection, route, topic and technology comes from code, config or the
  user. Anything you inferred and the user has not confirmed gets `origin: inferred`,
  `confidence: high|medium|low`, and `evidence:` with file:line.
- **Never invent rationale.** A decision found in code ("they use Postgres") is written as an ADR
  with `status: Recovered`, the evidence filled in, and the *why* left as a question for the user.
- Work area by area; stop and resume cleanly. Never run git commands.

## Phase 0 — facts

1. `crux scan` (summary) and `crux scan --json > .crux/scan.json` (full facts: modules, imports,
   routes, gRPC services, topics/queues with publish/consume side, tech with evidence, deployable
   candidates, compose/k8s/terraform infra, schemas, migrations).
2. `crux list --kind all` — what is already described. Never duplicate an element; extend it.
3. Read the README, CLAUDE.md / AGENTS.md, docs/, the deploy folder and CI config.
4. Show the user a one-screen summary: N deployables (by kind), infra, tech, topics, routes,
   schemas, what is already documented. Ask which areas matter most and what to skip.

## Phase 1 — landscape (boxes)

Propose, as one table the user edits, the structure:

| proposed id | kind | code / evidence | in | tech |
|---|---|---|---|---|

- One `system`; `context`s only if the code really groups services (folders, domains, teams).
- Deployables → `service` / `job` / `app`. Merge what the scan shows several ways (cmd/x main,
  deploy/x Dockerfile, compose service x). Tools, tests and playgrounds are not services.
- Infra (compose images, terraform, k8s) → `store`, `cache`, `broker`, `gateway`, `infra`; one
  element per real instance the services share (not one per local compose file).
- Third parties called over the network (payment, email, SMS, LLM APIs) → `external`.
- Shared code many services import → `library`; large internal parts of a service → `module`
  only when the user wants that depth.

After confirmation, write the files: services next to their code (`<dir>/crux.md` via
`crux new service "Name" --dir <dir>`), infra and externals in `docs/system/` (or where the user
prefers). Fill `summary`, `tech`, `code`, `in`, and `origin/confidence/evidence`.

## Phase 2 — connections and contracts

For each service, from the facts and a read of its entry points and clients:
- `exposes:` its HTTP routes (public ones — skip health/metrics) and gRPC services
  (`grpc:<proto package>.<Service>/<Method>` when visible, else `grpc:<Service>`).
- `calls:` other services, with `via` the contract when you can see it (generated client
  imports, base URLs in config, env vars like `ORDERS_URL`).
- `publishes:` / `consumes:` topics and queues — the scan marks `→` publish and `←` consume;
  confirm direction by reading the call site. Brokers: `on:` in a contract file when a topic
  matters enough to describe.
- `reads:` / `writes:` stores (connection config, repositories, migrations folder).
- `uses:` external APIs (SDK imports such as stripe, twilio, openai).
Ask about anything ambiguous instead of guessing (e.g. a queue name built at runtime).

## Phase 3 — domain

- Entities from migrations, ORM models, proto messages, OpenAPI schemas: one `entity` file per
  aggregate the user cares about, owned by the service that writes it (`owns:`). Use the
  ```` ```entity ```` block; keep only fields that carry meaning (ids, states, money, links).
- Contracts worth a file: the main events (`crux: contract`, `on:`, `schema:`, payload).

## Phase 4 — flows

1. List entry points: public routes, consumers, cron jobs, CLI commands.
2. Ask: "Which business flows matter most?" Offer 3–6 candidates named in business terms
   (checkout, refund, sign-up, settlement).
3. For each chosen flow, trace it through the code (handler → service → client calls / publishes
   → consumers …) and write a `flow` file with a ```` ```steps ```` block, branches for the real
   error paths, `trigger:` and `outcome:`. Mark uncertain hops with a `note:` and confidence.

## Phase 5 — conventions

From linter configs (golangci, eslint), folder patterns and 3–5 representative files per
language, write `convention` files for what the code really does consistently: layering
(handler → service → repository), error handling, naming, logging, config, tests, DI, package
layout. Each with `applies_to:` globs and one short code example. Ask before writing a rule
the code only follows half the time — that is a question, not a convention.

## Phase 6 — recovered decisions

For evident hard-to-reverse choices (database engine, broker, monorepo, framework, auth, sync vs
async between two services), write an ADR: `crux new "Use PostgreSQL for all module data"
--status Recovered` style, with `## Context` (evidence), `## Decision` (what the code does),
`applies_to:`, `components:`, and a `## Questions for the team` asking why and what was rejected.
Link elements with `decided_by:`.

## Phase 7 — close

1. Unknowns → `crux new question "…"` with `raised_from:` and `blocks:`.
2. `crux new session "Adopt <area>"` with `phase: adopt`, `produced:` (all files written), and a
   short story: what was found, what was confirmed, what is open.
3. `crux lint` and `crux lint --code --info`: fix what you wrote; list the rest for the user.
4. Tell the user: counts by kind, the inferred items waiting for confirmation (the app's
   overview and each element page show them), open questions, and `crux serve` to look.

## /crux adopt --update — drift

Re-run `crux scan --json`, then `crux lint --code --info`. Report, grouped by element: new
routes/topics/deployables, removed code paths, new imports between services, new tech. Propose
edits; write them as `origin: inferred` until the user confirms. Write a short `session` file.
