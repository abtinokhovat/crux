---
name: crux-design
description: Run a system design session with the user and record it in crux — from a problem statement to options with tradeoffs, answered open questions, decisions (ADRs), and the resulting services, contracts and flows. Use when the user says "/crux design", "let's design X", "how should we build Y", "system design for…", or brings a new feature or problem that changes how services connect. The agent suggests and compares; the user decides. Ends with crux files and a session record, ready for crux-model (code design) and crux-build.
---

# crux-design — system design, decided by the user, recorded in crux

You run the higher-level design loop: problem → options → tradeoffs → questions → decisions →
system changes. Read `../crux/reference.md` first. The result is crux files, not a chat log.

**Ground rules**
- **You suggest; the user decides.** Never pick an option on your own. Present 2–4 real options
  with tradeoffs and your leaning *labelled as a leaning*.
- **Ask, don't assume.** Missing facts (load, latency budget, team skills, data size, consistency
  needs, budget, deadlines) become questions. Ask at most 3–5 at a time, most decisive first.
- **Ground in what exists.** Before proposing, read the current graph: `crux context <terms>`,
  `crux trace <affected flows/elements>`, `crux list --kind all`. Reuse existing services,
  contracts and decisions; respect accepted ADRs (say so if the design conflicts with one).
- Keep the loop visible: after each round, show the open-question list with what changed.

## Loop

1. **Frame.** Restate the problem in 3–5 lines: goal, users, constraints, non-goals, how we'll
   know it works. Ask the user to correct it. Note quality attributes that matter (latency,
   availability, consistency, cost, operability, security, time to market).
2. **Map the blast radius.** Which existing elements and flows does it touch? Show them
   (`crux trace`). If the repo has no crux files yet, suggest crux-adopt for the area first.
3. **Options.** For each viable approach: how requests and data move (a short ```` ```steps ````
   sketch), new or changed services/contracts/stores, pros, cons, risks, cost, what it makes hard
   later. Use a ```` ```compare ```` or ```` ```scenarios ```` block when there are ≥3 options or
   criteria. Mark unverified claims (U).
4. **Questions.** Each unknown that would change the choice → ask now, or record it:
   `crux new question "…"` with `phase: design`, `blocks: [the flow or ADR]`.
5. **Repeat** 3–4 until the user picks, or every blocking question is answered or consciously
   deferred.
6. **Decide.** For each hard-to-reverse choice: an ADR. Use `crux q "…?"` then write Context,
   Options (verdict column), Scenarios, and — once the user chose — `crux finalize N --option X
   --decision "…" --reopen "…"`. Smaller choices go into the element files' prose.

Designed elements that have no code yet get `status: planned`. crux does not ask for anchors
on them until they are built (crux-build adds them).

## Record the result

Write or update, with `decided_by:` pointing at the ADRs:
- **Services / apps / jobs** that appear or change (`crux new service … --dir <planned dir>`;
  `status: planned` when the code does not exist yet).
- **Stores, brokers, externals** that appear.
- **Contracts**: endpoints and events with a contract file for the important ones
  (`on:`, `schema:` if known, payload sketch in ```` ```contract ````).
- **Flows**: one `flow` file per business flow, with ```` ```steps ````, branches for the error
  paths you discussed, `trigger:`, `outcome:`.
- **Questions** still open, with `blocks:`.
- **Session**: only if the user asks for a record: `crux new session "Design — <topic>"`,
  `phase: design`, `produced:` every file, and the story. The ADRs and flows are the record.

Then `crux lint` — every flow hop must be a declared connection; fix gaps. Tell the user what
was written, what is still open, and that `crux serve` → Flows / Map shows it. Suggest
crux-model next for the services that need code design.
