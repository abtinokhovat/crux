---
crux: system
id: {{name}}
summary: <one line: what this system does, for whom>
---
# {{name}}

<What the system is for. The map, flows and decisions hang off this file.>

Describe a service next to its code with a file like `services/orders/crux.md`:

```
---
crux: service
tech: [go, postgres]
exposes: ["http:POST /orders"]
publishes: ["topic:order.created"]
writes: [orders-db]
---
# Orders
```

Or let your agent map the repo: `/crux adopt`.
