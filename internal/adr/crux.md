---
crux: module
id: graph
in: cli
summary: reads markdown, crux headers, elements, links, flows and the architecture map
tech: [go]
reads: [repo]
depends_on: [catalog]
decided_by: [1, 2]
---
# Graph

`Load` walks the repo (respecting .gitignore), reads ADRs, docs and every file with a `crux:`
header, resolves typed connections into links, creates implied contracts, infers parents from
folders, and merges structural elements into the map.
