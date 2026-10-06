---
crux: question
id: retry-policy
raised_from: flow:checkout#charge
blocks: [checkout]
owner: "@payments"
phase: build
date: 2026-10-06
---
# Retry on a PSP timeout?

When `POST /v1/payment_intents` times out, the charge may or may not exist. Do we retry with the
same idempotency key, or poll the PSP first?

## Options
| Option | Pros | Cons | Fit |
|---|---|---|---|
| A — Retry with the same idempotency key | Simple. PSP dedupes. | Needs keys kept 24 h. | warn |
| B — Poll the PSP, then decide | Never double-charges. | Extra call, slower. | warn |
