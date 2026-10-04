# Architecture Decision Records

Run `crux serve` to browse them visually (graph, architecture map, search).

- Source of truth: `NNNN-kebab-title.md`. Never renumber; never delete — supersede.
- Status: `Open` → `Proposed` → `Accepted` | `Rejected`; later `Superseded by NNNN` / `Deprecated`.
- Create one: `crux q "Which broker do we use for v1?"`

## Index

<!-- crux:index:start -->
| # | Title | Status | Tags |
|---|---|---|---|
| [0001](0001-use-a-kafka-protocol-log-for-domain-events.md) | Use a Kafka-protocol log for domain events | Proposed | `kafka` `messaging` `events` |
| [0002](0002-which-database-for-v1.md) | Which database for v1 | Open | `database` `postgres` |
| [0003](0003-repository-layout.md) | Repository layout | Accepted | `layout` `go` |
<!-- crux:index:end -->
