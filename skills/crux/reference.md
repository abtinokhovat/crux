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
| `depends_on` | code or runtime dependency | `depends_on: [shared-auth]` |
| `runs_on` | runtime / deploy target | `runs_on: [k8s-prod]` |
| `implements` | port or contract a module implements | `implements: [payment-port]` |
| `decided_by` | ADRs that govern it | `decided_by: [1, 4]` |
| `blocked_by` | open questions that block it | `blocked_by: [retry-policy]` |
| `relates` | loose link | `relates: [pricing]` |
| `[[id]]` in prose | soft mention, rendered as a chip | `see [[retry-policy]]` |

List items may be an id, `"target via transport:name"`, `"target (transport)"`, or a map
`{to: billing, via: "grpc:Charge", label: "charge"}`.

Derived for you: `orders publishes T` + `billing consumes T` ⇒ orders → billing (async, via T);
`api calls orders via C` ⇒ api uses C and orders exposes C (unless someone else declares it).

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
charge:  billing -> psp : http POST /v1/payment_intents
  ? charge declined -> failed
  ? charge ok -> settled
settled: billing --> orders : topic payment.settled
failed:  billing --> orders : topic payment.failed
```
````

- `id:` names a step so questions and branches can point at it (`flow:checkout#charge`).
- `->` sync, `-->` async. The first word after ` : ` is a transport; the rest names the contract.
- `? condition -> step-id` (or `-> end`) branches from the step above.
- Lint checks every hop is a declared connection and every topic hop has a publisher and a consumer.

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

Owner: `owns: [order]` on the service, or `in: orders`.

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
phase: design            # adopt | design | model | build
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
| `crux new <kind> "Title" [--dir d] [--in p]` | create an element from the template |
| `crux lint [--code] [--info]` | after every edit; `--code` compares with the code |
