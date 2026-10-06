---
crux: service
id: app
title: Local app
summary: crux serve — JSON API over the graph, live reload, embedded UI
tech: [go, javascript]
code: [internal/app/**, web/**, web-src/**]
exposes: ["http:GET /api/site", "http:GET /api/doc/{id}", "http:GET /api/events"]
depends_on: [graph, workflow, linter]
decided_by: [3]
---
# Local app

Serves the browser app from the binary and the graph as JSON. The browser renders every page with
the bundled renderer (web-src → web/vendor/crux-render.js).
