---
name: crux-build
description: Implement code from the crux graph — the designed services, modules, entities, contracts and flows — and keep the docs and code in sync; when something is unknown, stop and record a question pinned to the exact flow step or element instead of guessing. Use when the user says "/crux build <flow|element>", "implement the checkout flow", "build what we designed", or asks an agent to code a feature that crux files describe.
---

# crux-build — implement from the graph, ask instead of guessing

The design is in crux files. Your job is to make the code match it, and to send unknowns back
to the user as questions — never to fill them with assumptions. Read `../crux/reference.md`.

## Before writing code

1. `crux trace <flow or element>` — steps, hops, contracts, decisions, open questions.
2. `crux context <paths you will touch> <terms>` — binding decisions, conventions, elements.
3. Read every entity, contract and module file the work touches, and the conventions returned.
4. **Open questions that block this work** (`blocks:` / `blocked_by:`): stop and ask the user to
   answer them first, or to explicitly let you proceed with a stated default.
5. Make a short plan: which steps of the flow, which modules, which files. Show it.

## While writing code

- Follow the design: names, module boundaries, ports, dependency directions, contract payloads.
  If the design is wrong or impossible, say so — don't silently diverge.
- **An unknown appears** (behaviour the design doesn't cover, an unclear rule, a missing
  contract field, a choice with real tradeoffs):
  1. Stop that part.
  2. `crux new question "…"` with `raised_from: flow:<id>#<step>` (or the element id),
     `blocks: [<flow or element>]`, `phase: build`, and the options you see with pros/cons.
  3. Ask the user. Continue with the parts that don't depend on it.
  4. When answered: add `## Answer` to the question file, then implement.
- Keep the docs true in the same change: new endpoint → `exposes:`; new publish → `publishes:`;
  new store access → `reads:`/`writes:`; a new service → its crux file; a removed one → remove or
  mark `status: deprecated`. Remove `status: planned` when it exists.

## After

1. Run the project's tests and linters.
2. `crux lint --code --info` — imports between elements, routes, topics and tech must match the
   crux files. Fix what this change caused.
3. `crux new session "Build — <flow/element>"` with `phase: build`, `produced:` (elements and
   flows touched), what was built, questions raised and their state.
4. Tell the user: what was implemented per step, questions raised (answered / open), doc changes,
   and anything you could not verify. Suggest citing ADRs in the commit message. Never commit.
