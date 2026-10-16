---
name: crux-adopt
description: Map an existing repository into crux (also called "/crux index") — find services, apps, jobs, infrastructure, connections and protocols, contracts, entities, business flows, code conventions and decisions already made, and write them as crux files the user confirms. Use when the user says "/crux adopt", "add crux to this repo", "map this codebase", "document the architecture", "onboard crux", or runs crux in a repo with code but few crux files. Re-run with "/crux adopt --update" to find drift after the code changed. Proposes; never decides — every inferred item is marked and confirmed by the user.
---

# crux-adopt — map an existing repo, top-down, then deep, then back up

You turn a codebase into a crux graph: elements next to their code, contracts, flows,
conventions and recovered decisions. Read `../crux/reference.md` first (the format).

The route is the one a new engineer takes: **look at the whole, go deep one service at a time,
then come back up** with what the depth taught. Breadth first costs little and fixes the
vocabulary; depth is where the knowledge is; the way back up is where flows and shared things
become visible.

**Ground rules**
- **Propose, then confirm.** You suggest; the user decides boundaries, names and what matters.
  Confirm at the end of each pass, in one short batch with your proposal filled in so they can
  say "yes". Do not ask per file.
- **Let crux find what it can.** `crux scan` and `crux gaps` already connect what the code or a
  manifest states exactly (see "What crux finds on its own" in reference.md). Do not hand-copy
  those connections. Your work is the gaps (procedures in `../crux/gaps.md`) and what no tool
  reads: boundaries, names, purpose, flows, rationale. When crux cannot resolve something (a
  queue name built at runtime, a config-driven topology), **read the code and resolve it
  yourself**, with `at:` on what you wrote — an extractor script is never required.
- **Never invent.** Every connection, route, topic and technology comes from code, config or the
  user. Anything you inferred and the user has not confirmed gets `origin: inferred`,
  `confidence: high|medium|low`, and `evidence:` with file:line.
- **Never invent rationale.** A decision found in code ("they use Postgres") is an ADR with
  `status: Recovered`, the evidence filled in, and the *why* left as a question for the user.
- **Respect the repo's own rules.** Read `AGENTS.md` / `CLAUDE.md` first. Where they say not to
  read or copy something (secrets, `.env`, key files), do not. For configuration you record
  names, shapes and where values come from — never the values.
- **Never write into the repo what belongs to the scan.** Keep scratch output (scan JSON) in
  your scratch/temp folder, not the repo. Never run git commands; the user commits.
- **Scope it.** If the repo has more than ~10 deployables, agree a first slice with the user
  (the main request path, or the area they care about) and finish it before widening.
- **Stay resumable.** The files you wrote are the progress. On a re-run, `crux list --kind all`
  and `crux gaps` show where you stopped; continue from there and never duplicate an element.

## Pass 0 — Orient (whole repo, cheap)

1. Folder structure: list the top levels; say what each is (entry points, services, shared
   code, generated code, deploy, docs, tests, scripts). Note repeating patterns
   (`cmd/<x>` + `services/<x>`, one folder per service, a monorepo of apps).
2. Read the README, `AGENTS.md`/`CLAUDE.md`, `docs/`, the deploy folder and CI config for the
   business story and the repo's vocabulary.
3. `crux scan` (summary) and `crux scan --json` to scratch (modules, routes, gRPC, topics, tech,
   infra, env reads, deployable candidates) and `crux gaps`. The first scan of a big Go repo
   takes about half a minute; later ones use a cache.
4. Show a one-screen summary and agree the **scope** and what to skip (tests, mocks, scripts,
   playgrounds, generated code).

## Pass 1 — Configuration and environments

How does a service learn where things are, and how do dev and prod differ?
- How config is read: env vars, files, flags, a config server (consul, vault, k8s configmaps),
  defaults in code. Find the loader and the config struct(s).
- Which environments exist and where they are defined: compose files, k8s manifests, helm,
  terraform, CI variables, `.env.example`. How to start a dev environment (justfile, make).
- What is a secret and where it lives (name the source: secret store, env var) — never its value.
Write it as one `crux: doc` file in the system docs ("Configuration and environments") and add
`scan.env` / `scan.names` hints to `crux.config.yaml` for env vars that point at an element.

## Pass 2 — Infrastructure

Infra is everything services connect to that is not their own code: databases, caches, brokers,
gateways, third-party APIs.
- From manifests: compose, k8s, terraform. **Compose entries that run an application image with
  different env are instances of that service, not infra.** Fold them into the service
  (`instances:` in its summary), do not make elements for them.
- From code, one level deeper: a config struct with a DSN, host or credentials block; a client
  constructor for a database, queue, cache or SDK; a migration folder. Each distinct thing a
  service connects to is a candidate component, even if no manifest declares it. Name it by what
  it is (`orders-db`), cite the struct or constructor in `evidence`.
- Third parties called over the network → `external` with `hosts:`.
Propose one table (id, kind, tech, evidence); after confirmation write the elements (next to
the code that configures them, else `docs/system/`). Use manifest names as ids so crux wires
services to them on its own. Then `crux gaps --kind wire` and `--kind infra`.

## Pass 3 — Entry points and the service glossary

1. List every entry point: `main` packages, servers, workers, consumers, cron jobs, CLI commands.
   Merge what the scan shows several ways (cmd/x main, services/x, deploy/x Dockerfile, compose
   x). Tools, tests and mocks are not services.
2. Make the **service glossary**: one row per deployable — id, kind, one-line meaning in the
   business's words, code location, and the repo's own term for it. Use the README and docs for
   the words. Add terms the team uses to `glossary:` in `crux.config.yaml`.
3. Propose boundaries: `context`s only where the code or the docs really group services.
Confirm the table with the user, then create one element per service next to its code (add the
`crux:` header to the folder's existing `README.md` when it has one, else `<dir>/crux.md` via
`crux new service "Name" --dir <dir>`), with `summary`, `tech`, `code`, `in`.

## Pass 4 — Each service in depth (one at a time)

For each service in scope: read its entry points, handlers, service layer, clients and config,
then write into its element:
- **Bounded context:** what it owns, what it does, what it deliberately does not do — two or
  three sentences in the body, from the code and docs, not from its name.
- **Connections** with `at:` anchors, for what `crux trace <service>` marks *(in code, not
  declared)* and what the gaps list: `exposes` (public routes, gRPC services), `calls`,
  `publishes`/`consumes` (confirm direction at the call site), `reads`/`writes` stores, `uses`
  externals. Work its gaps by `../crux/gaps.md`.
- **Config it needs** (names only) and the **instances** it runs as.
With 6 or more services in scope and agents available, give each service to its own subagent:
hand it the service folder, `crux scan --json` filtered to that service, this pass, and a note
to return only the files it wrote and its open questions. Merge in the next pass; do not let
them edit each other's files.

## Pass 5 — Entities of each service

The scanner goes first: `crux gaps --kind entity-candidate` lists the stored and model-folder
types it found (with the reason for each), and `--kind table-no-entity` the tables. Work from
those lists (procedures in `../crux/gaps.md`); read further only for what they leave out.
Pick the aggregates that matter with the user. One
`entity` file each, owned by the service that writes it (`owns:`), `id:` = the table name in
singular (or `table:`), `at: path#Type`. In the ```` ```entity ```` block keep only fields that
carry meaning (ids, states, money, links). Where data goes through stored procedures or a
generic layer, anchor to the type that models it and say so.

## Pass 6 — Back up: join what the depth found

Now you know each service's dependencies, so reference them:
- Cross-service edges: a publisher's topic and its consumers, a client and the server handler it
  calls, shared libraries. Write each connection on the side that owns it, with `at:`.
- Contracts worth a file: the main events and RPC groups (`crux: contract`, `on:`, `schema:`).
- Entities with two owners or copies across services: one owner, the others `reads`.
- Update the glossary and each service's summary with what you learned.
Run `crux gaps`; close every `topic-*`, `host-*`, `wire-*` left, or list why it is open.

## Pass 7 — Business flows

1. Candidates: public entry points and consumers (`crux trace <service>`), the repo's own
   specs and docs (`docs/specs`, README story), and `crux gaps --kind contract-no-flow`. Offer
   3–6 named in business terms (checkout, refund, sign-up, settlement) and ask which matter.
2. For each chosen flow, follow it across services (handler → service → client calls /
   publishes → consumers …) and write a `flow` file with a ```` ```steps ```` block, branches
   for the real error paths, `trigger:` and `outcome:`. Say what business value each step
   delivers, not just the call. Mark uncertain hops with a `note:` and confidence.
3. `crux trace <flow>`. Anchor every step and branch crux did not anchor itself
   (` @ path#Symbol`). A flow is done when `crux gaps --in <flow>` is empty.
4. Leave one short visual per flow (the `steps` block is it); no separate session log.

## Pass 8 — Conventions and recovered decisions

- **Conventions:** from linter configs and 3–5 representative files per language, write
  `convention` files for what the code really does consistently (layering, errors, naming,
  logging, config, tests, DI), each with `applies_to:` globs and one short example. A rule the
  code follows only half the time is a question, not a convention.
- **Decisions:** for evident hard-to-reverse choices (database engine, broker, framework, auth,
  sync vs async between two services) write `crux new "…" --status Recovered` with `## Context`
  (evidence), `## Decision` (what the code does), `applies_to:`, `components:` and a
  `## Questions for the team` asking why and what was rejected. Link with `decided_by:`.

## Close

1. Unknowns → `crux new question "…"` with `raised_from:` and `blocks:`.
2. `crux lint`, `crux lint --code --info` and `crux gaps`: fix what you wrote. List the rest for
   the user, by gap kind, with why each is open.
3. Tell the user: counts by kind, the inferred items waiting for confirmation (the app shows
   them), open questions, the files written, and `crux serve` to look. Only if the user asks for
   a record: `crux new session "Adopt <area>"`.

## /crux adopt --update — drift

Re-run `crux gaps` and `crux lint --code --info`. Broken anchors (`anchor`) show code that moved
or went away. `code-link-undeclared` shows connections the code makes that the files do not. New
gaps show new code. Report, grouped by element: new routes/topics/deployables, removed code
paths, new imports between services, new tech. Propose edits; write them as `origin: inferred`
until the user confirms.
