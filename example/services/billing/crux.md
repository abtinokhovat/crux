---
crux: service
summary: charges, refunds and payment state
tech: [typescript, node, fastify, postgres, stripe]
consumes: ["topic:order.created"]
publishes: ["topic:payment.settled", "topic:payment.failed"]
calls: ["psp via http:POST /v1/payment_intents"]
writes: [billing-db]
decided_by: [1]
---
# Billing

Turns `order.created` into a charge at the payment provider and reports the result back as an
event. Idempotent by order id: a replayed event never charges twice.
