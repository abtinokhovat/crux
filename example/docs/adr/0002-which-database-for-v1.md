---
title: ADR-0002 — Which database for v1
subtitle: PostgreSQL or MySQL for all module data
status: Open
date: 2026-10-02
author: architect
tags: [database, postgres]
components: [postgres]
---

## Question {span=3}
```callout info Decision to make
Which database engine stores all module data in v1? The choice fixes the migration tooling, the job-queue pattern and the managed offer we can buy.
```

## Context {span=3}
- Peak write load is about 500 rows per second (assumption).
- Outbound sends use a job table with `SELECT … FOR UPDATE SKIP LOCKED`.
- The team has run MySQL before; nobody has run PostgreSQL in production (U).

## Options {span=3}
| Option | Pros | Cons | Ops | Fit |
|---|---|---|---|---|
| A — PostgreSQL 16 | SKIP LOCKED. Partial unique indexes. Declarative partitioning. JSONB. | New to the team. | Managed offer available. | ok |
| B — MySQL 8 | Team knows it. Managed everywhere. | No partial unique indexes. | Managed offer available. | warn |
| C — Both, per module | Each module picks. | Two engines to back up, upgrade and monitor. | High. | no |

```proscons PostgreSQL in one glance
+ Partial unique indexes solve "unique when set" keys
+ One engine for jobs, outbox and data
- Team needs to learn vacuum and connection pooling
~ Managed PITR on the host (check retention)
```

## Evaluation criteria {span=3}
1. Ops load for the real team size.
2. Fit with the job-table and outbox patterns.
3. A managed offer with point-in-time recovery.

## Recommendation {span=3}
```callout ok Recommendation (non-binding)
PostgreSQL 16 for all module data. Revisit only if the host cannot sell a managed PostgreSQL with PITR.
```

```sql
-- the pattern that drives the choice
SELECT id, payload FROM outbound_job
WHERE not_before <= now()
ORDER BY id
FOR UPDATE SKIP LOCKED
LIMIT 50;
```

## Questions for the user {span=3}
1. Does anyone on the team own database operations?
2. Is a managed PostgreSQL with PITR available on our host?
