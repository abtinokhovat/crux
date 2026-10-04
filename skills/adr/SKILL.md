---
name: adr
description: Work with Architecture Decision Records through the adr-kit CLI, as the user's personal assistant. Use it to enrich a captured question with research, options, scenarios and links ("/adr enrich 12", "find options for this", "research this decision"); to digest team review input ("/adr digest 12", "what did the team say"); to finalize ("/adr finalize 12 B"); and — before changing code — to check what is already decided ("adr context"). Also use it when the user faces a hard-to-reverse choice (database, broker, protocol, layout, convention, deployment shape) and no ADR exists yet, and when they ask why something was built a certain way. Not for choices a code comment can explain.
---

# adr — decisions as connected, visual records

ADRs are markdown files in the repo (`docs/adr/NNNN-slug.md`, see `adr.config.yaml`). The user
runs `adr serve` to see them as an app. A teammate-facing **share server** collects meeting notes
and review input.

**Your role is personal.** You work for the user on their laptop. You never post to the share
server, never message teammates, and **never run git commit, push or branch** — the user does
all git work. You read and write the markdown; the app shows it.

## The flow

| Stage | Who | What happens | Your part |
|---|---|---|---|
| Capture | user | `adr q "Which … ?"` (or ＋ Question in the app), maybe `adr notes N` in a meeting | — |
| Enrich | **you** | research, options, scenarios, links | `/adr enrich N` |
| Shape | user | edits, picks a leaning, writes questions for people | help on request |
| Review | team | `adr share N` → teammates pick, add pros/cons with reasons, answer | `/adr digest N` |
| Finalize | user | chooses; dissent and reopen triggers recorded | `/adr finalize N <option>` |
| Build | everyone's agents | read decisions before changing code | `adr context …` |

Run the CLI with the first that works: `adr`, `npx adr-kit`, or `node "${CLAUDE_PLUGIN_ROOT}/bin/adr.mjs"`.

## /adr enrich N — research and structure a question

1. Read: `adr show N`, the file itself (question and `## Notes` — notes from the room are input), and
   `adr context <terms from the question>` for related decisions. Read the code it touches
   (dependency manifests, deploy/, the services named). Read every related ADR fully.
2. Write into the ADR file. **Add a new panel with `from=claude` in its heading** so the user can
   Keep or Drop it in the app, e.g. `## Options {span=3 from=claude}`. Never delete or reword the
   user's text; propose changes as new panels.
   - `## Context` — facts only, with sources (ADR ids, file paths, docs + date checked). Mark
     unverified claims "(U)" and assumptions "(assumption)".
   - `## Options` — a table with a verdict column: `| Option | Pros | Cons | Fit |`, rows named
     `A — …`, `B — …`. Pros/cons are short sentences ending in “.” (each becomes a bullet).
     Fit: `warn` for viable, `no` for clearly worse (say why). Use `ok` only if the user already
     said which one they lean to — the decision is theirs.
   - `## Scenarios` — a what-if grid across options:
     ```scenarios
     What happens if… | A | B | C
     Load ×6 (3,000 writes/s) | ok partitions scale | warn manual sharding | bad needs Kafka
     DB outage 20 min | ok buffer holds | ok buffer holds | warn relay spool covers
     ```
     Cover load growth, failure, operations/staffing, data/replay, cost, migration later.
   - `## Questions for the team` — only what a person must answer, one per line:
     `- @handle: question`. Pick the handle from the notes, CODEOWNERS or git log.
   - Optional: ```` ```compare ```` (weighted criteria), ```` ```tradeoff ````, ```` ```stats ````, ```` ```flow ````.
3. **Maintain the connections — the user should never have to look them up.**
   - `adr link N relates M`, `adr link N depends_on M`, `adr link N supersedes M` (writes both sides).
   - Frontmatter: `tags:` (reuse existing — `adr tags`), `components:` (ids from architecture.yaml),
     `applies_to:` (code path globs this decision governs, e.g. `[services/inbox/**, deploy/]`).
4. Run `adr lint`, then tell the user in 3–5 lines what you added and what you could not verify.

## /adr digest N — read the team's input

1. `adr pull N` writes `.adr/reviews/N.md` (picks, pros, cons, answers, comments, notes).
2. Summarize for the user: where people agree, every concern with its reason, answers to their
   questions, who has not responded, and anything that changes a scenario cell or an option.
3. Offer concrete edits — new cons with the reviewer's reason, scenario changes — as
   `from=claude` panels or as a list. Draft reply text if asked; the user sends replies in the app.

## /adr finalize N <option>

1. `adr pull N`, then write a 1–3 sentence decision in active voice from the options and review.
2. Ask for (or propose) reopen triggers — measurable conditions: “writes > 3,000/s”, “a consumer
   needs replay > 14 days”.
3. `adr finalize N --option X --decision "…" --reopen "trigger 1; trigger 2"`. This writes the
   Decision callout, verdicts, dissent (from team picks) and status Accepted, and shows the
   decision to reviewers.
4. Fix connections: superseded ADRs (`adr link N supersedes M`), ADRs this unblocks (mention them),
   `components`/`applies_to`, and `architecture.yaml` if a component appears or disappears.
5. `adr lint`. Tell the user which files changed — they commit.

## Before you change code — check decisions

Decisions are binding context for every agent, not just history.

1. Before a non-trivial change, run `adr context <paths you will touch> <topic words>`.
2. **Accepted** decisions: follow them. If the task conflicts, stop and tell the user which ADR and
   why — do not quietly work around it. Respect rejected options: do not reintroduce them.
3. If a change hits a **reopen when** trigger, say so and offer to capture it: `adr q "…?"`.
4. **Open / In review** decisions: don't pre-empt them; mention the leaning and ask.
5. When you make a choice that is hard to reverse and no ADR covers it, suggest `adr q`.
6. If the user commits, suggest citing the ADRs in the message (e.g. “per ADR-0020”).

## Writing style

Facts in Context, opinions in Recommendation. Active voice; one claim per sentence; short words.
Never invent numbers — mark assumptions. Keep the user's own words where they wrote them.
