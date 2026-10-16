---
crux: entity
id: payment-refund
summary: money returned against a settled payment
---
# Refund

```entity
id          uuid     pk
payment_id  uuid     fk payment
amount      money    ≤ payment amount minus earlier refunds
reason      enum     customer_request | fraud | duplicate
status      enum     requested | done | manual_review
```
