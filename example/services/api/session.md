---
crux: entity
stored_in: sessions-cache
summary: a signed-in customer's login session, 30 min TTL
---
# Session

```entity
token       string    pk
customer_id uuid      required
expires_at  timestamp
```
