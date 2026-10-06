---
crux: service
id: share-server
title: Share server
summary: meeting notes and team review; one JSON file per shared question
tech: [go, docker]
exposes: ["http:POST /api/items", "http:GET /api/items/{id}", "http:PATCH /api/items/{id}", "http:POST /api/items/{id}/entries", "http:GET /i/{id}"]
writes: [share-data]
---
# Share server
