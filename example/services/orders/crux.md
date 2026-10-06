---
crux: service
summary: order lifecycle — create, pay, cancel
tech: [go, postgres, kafka]
owns: [order, order-line]
exposes: ["grpc:orders.v1.Orders/Create", "grpc:orders.v1.Orders/Get"]
publishes: ["topic:order.created", "topic:order.cancelled"]
consumes: ["topic:payment.settled", "topic:payment.failed"]
writes: [orders-db]
decided_by: [1, 2]
blocked_by: [retry-policy]
---
# Orders

Source of truth for orders. Writes the order and an outbox row in one transaction; a relay
publishes the outbox to Kafka (ADR-0001). Moves an order to `paid` or `failed` when billing
reports back.

## Responsibilities
- Validate stock and price snapshot at create time.
- Keep the order state machine: `pending → paid | failed | cancelled`.
- Publish every state change as an event, keyed by order id.
