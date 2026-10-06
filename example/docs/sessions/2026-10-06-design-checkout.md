---
crux: session
id: design-checkout
phase: design
date: 2026-10-06
produced: [checkout, orders, billing, "topic:order.created", 1]
---
# Design session — checkout

Started from "orders must not be lost when billing is down". Compared a synchronous charge from
orders (simple, couples availability) with an event to billing (decoupled, needs idempotency).
Chose events (ADR-0001). Open: what to do on a PSP timeout — [[retry-policy]].
