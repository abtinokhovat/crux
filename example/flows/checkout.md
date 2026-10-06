---
crux: flow
id: checkout
summary: from cart to a paid order
trigger: customer submits the cart
outcome: order paid and a receipt sent
decided_by: [1]
blocked_by: [retry-policy]
tags: [payments]
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
receipt: billing --> notifications : topic payment.settled
failed:  billing --> orders : topic payment.failed
```

## Notes
- The customer sees `pending` until `payment.settled` arrives (p95 under 3 s).
- A timeout at the PSP is not a decline — see [[retry-policy]].
