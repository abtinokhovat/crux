# Architecture Decision Records

Run `npx adr serve` to browse them visually (graph, architecture map, search).

- Source of truth: `NNNN-kebab-title.md`. Never renumber; never delete — supersede.
- Status: `Open` → `Proposed` → `Accepted` | `Rejected`; later `Superseded by NNNN` / `Deprecated`.
- Create one: `adr new "Use Kafka for domain events" --tags kafka,messaging --components kafka`

## Index

<!-- adr:index:start -->
| # | Title | Status | Tags |
|---|---|---|---|
| [0001](0001-use-a-kafka-protocol-log-for-domain-events.md) | Use a Kafka-protocol log for domain events | Proposed | `kafka` `messaging` `events` |
| [0002](0002-which-database-for-v1.md) | Which database for v1 | Open | `database` `postgres` |
| [0003](0003-repository-layout.md) | Repository layout | Accepted | `layout` `go` |
<!-- adr:index:end -->
