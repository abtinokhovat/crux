package main

import (
	"github.com/segmentio/kafka-go"
	_ "github.com/jackc/pgx/v5"
)

func publish(w *kafka.Writer) {
	_ = w.WriteMessages(nil, kafka.Message{Topic: "order.created"})
}
