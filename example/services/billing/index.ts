import Fastify from "fastify";
import { Kafka } from "kafkajs";
import Stripe from "stripe";

const app = Fastify();
const kafka = new Kafka({ brokers: ["kafka:9092"] });
const consumer = kafka.consumer({ groupId: "billing" });
await consumer.subscribe({ topic: "order.created" });
app.post("/refunds", async () => ({ ok: true }));
