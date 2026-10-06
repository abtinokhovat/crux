---
crux: service
summary: public HTTP gateway for web and mobile
tech: [go, chi, opentelemetry]
exposes: ["http:POST /orders", "http:GET /orders/{id}"]
calls: ["orders via grpc:orders.v1.Orders/Create", "orders via grpc:orders.v1.Orders/Get"]
reads: [sessions-cache]
decided_by: [3]
---
# API

Authenticates requests, validates input and forwards to the owning service. Holds no state of its
own; sessions live in [[sessions-cache]].
