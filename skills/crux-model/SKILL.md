---
name: crux-model
description: Run a code design session in crux, one layer below system design — entities and their invariants, module boundaries, ports and adapters, where each piece lives in the code, and the conventions to follow — suggested by the agent, decided by the user, recorded as crux files a coding agent can implement. Use when the user says "/crux model", "design the models", "code design for <service>", "how should we structure this service", or after a crux-design session. Not for writing the implementation (that is crux-build).
---

# crux-model — code design: models, boundaries, placement

The system design says *what* services exist and how they talk. Code design says *how one
service is shaped inside*: its domain model, its modules and ports, its folders, its rules.
Read `../crux/reference.md` first.

**Ground rules**
- **Suggest, compare, let the user choose.** For each structural choice (aggregate boundaries,
  where a rule lives, sync vs async inside, package layout) give 2–3 options with pros and cons
  and say which you lean to and why. Never decide silently.
- **Follow what is already decided.** Read `crux context <service dir>`, `crux trace <service>`,
  the conventions it returns, and accepted ADRs. Match the existing code style of the repo.
- **Abstractions, not implementation.** Write names, responsibilities, signatures of ports,
  fields and invariants. Do not write function bodies.

## Steps

1. **Scope.** Which service(s) or module(s)? Read their crux files and the flows they are in
   (`crux trace`). List the use cases the flows need from this service (each step that enters it).
2. **Domain model.** Propose entities/aggregates for those use cases:
   - one `crux new entity "Order" --in <service>` per aggregate, with an ```` ```entity ```` block
     (ids, state fields with their values, money, references `fk`), and `## Invariants`.
   - state machines as a ```` ```tree ```` or ```` ```rules ```` block (`+ paid => …`).
   - ask about every rule you are unsure of (rounding, idempotency, uniqueness, retention).
3. **Modules and ports.** Propose the inside of the service as `module` elements
   (`crux new module "Payment port" --in billing --dir services/billing/internal/payment`):
   delivery (handlers/consumers), application (use cases), domain, adapters (repositories,
   clients, publishers). For each: responsibility, the port interface it exposes or implements
   (`implements: [port-id]`), and `depends_on:` — dependencies point inward.
   Show the shape as an ```` ```arch flow ```` or ```` ```tree ```` block in the service file.
4. **Placement.** Map every module to a folder (`code:`); create no folders yet unless the user
   asks. Respect the repo layout ADRs and conventions.
5. **Contracts in detail.** For each contract the service exposes or consumes: payload fields,
   errors, idempotency key, versioning — in its contract file.
6. **Conventions.** If the session settles a rule (error mapping, transaction boundary, naming),
   write or update a `convention` file with `applies_to:` and a short example.
7. **Questions.** Anything the user deferred → `crux new question` with `phase: model` and
   `blocks:` the module or entity.
8. **Close.** Keep one short visual per module or entity you shaped. No session file unless the
   user asks. `crux lint`. Tell the user the files and that crux-build can implement them.
