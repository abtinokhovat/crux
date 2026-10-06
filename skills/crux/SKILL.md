---
name: crux
description: Work with the crux system graph — Architecture Decision Records plus services, stores, contracts, entities, flows, questions and conventions written as markdown with a "crux:" header — through the crux CLI, as the user's personal assistant. Use it before changing code to check what is decided and how the system is wired ("crux context", "crux trace"); to enrich, digest or finalize a decision ("/crux enrich 12", "/crux digest 12", "/crux finalize 12 B"); to describe or update a service, flow, contract or entity; and when the user asks why something is built a certain way or how a request travels through the system. For mapping an existing repo use crux-adopt; for a design session crux-design; for code design crux-model; for implementing from the graph crux-build. Not for choices a code comment can explain.
---

# crux — decisions and systems your team and your agents can see

The repo holds plain markdown. ADRs (`docs/adr/NNNN-slug.md`) record decisions. Any `.md` file
with a `crux: <kind>` header describes part of the system — a service next to its code, a store,
a contract, an entity, a business flow, an open question. They link into one graph; `crux serve`
shows it as an app (map, flows, element pages), and the CLI gives it to agents.

**Format:** [reference.md](reference.md) is the full vocabulary — kinds, connection keys,
contract refs, the `steps` flow syntax, entities, questions, sessions, conventions. Read it
before writing any crux file.

**Your role is personal.** You work for the user on their laptop. You never post to the share
server, never message teammates, and **never run git commit, push or branch** — the user does all
git work. You read and write markdown; the app shows it. If `crux` is missing, ask the user to
install it: `curl -fsSL https://raw.githubusercontent.com/abtinokhovat/crux/main/install.sh | sh`.

## Before you change code — check the graph

Decisions and the documented system are binding context for every agent.

1. Run `crux context <paths you will touch> <topic words>`. It returns:
   - **decisions** that govern those paths (accepted ones are binding; rejected options stay rejected),
   - **elements** whose code covers them — what they expose, call, publish, consume and store, and the flows they are in,
   - **conventions** that apply to those paths,
   - **open questions** on those elements.
2. To see how something works end to end: `crux trace <flow-or-element>` (steps, hops, contracts, decisions).
3. **Accepted** decisions: follow them. If the task conflicts, stop and say which ADR and why.
   If a change hits a **reopen when** trigger, say so and offer `crux q "…?"`.
4. **Open questions** on what you touch: don't guess the answer. Ask the user, or record that
   you are blocked (see crux-build).
5. If your change adds or removes a connection, an endpoint, a topic, a store, or a service,
   update that element's crux file in the same change, then `crux lint`.
6. A hard-to-reverse choice no ADR covers: suggest `crux q "…?"` before making it.

## Describing the system

- New element: `crux new service "Orders" --dir services/orders` (also: `app job library module
  context store cache broker gateway external actor contract entity flow question session
  convention`). Then fill the frontmatter connections from the code — never invent them.
- Prefer adding a connection on the side that owns it: the publisher lists `publishes`, the
  consumer lists `consumes`, the caller lists `calls … via contract`.
- Anything you inferred and the user has not confirmed gets `origin: inferred`, a `confidence`,
  and `evidence:` (file:line). The user confirms by deleting `origin`.
- After editing: `crux lint` (graph) and, when code exists, `crux lint --code` (imports, routes,
  topics, tech, undocumented services). Fix what you introduced; report the rest.

## The decision flow

| Stage | Who | What happens | Your part |
|---|---|---|---|
| Capture | user | `crux q "Which … ?"` (or ＋ Question in the app), maybe `crux notes N` | — |
| Enrich | **you** | research, options, scenarios, links | `/crux enrich N` |
| Shape | user | edits, picks a leaning, writes questions for people | help on request |
| Review | team | `crux share N` → picks, pros/cons with reasons, answers | `/crux digest N` |
| Finalize | user | chooses; dissent and reopen triggers recorded | `/crux finalize N <option>` |
| Build | every agent | read decisions and the system before changing code | `crux context`, `crux trace` |

### /crux enrich N — research and structure a question

1. Read: `crux show N`, the file itself (question and `## Notes`), `crux context <terms>` for
   related decisions and elements, `crux trace <element>` for what the decision touches, and the
   code it touches. Read every related ADR fully.
2. Write into the ADR file. **Add new panels with `from=claude` in the heading** so the user can
   Keep or Drop them, e.g. `## Options {span=3 from=claude}`. Never delete or reword the user's
   text; propose changes as new panels.
   - `## Context` — facts only, with sources (ADR ids, file paths, docs + date checked). Mark
     unverified claims "(U)" and assumptions "(assumption)".
   - `## Options` — a table with a verdict column: `| Option | Pros | Cons | Fit |`, rows named
     `A — …`, `B — …`. Fit: `warn` for viable, `no` for clearly worse (say why). Use `ok` only if
     the user already said which one they lean to — the decision is theirs.
   - `## Scenarios` — what-if grid across options (load growth, failure, operations, data/replay,
     cost, migration later):
     ```scenarios
     What happens if… | A | B | C
     Load ×6 (3,000 writes/s) | ok partitions scale | warn manual sharding | bad needs Kafka
     ```
   - `## Questions for the team` — only what a person must answer: `- @handle: question`.
   - When the decision changes how services connect, show it: a ```` ```steps ```` block for the
     affected flow per option, or ```` ```sequence num play ```` with `participant Name = element-id`.
3. **Maintain the connections — the user should never have to look them up.**
   - `crux link N relates M` / `depends_on` / `supersedes` (writes both sides).
   - Frontmatter: `tags:` (reuse existing — `crux tags`), `components:` (element ids),
     `applies_to:` (code globs this decision governs).
   - On the elements it governs: `decided_by: [N]`.
4. `crux lint`, then tell the user in 3–5 lines what you added and what you could not verify.

### /crux digest N — read the team's input

1. `crux pull N` writes `.crux/reviews/N.md`.
2. Summarize: agreement, every concern with its reason, answers, who has not responded, anything
   that changes a scenario cell or an option.
3. Offer concrete edits as `from=claude` panels or a list. Draft reply text if asked.

### /crux finalize N <option>

1. `crux pull N`, then write a 1–3 sentence decision in active voice.
2. Ask for (or propose) measurable reopen triggers.
3. `crux finalize N --option X --decision "…" --reopen "trigger 1; trigger 2"`.
4. Fix connections: superseded ADRs, `decided_by` on the elements it governs, and the elements
   themselves if a service, store, contract or flow appears, changes or disappears.
5. `crux lint`. Tell the user which files changed — they commit.

## Writing style

Facts in Context, opinions in Recommendation. Active voice; one claim per sentence; short words.
Never invent numbers, connections or names — mark assumptions. Keep the user's own words.
