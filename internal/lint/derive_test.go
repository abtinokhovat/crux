package lint

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/abtinokhovat/crux/internal/adr"
	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/scan"
)

// a small shop: compose wiring, a migration, a proto with its Go server, a gRPC client, an env
// var behind a secret, a hint for another, and a flow whose steps crux anchors itself.
func shop(t *testing.T) (*config.Config, *adr.Store, *scan.Facts, *Derived) {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"crux.config.yaml": "title: t\nscan:\n  env: {CACHE_ADDR: cache}\n",
		"go.mod":           "module example.com/shop\n\ngo 1.22\n",
		"docker-compose.yml": `services:
  db: {image: postgres:16}
  kafka: {image: bitnami/kafka:3}
  orders:
    build: ./services/orders
    environment:
      DATABASE_URL: postgres://u:p@db:5432/o
      PAYMENTS_TOKEN_URL: ${PAYMENTS_TOKEN_URL}
      KAFKA_BROKERS: kafka:9092
  api:
    build: ./services/api
`,
		"CODEOWNERS":                       "/services/orders/ @team-orders\n",
		"proto/orders.proto":               "syntax = \"proto3\";\npackage orders.v1;\nservice Orders {\n  rpc Create(Req) returns (Res);\n}\n",
		"services/orders/migrations/1.sql": "CREATE TABLE orders (id uuid primary key);\nCREATE TABLE audit_log (id int);\n",
		"services/orders/crux.md":          "---\ncrux: service\nexposes: [\"grpc:orders.v1.Orders/Create\"]\nwrites: [orders-db]\npublishes: [\"topic:order.created\"]\n---\n# Orders\n",
		"services/orders/order.md":         "---\ncrux: entity\nin: orders\n---\n# Order\n",
		"services/orders/server.go": `package main

type server struct {
	pb.UnimplementedOrdersServer
}

func (s *server) Create() {
	w.WriteMessages(ctx, kafka.Message{Topic: "order.created"})
}

func main() {
	pb.RegisterOrdersServer(g, &server{})
	_ = os.Getenv("CACHE_ADDR")
}
`,
		"services/api/crux.md": "---\ncrux: service\nexposes: [\"http:POST /orders\"]\n---\n# API\n",
		"services/api/main.go": `package main

func main() {
	r.Post("/orders", createOrder)
	_ = pb.NewOrdersClient(conn)
	http.Get("https://api.stripe.com/v1/x")
}

func createOrder() {}
`,
		"infra/db.md":    "---\ncrux: store\nid: orders-db\n---\n# Orders DB\n",
		"infra/cache.md": "---\ncrux: cache\n---\n# Cache\n",
		"infra/kafka.md": "---\ncrux: broker\n---\n# Kafka\n",
		"flows/buy.md":   "---\ncrux: flow\n---\n# Buy\n```steps\nplace: customer -> api : http POST /orders\ncreate: api -> orders : grpc orders.v1.Orders/Create\nemit: orders --> api : topic order.created @ services/orders/server.go#server.Create\nbad: api -> orders : grpc orders.v1.Orders/Create @ services/api/main.go#nope\n```\n",
		"actors.md":      "---\ncrux: actor\nid: customer\n---\n# Customer\n",
	}
	for rel, text := range files {
		p := filepath.Join(root, rel)
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	cfg, err := config.Load(root)
	if err != nil {
		t.Fatal(err)
	}
	s := adr.Load(cfg)
	f := scan.Run(cfg, s.Catalog, nil)
	d := Derive(cfg, s, f)
	Merge(cfg, s, d)
	return cfg, s, f, d
}

func link(s *adr.Store, from, typ, to string) *adr.Link {
	for i, l := range s.Links {
		if l.From == from && l.Type == typ && l.To == to {
			return &s.Links[i]
		}
	}
	return nil
}

func TestDerive(t *testing.T) {
	cfg, s, _, _ := shop(t)
	// compose points orders at "db", which is no element (and no scan.names hint): the declared
	// write stays unconfirmed
	if l := link(s, "orders", "writes", "orders-db"); l == nil || l.Source != "" {
		t.Errorf("declared write changed without evidence: %+v", l)
	}
	// gRPC client → the one server
	if l := link(s, "api", "calls", "orders"); l == nil || l.Source != "scan" || !strings.Contains(l.Label, "orders.v1.Orders") {
		t.Errorf("grpc client call: %+v", l)
	}
	// scan.env hint
	if l := link(s, "orders", "depends_on", "cache"); l == nil || l.Source != "scan" {
		t.Errorf("env hint link: %+v", l)
	}
	// declared exposes confirmed and anchored to the handler / the gRPC method
	if l := link(s, "api", "exposes", "http:POST /orders"); l == nil || l.Source != "both" || l.At != "services/api/main.go#createOrder" {
		t.Errorf("http exposes: %+v", l)
	}
	if l := link(s, "orders", "exposes", "grpc:orders.v1.Orders/Create"); l == nil || l.Source != "both" || l.At != "services/orders/server.go#server.Create" {
		t.Errorf("grpc exposes: %+v", l)
	}
	if l := link(s, "orders", "publishes", "topic:order.created"); l == nil || l.Source != "both" {
		t.Errorf("publish: %+v", l)
	}
	// steps: anchored from the provider's handler
	var fl *adr.Doc
	for _, e := range s.Elements {
		if e.ID == "buy" {
			fl = e
		}
	}
	at := map[string]string{}
	for _, st := range fl.Steps {
		at[st.ID] = st.At
	}
	if at["place"] != "services/api/main.go#createOrder" || at["create"] != "services/orders/server.go#server.Create" {
		t.Errorf("step anchors: %v", at)
	}
	// entity ↔ table, CODEOWNERS
	order := s.ByID["order"]
	if len(order.At) != 1 || order.At[0] != "services/orders/migrations/1.sql#orders" {
		t.Errorf("entity anchor: %v", order.At)
	}
	// data has a home in the infrastructure: the topic on the broker orders connects to (found
	// in compose), the entity in the store its owner writes; both draw inside them on the map
	if c := s.ByID["topic:order.created"]; c.Parent != "kafka" {
		t.Errorf("topic broker: %q", c.Parent)
	}
	if order.Store != "orders-db" {
		t.Errorf("entity store: %q", order.Store)
	}
	if n := s.Architecture.Nodes["order"]; n == nil || n.Parent == nil || *n.Parent != "orders-db" {
		t.Errorf("entity not drawn in its store: %+v", n)
	}
	if n := s.Architecture.Nodes["topic:order.created"]; n == nil || n.Parent == nil || *n.Parent != "kafka" {
		t.Errorf("topic not drawn in its broker: %+v", n)
	}
	if s.ByID["orders"].Owner != "@team-orders" {
		t.Errorf("owner: %q", s.ByID["orders"].Owner)
	}
	// broken anchors fail lint
	if fs := Graph(cfg, s); !has(fs, "anchor", "nope") {
		t.Errorf("broken anchor not reported: %+v", fs)
	}
}

func TestGaps(t *testing.T) {
	cfg, s, f, d := shop(t)
	gaps := Gaps(cfg, s, f, d)
	find := func(kind, subject string) bool {
		for _, g := range gaps {
			if g.Kind == kind && strings.Contains(g.Subject, subject) {
				return true
			}
		}
		return false
	}
	for _, want := range [][2]string{
		{"wire-unresolved", "db"}, {"env-unmapped", "PAYMENTS_TOKEN_URL"}, {"host-unmapped", "api.stripe.com"},
		{"infra-unmodeled", "db"}, {"table-no-entity", "audit_log"}, {"topic-no-consumer", "order.created"},
		{"anchor-broken", "nope"},
	} {
		if !find(want[0], want[1]) {
			t.Errorf("gap %s %s missing", want[0], want[1])
		}
	}
	if find("env-unmapped", "CACHE_ADDR") || find("step-no-anchor", "buy#place") {
		t.Errorf("a resolved item came back as a gap: %+v", gaps)
	}
}
