# crux format reference

Everything crux knows lives in markdown files in the repo. A file joins the graph when its
frontmatter has a `crux:` key. File names and folders don't matter — put a service's file next
to its code (`services/orders/crux.md`), a flow next to the code that drives it, decisions
wherever the team keeps them. Run `crux lint` after every edit; `crux serve` shows the result.

## Header (every element)

```yaml
---
crux: service              # the kind — required; this key marks the file
id: orders                 # optional; default = slug of the first "# " heading
in: backend                # parent element; default = nearest container in an enclosing folder
summary: order lifecycle   # one line, shown under the name everywhere
owner: "@payments"
status: active             # free lifecycle word (planned, deprecated…); ADRs use decision statuses
tech: [go, postgres, kafka]   # catalog ids or names (crux lint says when one is unknown)
tags: [payments]
code: [services/orders/**] # default for service/app/job/library/module = the file's folder
at: [services/orders/server.go#Server]   # code anchors: the symbol(s) this element is (see Code anchors)
hosts: [api.stripe.com]    # externals: the hosts it answers on, so crux connects code that calls them
origin: inferred           # set by agents for unconfirmed items; the user confirms by deleting it
confidence: medium         # high | medium | low (inferred items only)
evidence: [services/orders/http.go:42, deploy/orders.yaml]
---
# Orders

Prose, panels (`## Title`) and fenced components, like any crux page.
```

## Kinds

| Kind | Use for | Draws as |
|---|---|---|
| `system` | the whole platform (one per repo, usually) | the map's title |
| `context` | bounded context / domain grouping services | blue frame |
| `service` | deployable unit: binary, container, function | bold box |
| `app` | client app: web, mobile, CLI | box |
| `job` | worker, cron, consumer process | box |
| `library` | shared code used by several services | box |
| `module` | code inside a service: package, layer, port, adapter | box with side bar |
| `actor` | person or role that starts flows | dashed |
| `external` | system you don't own: PSP, SaaS, partner API | dashed |
| `store` | database, object store, search index | cylinder |
| `cache` | cache tier | cylinder |
| `broker` | message broker or stream; hosts topics and queues | pipe |
| `gateway` | load balancer, proxy, API gateway | box |
| `infra` | other infrastructure | box |
| `contract` | an interface: endpoint, RPC, topic, queue, webhook | pill |
| `entity` | domain model with fields and invariants | table card |
| `flow` | business flow: trigger → steps → outcome | route |
| `question` | open unknown that blocks something | dotted card |
| `session` | record of an adopt / design / model / build session | timeline entry |
| `convention` | code convention (layering, errors, naming, tests) | rule card |
| `adr` / `doc` | decision record / any other note | page |

Aliases work (`worker`→job, `database`→store, `topic`→contract, `decision`→adr…).

## Connections (frontmatter lists)

Write a connection on one side only; crux shows both directions.

| Key | Meaning | Example |
|---|---|---|
| `calls` | sync call to an element | `calls: ["billing via grpc:billing.v1.Billing/Charge"]` |
| `exposes` | contracts this element serves | `exposes: ["http:POST /orders"]` |
| `uses` | contracts it is a client of | `uses: ["http:POST /v1/charges"]` |
| `publishes` | topics, queues, webhooks it emits | `publishes: ["topic:order.created"]` |
| `consumes` | topics or queues it subscribes to | `consumes: ["topic:payment.settled"]` |
| `reads` / `writes` | data access to a store or entity | `writes: [orders-db]` |
| `owns` | entities it is the source of truth for | `owns: [order, order-line]` |
| `stored_in` | on an entity: the store it is kept in (else calculated) | `stored_in: orders-db` |
| `depends_on` | code or runtime dependency | `depends_on: [shared-auth]` |
| `runs_on` | runtime / deploy target | `runs_on: [k8s-prod]` |
| `implements` | port or contract a module implements | `implements: [payment-port]` |
| `decided_by` | ADRs that govern it | `decided_by: [1, 4]` |
| `blocked_by` | open questions that block it | `blocked_by: [retry-policy]` |
| `relates` | loose link | `relates: [pricing]` |
| `[[id]]` in prose | soft mention, rendered as a chip | `see [[retry-policy]]` |

List items may be an id, `"target via transport:name"`, `"target (transport)"`, or a map
`{to: billing, via: "grpc:Charge", label: "charge", at: services/orders/billing.go#Client.Charge}`.
A string item takes its anchor after ` @ `: `"orders-db @ services/orders/repo.go#Repo.Insert"`.

Derived for you: `orders publishes T` + `billing consumes T` ⇒ orders → billing (async, via T);
`api calls orders via C` ⇒ api uses C and orders exposes C (unless someone else declares it).

## Code anchors

An anchor points from the model into the code, so an agent goes straight from "the charge step"
to the lines that do it.

| Form | Points at |
|---|---|
| `path/file.go#Symbol` | a function, type, const or var |
| `path/file.go#Type.Method` | a method: Go receiver, TS/JS/Python class method, proto `Service.Rpc` |
| `path/file.go#Method` | the only method with that name in the file |
| `path/file.sql#orders` | a table, view or type created in SQL |
| `path/file.yaml:12` | a line, only where there is no symbol (manifests, scripts) |
| `path/file.go` or `path/dir` | a whole file or folder |

Paths are relative to the project root. crux parses Go, TS/JS, Python, proto and SQL. Other
languages take `file:line`. Where anchors go:

- on an element: `at: [path#Symbol]`
- on a connection: `{to: X, at: path#Symbol}`, or `"X @ path#Symbol"`
- on a flow step or branch: at the end of the line, ` @ path#Symbol`

`crux lint` fails (`anchor`) when an anchor stops resolving. `crux trace` prints each one as
`file:line`. Prefer symbols: lines drift with every edit.

## What crux finds on its own

`crux trace`, `crux gaps` and `crux lint --code` read the code on every run. They add to the
graph only what the code or a manifest states exactly. **Do not hand-write these.** Write the
hint instead when one is missing.

| Found | From | Becomes |
|---|---|---|
| deployable → store/cache/broker/service | compose `depends_on`, `links`, env values naming a host (`postgres://orders-db:5432`); k8s env values, through Service selectors | `depends_on` (infra) or `calls` (services), anchored to the manifest line |
| module → element | env var read in code (`os.Getenv`, `process.env`) + a `scan.env` hint | the same, anchored to the read |
| module → service/external | a host in a string literal (`"http://orders:8080"`, `"https://api.stripe.com"`) that is an element, or in an element's `hosts:` | `calls` |
| gRPC client → server | `NewXClient(` where exactly one element registers `RegisterXServer` | `calls` labelled with the proto service |
| publishes / consumes | publish/subscribe APIs crux knows (kafka-go, kafkajs, NATS, Watermill, asynq, BullMQ, Nest…) and `lint.publishes` / `lint.consumes` wrappers | the connection, anchored to the call |
| exposes → handler | a route that matches a declared contract; Go/TS handlers registered by name; gRPC methods on the type that embeds `Unimplemented<X>Server` | the anchor of `exposes`, then of the flow step that calls it |
| flow step → code | a step over a contract with exactly one handler (sync) or publish call (async) | the step's anchor |
| entity → table | SQL migrations replayed in order (create, alter, rename, drop); matched by `table:`, or the id and its regular plural in snake_case | the entity's anchor |
| gateway → service | Kubernetes Ingress backends, when the model has one gateway | `calls` labelled with the path |
| owner | `CODEOWNERS`, for elements that name none | `owner` |
| topic → broker | `on:`, else the one broker its publishers and consumers connect to (declared or found), else the system's only broker | the topic sits inside the broker on the map |
| entity → store | `stored_in:`, else the one store its owner writes (else reads or depends on, found connections included) | the entity sits inside the store on the map; its owner's line reads "owns" |

The map (`crux serve`, Map) is a canvas: drag boxes and they stay. The layout is saved per
level in `.crux/layout.json`; commit it to share the arrangement.

A topic matched only by words on the line (writer, consumer…) is never connected. It becomes a
`topic-direction` gap.

**Provenance**, shown by `crux trace`: *declared* (a crux file says so), **✓code** (declared and
found in the code), *in code, not declared* (found only by crux; `crux lint --code --info`
lists them as `code-link-undeclared`).

**Hints** in `crux.config.yaml` give crux the one fact it cannot read. After that, the
connection stays deterministic:

```yaml
scan:
  env:   { ORDERS_DSN: orders-db, PSP_URL: stripe }   # env var whose value is a secret → element
  names: { postgres: orders-db, pay: billing }        # manifest / host name → element id
lint:
  publishes: ['\bbus\.Emit\(\s*ctx\s*,\s*"?([\w.]+)']   # project wrappers, one capture: the topic
  consumes:  ['\bbus\.On\(\s*"?([\w.]+)']
```

What crux saw but could not connect is listed by `crux gaps`. [gaps.md](gaps.md) has the
procedure for each kind.

## Contracts and transports

A contract ref is `transport:name`. Without a contract file, crux creates the node from the
first reference and places it under its broker (`on:`) or its provider.

| Transport | Mode | Example |
|---|---|---|
| `http` (rest) | sync | `http:POST /orders/{id}/refund` |
| `grpc` (rpc, connect) | sync | `grpc:orders.v1.Orders/Create` |
| `graphql`, `trpc`, `tcp` | sync | `graphql:Mutation.placeOrder` |
| `topic` (event, kafka) | async | `topic:order.created` |
| `queue` (job, amqp, sqs) | async | `queue:emails` |
| `webhook` | async | `webhook:payment.succeeded` |
| `ws`, `sse` | stream | `ws:/live` |
| `sql`, `kv`, `blob`, `search` | data | (set on reads/writes) |
| `cron` | trigger | `cron:nightly-settlement` |

A contract file adds detail:

````markdown
---
crux: contract
id: "topic:order.created"
on: kafka
schema: proto/orders/v1/events.proto#OrderCreated
summary: emitted once per new order, keyed by order id
---
# order.created

```contract
key: order_id
retention: 7d
payload: order_id uuid, customer_id uuid, total money
```
````

## Flows

````markdown
---
crux: flow
id: checkout
trigger: customer submits the cart
outcome: order paid and a receipt sent
decided_by: [1]
---
# Checkout

```steps
== order ==
place:   customer -> api : http POST /orders
create:  api -> orders : grpc orders.v1.Orders/Create
emit:    orders --> billing : topic order.created
note: orders commits the order and the outbox row in one transaction
== payment ==
charge:  billing -> psp : http POST /v1/payment_intents @ services/billing/psp.ts#Stripe.charge
  ? charge declined -> failed
  ? charge ok -> settled
settled: billing --> orders : topic payment.settled
failed:  billing --> orders : topic payment.failed
```
````

- `id:` names a step so questions and branches can point at it (`flow:checkout#charge`).
- ` @ path#Symbol` at the end of a step or branch anchors it to the code that performs it. crux
  fills it in on its own when one handler or publish call serves the step's contract.
- `->` sync, `-->` async. The first word after ` : ` is a transport; the rest names the contract.
- `? condition -> step-id` (or `-> end`) branches from the step above.
- Lint checks every hop is a declared connection and every topic hop has a publisher and a consumer.
- Every flow with `steps` plays on its page as an animated scene made from them. Write a
  ```` ```track ```` block (below) when the flow has endings worth comparing, or when the
  stations are not services (statuses, keys, people).

### Tracks: animated scenes with scenarios

A `track` is a flow you can play: stations on a grid, a token that rides the rails, and scenarios
as tabs over the same scene. Stations that name a crux element (`= element-id`) are drawn as that
element and link to it. A hop label that starts with a transport (`queue`, `grpc`, `tcp`…) gets
its chip, and an async transport makes the hop async.

````markdown
```track
title: Purchase — POS to Shaparak
token: 0200 purchase                    ← what travels
state: status=new, rows=0               ← the inspector; beats change it
stations:                               ← grid map, "." is an empty cell
  pos   session  parser   shaparak
  .     .        domain   .
station pos = pos-devices               ← a crux element: name, kind, tech come from it
station parser = parsersvc sub="decode · RRN"
station hsm "HSM" kind=hsm              ← not an element: label + kind
scenario ok "Approved" tone=ok outcome="code 0, successful"
scenario late "Timeout" tone=warn tags=undo | status=new
== Ingress ==                           ← phase
pos -> session : tcp 0200               ← sync hop · ~> async · <-> round trip
parser <-> domain : grpc CreateTransaction | rows+=1
[late] at shaparak: no answer | warn, status=unknown
[!late] shaparak -> parser : 0210 · 00 | ok, token "0210"
note: narration for the beat above
wait 5m : settlement job tick           ← time passes (clock in the inspector)
par … end · loop 3 "retry" … end · when a,b … end
```
````

- Kinds for stations that are not elements: actor service store queue external hsm job state key
  gate hub terminal.
- `[a,b]` plays a beat only in those scenarios (or scenarios whose `tags=` include them);
  `[!a]` leaves it out of `a`. Untagged beats play everywhere.
- After ` | `: `ok`, `fail`, `warn`, `key=value`, `key+=1`, `token "new label"`. Commas separate
  ops, so quote values that contain one.
- Readers can switch Map / Lanes (the same beats as a sequence diagram), step, scrub, change
  speed, and open the script, which renders as a route.

## Entities

````markdown
---
crux: entity
id: order
summary: a customer's purchase and its state
---
# Order

```entity
id          uuid      pk
customer_id uuid      fk customer
status      enum      pending | paid | failed | cancelled
total       money     frozen at create
lines       order-line[]  1..n
```

## Invariants
- Only `pending` orders can become `paid` or `failed`.
````

crux calculates the rest — write only the fields:

- **Relations** (shown on `#/model` and each entity page): `fk X` → references X; a list type
  `X[]` → has X; a field typed `X` → references X; a name `x_id` / `xId` → references entity `x`.
  A cardinality next to the field is how many of the target: `1..1` (default for a reference),
  `0..1`, `1..n` (default for a list), `0..n`; `n..m` on a list is many-to-many.
- **Where it lives**: owner = `in:`, `owns:` on a service, or the service whose folder holds the
  file. Store = `stored_in: <store>` (plus `table:`), else the one store its owner `writes`.
  Code = `code:`, else the file's folder.
- **Lint**: `fk` to something that is not an entity (warn); a relation into another service's
  entity (`entity-boundary`, info); an entity whose store cannot be found (`entity-store`, info).

## Questions — the feedback loop

````markdown
---
crux: question
id: retry-policy
raised_from: flow:checkout#charge    # where it came up (flow step, element, or ADR)
blocks: [checkout]                   # what cannot be finished until it is answered
owner: "@payments"
phase: build                         # design | model | build | adopt
date: 2026-10-06
---
# Retry on a PSP timeout?

What is unknown and why it matters. Options with pros and cons if there are any.

## Answer           ← add when answered (or answer: in frontmatter); state becomes answered
Retry with the same idempotency key, max 3 times.
````

## Sessions

````markdown
---
crux: session
id: design-checkout
phase: design            # adopt | design | model | build | work (any other session)
date: 2026-10-06
produced: [checkout, orders, "topic:order.created", 7]   # elements, contracts, ADR numbers
---
# Design session — checkout

The problem as stated, options compared and why one won, what was written, what is still open
(link questions with [[id]]).
````

## Conventions

````markdown
---
crux: convention
id: errors
applies_to: [services/**]
summary: wrap errors with context; map to gRPC codes at the edge only
---
# Errors
- Wrap with `fmt.Errorf("create order: %w", err)`; never log and return.
````

`crux context <path>` returns the conventions whose `applies_to` covers the path.

## Fenced components

Decision: `decision`, `options`, `compare`, `scenarios`, `proscons`, `tradeoff`, `stats`, `adr`.
System: `steps`, `entity`, `contract`, ```` ```element orders billing ````, ```` ```catalog ````.
Diagrams: `sequence` (`participant Name = element-id` links to the map), `flow`, `tree`, `arch`,
`rules`, `timeline`, `limits`, `kv`, `callout`, `annot`. `crux components` lists them.

## Catalog

`tech:` values come from a built-in catalog (≈150 technologies with icon, color, category and
detect rules). Extend or recolor in `.crux/catalog.yaml`:

```yaml
tech:
  acme-bus: { label: Acme Bus, category: broker, color: "#7b3fe4" }
transports:
  nats-rpc: { label: NATS request, mode: sync }
```

## Commands an agent uses

| Command | When |
|---|---|
| `crux context <paths> <terms>` | before changing code: decisions, elements, conventions, open questions |
| `crux trace <id>` | how something works: steps, connections, flows, decisions |
| `crux list --kind service\|flow\|contract\|all` | what exists |
| `crux scan [--json]` | facts from code (adopt, drift) |
| `crux gaps [--json] [--kind k] [--in id]` | what crux saw in the code but could not connect — your work list ([gaps.md](gaps.md)) |
| `crux new <kind> "Title" [--dir d] [--in p]` | create an element from the template |
| `crux lint [--code] [--info]` | after every edit; `--code` compares with the code |
