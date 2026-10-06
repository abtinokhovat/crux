---
crux: flow
id: refund
trigger: support agent approves a refund
outcome: money back on the customer's card, order marked refunded
---
# Refund

```steps
request: customer -> api : http POST /orders/{id}/refund
forward: api -> orders : grpc orders.v1.Orders/Refund
emit:    orders --> billing : topic order.refund_requested
charge:  billing -> psp : http POST /v1/refunds
  ? psp rejects -> manual
  ? ok -> done
done:    billing --> orders : topic payment.refunded
manual:  billing -> notifications : topic refund.manual_review
```
