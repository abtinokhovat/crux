---
crux: contract
id: "{{id}}"
# on: kafka            # the broker that hosts a topic or queue
# schema: proto/things/v1/events.proto#ThingCreated
summary: <when it is sent or called, and what it promises>
---
# {{title}}

```contract
key: <partition key or idempotency key>
payload: id uuid, total money
```
