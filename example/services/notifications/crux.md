---
crux: service
summary: email and push for order and payment events
tech: [go, rabbitmq]
consumes: ["topic:order.created", "topic:payment.settled", "topic:payment.failed"]
calls: ["mailer via http:POST /v3/mail/send"]
origin: inferred
confidence: medium
evidence: [services/notifications/main.go:12, deploy/notifications.yaml]
---
# Notifications

Sends the order confirmation and payment receipts.
