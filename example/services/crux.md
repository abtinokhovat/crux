---
crux: context
id: backend
in: shop
summary: services and their modules
owner: "@backend"
tags: [go]
---
# Backend

One Go module (per ADR-0003) plus the billing service in TypeScript. Services never import each
other's packages; they talk over gRPC or events.
