---
crux: entity
id: order-line
summary: one product in an order, with its price snapshot
---
# Order line

```entity
order_id   uuid   fk order
sku        string
qty        int    > 0
unit_price money  snapshot at create
```
