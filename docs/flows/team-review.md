---
crux: flow
id: team-review
summary: a decision goes from a private draft to the team and back
trigger: crux share N
outcome: the decision is accepted with the team's input and dissent recorded
---
# Team review

```steps
share:    developer -> cli : call crux share N
publish:  cli -> share-server : http POST /api/items
open:     teammate -> share-server : http GET /i/{id}
pick:     teammate -> share-server : http POST /api/items/{id}/entries
store:    share-server -> share-data : blob item JSON
pull:     cli -> share-server : http GET /api/items/{id}
finalize: developer -> cli : call crux finalize N --option X
close:    cli -> share-server : http PATCH /api/items/{id}
```
