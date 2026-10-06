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
total       money     sum of lines, frozen at create
created_at  timestamp
lines       order-line[]  1..n
```

## Invariants
- `total` never changes after create; refunds are separate records.
- Only `pending` orders can become `paid` or `failed`.
