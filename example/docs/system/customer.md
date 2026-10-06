---
crux: actor
id: customer
in: shop
summary: web and mobile shoppers
calls: ["api via http:POST /orders", "api via http:GET /orders/{id}"]
---
# Customer

Uses the storefront (web) and the mobile app. Every flow that changes money starts here.
