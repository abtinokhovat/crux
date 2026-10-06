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
partitions: 12
payload: order_id uuid, customer_id uuid, total money, lines[] (sku, qty, unit_price)
```
