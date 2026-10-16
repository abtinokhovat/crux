---
crux: entity
summary: one charge attempt at the PSP for an order
---
# Payment

```entity
id          uuid     pk
order_id    uuid     fk order
amount      money    equals the order total at charge time
status      enum     pending | settled | failed | refunded
psp_ref     string   unique  payment intent id at the PSP
refunds     payment-refund[] 0..n
created_at  timestamp
```

## Invariants
- At most one `settled` payment per order.
- `amount` never changes; a partial refund is a `refund` record.
