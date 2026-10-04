---
title: ADR-0001 — Use a Kafka-protocol log for domain events
subtitle: Services publish domain events to a Kafka-protocol log, keyed by aggregate id, encoded as protobuf.
status: Proposed
date: 2026-10-01
author: architect
tags: [kafka, messaging, events]
components: [kafka]
depends_on: [0003]
relates: [0002]
---

## Decision {span=3}
```callout ok Decision
Use a Kafka-protocol broker as the durable log between services. Key records by aggregate id to keep order. Encode payloads with protobuf. Ops may run Apache Kafka (KRaft) or Redpanda; both speak the same protocol.
```

## Key numbers {span=3}
```stats
500 msg/s | Peak inbound | assumption
32 | Partitions per topic | start value
7 d | Raw retention | replay window
3 | Replication factor
```

## Context {span=3}
- Webhook handlers must reply fast, so a durable buffer must sit before the database.
- Events in one aggregate must stay in order.
- Several consumers read the same events: workflow, analytics, realtime push.
- The database engine is still open (ADR-0002), so the log must not depend on it.

## Options {span=3}
| Option | Pros | Cons | Verdict |
|---|---|---|---|
| A — Kafka protocol (Kafka or Redpanda) | Ordered partitions by key. Many consumer groups. Retention gives replay. | One more stateful system to run. | ok |
| B — NATS JetStream | Light to run. Single binary. | Per-key order with parallel consumers needs manual subject sharding. | warn |
| C — RabbitMQ | Simple queues. Team knows it. | No replay. Fan-out to new consumers needs new queues. | no |
| D — Database table as queue | No new system. | Ingress depends on the database. Polling cost grows with load. | no |

## Scoring {span=3}
```compare
Criterion        | weight | Kafka | NATS | RabbitMQ | DB table
Ordering per key | 3      | 5     | 3    | 2        | 4
Replay           | 3      | 5     | 4    | 1        | 2
Ops load         | 2      | 2     | 4    | 4        | 5
Team knowledge   | 1      | 3     | 2    | 4        | 5
```

## Where we stand {span=3}
```tradeoff
Simplicity <-> Scale | 0.7 | we pay ops cost now to avoid a migration later
Build <-> Buy | 0.8 | managed or well-known OSS, no custom broker
```

## Design {span=3}
```flow LR
Ingress -> [(raw.v1)]: key = account:chat
[(raw.v1)] -> Ingest: consumer group
Ingest -> [(raw.dlq.v1)]: poison records
Relay -> [(events.v1)]: key = aggregate_id
[(events.v1)] -> Workflow & Analytics & Realtime
```

## Producer contract {span=3}
```go
// Every record carries the same envelope; consumers deduplicate on EventID.
type Envelope struct {
	EventID     string    `json:"event_id"`
	EventType   string    `json:"event_type"`
	WorkspaceID string    `json:"workspace_id"`
	OccurredAt  time.Time `json:"occurred_at"`
	Payload     []byte    `json:"payload"` // protobuf, see contract/proto
}

func (p *Producer) Publish(ctx context.Context, key string, e Envelope) error {
	return p.client.ProduceSync(ctx, &kgo.Record{Topic: p.topic, Key: []byte(key), Value: must(proto.Marshal(e))}).FirstErr()
}
```

```proto
syntax = "proto3";
package events.v1;

message MessageReceived {
  string conversation_id = 1;
  int64 seq = 2;
  string text = 3;
}
```

## Risks {span=3}
```risks
Broker outage | 2 | 5 | relay spools to disk, ingress keeps accepting
Hot partition | 3 | 3 | key by aggregate, watch lag per partition
Schema drift | 3 | 4 | buf breaking-change check in CI
```

## Consequences {span=3}
- Positive: ingress stays up when the database is slow or down.
- Positive: new consumers join with their own group and need no producer change.
- Cost we accept: one more cluster to run and watch (lag, disk).
- Cost we accept: partition count is hard to change without reordering keys.
- Follow-ups: pkg/kafka module, deploy config, lag alerts.

## Related {span=3}
```adr
0002 the database choice decides whether option D is viable
0003 where pkg/kafka lives
```
