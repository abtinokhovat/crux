# crux gaps — what crux could not connect, and how you close it

crux finds connections on its own wherever the code or a manifest states them exactly (see
"What crux finds on its own" in [reference.md](reference.md)). It never guesses. What it saw
but could not resolve exactly is a **gap**, and closing gaps is your job.

```sh
crux gaps                  # grouped by kind, with evidence and the fix
crux gaps --json           # [{kind, element, subject, message, evidence[], fix}]
crux gaps --kind env       # one kind (prefix match)
crux gaps --in orders      # one element
```

## Rules for every gap

1. **Read the evidence first.** Every gap has a file:line. Open it and the code around it.
   Never close a gap from its message alone.
2. **Prefer a hint over a hand edit.** If one fact in `crux.config.yaml` lets crux make the
   connection itself (`scan.env`, `scan.names`, `hosts:` on an external, `lint.topics`), write
   the hint. crux then keeps that connection fresh on every run, and lint catches it when the
   code changes. Hand-write a connection only when no hint can express it.
3. **Every hand-written connection gets an anchor.** Write `{to: X, at: path#Symbol}`. Use a
   line (`path:42`) only when there is no symbol (a manifest, a top-level script). `crux lint`
   fails when an anchor stops resolving.
4. **Unsure means ask, or mark it.** If the code does not settle it (a URL built at runtime, a
   topic name from config you cannot see), ask the user. Or write the connection with
   `origin: inferred` and `confidence:` on its element, plus the evidence. Never present a
   guess as a fact.
5. **Re-run after each batch.** Run `crux gaps`, then `crux lint`. Closed gaps disappear; a hint
   may close several at once.
6. **Ignore a gap only with the user's consent**, through `lint.ignore` in `crux.config.yaml`
   (`- topic-no-consumer:topic:audit.log`). Say why in a comment.

Work the kinds in the order crux prints them. Connections come first because flows and
anchors build on them.

---

## wire-unresolved

A compose or Kubernetes manifest connects deployable A to a host H, and H (or A) is not an
element crux can find by id or title.

1. Open the manifest line. Find what H is: a compose service name, a k8s Service, or an alias.
2. If H is an element under another name (compose calls it `postgres`, the model calls it
   `orders-db`), add `scan: {names: {postgres: orders-db}}`.
3. If H is real infrastructure with no element, create it: `crux new store "Orders DB" --tech
   postgres` (or cache/broker/service), with `id:` equal to H when the user agrees. A matching
   id needs no hint.
4. If A (the source) is unknown: the deployable has no element, or its element's `code:` does
   not cover the build folder. Fix the element or create it.

## env-unmapped

Code reads an env var that looks like a connection (`*_URL`, `*_DSN`, `*_HOST`, `*_ADDR`,
`DATABASE_*`, `REDIS_*`…), but its value is invisible to crux: a secret, `${VAR}`
interpolation, a config map, or unset.

1. Find what the value points at. Look in this order: `.env.example` / `.env.sample`, the
   deploy repo or Helm values the user can show you, secret names (`orders-db-credentials`),
   the code that dials it (which driver: pgx → postgres, go-redis → redis), and the README.
2. When you know the target element: `scan: {env: {ORDERS_DSN: orders-db}}`. crux then connects
   every module that reads it and every manifest that sets it.
3. If it is a feature flag, a URL for an end user, or something else that is not a connection,
   ignore it: `lint.ignore: [env-unmapped:NAME]`.

## host-unmapped

Code names a host (`https://api.stripe.com/...`, `"payments:8080"`) that no element answers for.

- **A third party** (the domain is not ours): find or create the `external` element and give it
  `hosts: [api.stripe.com]`. A parent domain covers subdomains:
  `hosts: [stripe.com]` matches `api.stripe.com`.
- **One of ours under another name**: `scan: {names: {payments: billing}}`.
- **Docs, schemas, test fixtures**: ignore.

## infra-unmodeled / deployable-unmodeled

A manifest runs infrastructure, or the scan sees a deployable, and no element describes it.

1. Confirm it is real and shared (not one developer's local tool) with the user, in a batch.
2. Create it with `crux new <kind> "<Name>" --dir <dir>` (deployables) or `--tech <id>` (infra).
   Use the manifest name as `id:` so wires resolve without hints.
3. If it is an existing element under another name, add a `scan.names` hint instead.

## topic-direction

Code names a topic or queue, but crux matched it by words on the line (writer, consumer,
handle…), not by a publish/subscribe API it knows. So the direction is unconfirmed.

1. Read the call. Find the function that actually sends or receives. Often it is a project
   wrapper (`bus.Emit(ctx, OrderCreated, …)`).
2. Write the connection on the element with an anchor:
   `publishes: [{to: "topic:order.created", at: services/orders/outbox.go#Relay.Flush}]`.
3. If the project has a wrapper used everywhere, teach crux the wrapper once instead. Add a
   regex with one capture group (the topic name, or the constant that holds it) to
   `lint.publishes` or `lint.consumes` in `crux.config.yaml`:
   ```yaml
   lint:
     publishes: ['\bbus\.Emit\(\s*ctx\s*,\s*"?([\w.]+)']
     consumes:  ['\bbus\.On\(\s*"?([\w.]+)']
   ```
   Test it against the gap's evidence lines, then re-run `crux gaps`. crux then connects every
   call site, now and later. (`lint.topics` only names topics; it gives no direction.)

## topic-no-consumer / topic-no-publisher

A topic has only one side in this repo.

1. Search the repo for the topic name in config and constants. The other side may sit behind a
   name built at runtime: find the code and write the connection with `at:`.
2. If the other side lives in another repo or system, model it as an `external` (or a service
   with `origin: inferred` the user confirms) that `consumes:` / `publishes:` the topic.
3. If nothing consumes it (an audit stream, a topic kept for later), tell the user. Ignore the
   gap only with their consent.

## topic-no-broker

A topic or queue has no broker. Its publishers and consumers connect to no broker, or to
several. On the map it floats instead of sitting in its broker.

1. Find the broker in the publisher's client setup: the brokers list, the connection URL, or
   the env var it reads.
2. Connect the service to the broker: `depends_on: [kafka]`, or a `scan.env` hint for the env
   var. crux then places every topic that service uses.
3. When a service uses several brokers, say which one hosts the topic: a contract file with
   `on: <broker>`.

## entity-no-store

An entity has no store. Its owner writes none, or several. On the map it does not appear inside
any store.

- The owner writes one store you can see in the code: connect it (`writes: [orders-db]` with
  `at:`, or a `scan.env` hint for the database URL).
- The owner writes several stores: `stored_in: <store>` on the entity, plus `table:` if the
  name differs.

## table-no-entity

A migration leaves a table that no entity matches. crux matches an entity's `table:`, or its id
in snake_case and its regular plural (`order-line` ↔ `order_lines`).

1. Decide with the user whether it is a domain entity. Outbox, audit, join and migration tables
   usually are not: ignore them (`lint.ignore: [table-no-entity:outbox]`).
2. For a domain entity: `crux new entity "<Name>" --in <owning service>`. Write the
   ```` ```entity ```` block from the columns that carry meaning (ids, state, money, references).
   Add `table: <name>` when the name does not match the id.
3. For an existing entity under another name: add `table: <name>` to it.

## entity-no-table

An entity matches no table, and it has no `at:`.

- Stored under another table name: `table: <name>`.
- Not a table (a document in Mongo, a struct, a proto message): `at: path#Type` on the type
  that holds it (`services/billing/payment.ts#Payment`, `proto/orders.proto#Order`).
- Planned and not built yet: `status: planned`. The gap stays until the code exists.

## contract-no-flow

A contract is served or published, but no flow walks it. Flows are the business knowledge crux
cannot read from code.

1. Group the uncovered contracts by entry point. A public route or a consumed topic usually
   starts a flow.
2. Offer the user 2–5 flows named in business terms (refund, sign-up, settlement), each with the
   contracts it would cover. Write only the ones they choose.
3. Trace each flow in the code: handler → service → client call or publish → consumer → … Write
   a `flow` file (`crux new flow "Refund"`) with a ```` ```steps ```` block, one step per hop,
   real error branches, `trigger:` and `outcome:`.
4. Anchor every step whose code crux did not anchor itself (see step-no-anchor).
5. Internal or admin routes that belong to no business flow: tell the user, and leave them.

## step-no-anchor

A flow step points at no code. crux anchors a step on its own when the step names a contract
and exactly one handler (sync) or publish call (async) serves it. Steps without a contract, or
with several candidates, are yours.

1. Find the code that performs the hop. For a sync call, that is the handler on the receiving
   side. For an event, the publish call on the sending side. For data access, the repository
   method. For an external call, the client function.
2. End the step line with ` @ path#Symbol`:
   ```steps
   charge: billing -> psp : http POST /v1/payment_intents @ services/billing/psp.ts#Stripe.charge
     ? charge declined -> failed @ services/billing/psp.ts#Stripe.onDecline
   ```
3. Methods are `Type.Method` (Go receiver, TS/Python class, proto `Service.Rpc`). A bare
   `#Method` works when exactly one type in the file has it.

## edge-no-anchor

A declared connection (calls, publishes, consumes, reads, writes, exposes, uses) that crux did
not find in the code, and that has no `at:`.

1. Find the code that makes it: the client call, the repository, the publish.
2. Rewrite the item with its anchor: `writes: [{to: billing-db, at: services/billing/repo.ts#PaymentRepo.save}]`.
3. **If you cannot find it, the model may be wrong.** Tell the user. The connection may be
   planned (`status: planned` on the element) or gone (remove it after they agree).

## anchor-broken

An anchor no longer resolves: the file moved, the symbol was renamed, or a line went past the
end of the file.

1. Find where the behaviour lives now: `git log -S <symbol>`, a search for the old name, or the
   caller of the old code.
2. Point the anchor at the new symbol. If the behaviour is gone, update the model (step, edge
   or element), not just the anchor.

## When you are done

1. Run `crux gaps`, `crux lint`, and `crux lint --code --info`.
2. Write a `session` file (`phase: adopt` or `build`) listing what you connected, the hints
   you added, and the gaps left open with the reason for each.
3. Tell the user what is still open, by kind.

## entity-candidate

The scanner found a record type that looks like a domain entity and no entity covers it. The
list is the scanner's: it scores types that are stored (ORM tags, `TableName()`, `gorm.Model`)
or live in a model folder, skips generated code and request/response shapes, and says why each
scored. Work from it; do not go looking through the model folders yourself first.

1. Group the candidates by owning service (the gap's element, or the services that write the
   table) and show the user a short table: type, why, your one-line guess at what it is.
2. Pick the aggregates that matter with the user. Join, audit, history, cache and in-memory
   types are usually not entities: ignore them (`lint.ignore: [entity-candidate:Name]`).
3. For each chosen one: `crux new entity "<Name>" --in <owning service>` with `at: path#Type`
   (the Evidence line) and an ```` ```entity ```` block of the fields that carry meaning (ids,
   state, money, references). Add `table: <name>` when `TableName()` or the tags name it.
4. **Only then** read beyond the list: a type you know is an entity that the scanner missed
   (no tags, not in a model folder) is added the same way, with `origin: inferred` and the
   reason in `evidence`. Never add a type you only guessed from its name.
