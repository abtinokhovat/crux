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

func fixture(t *testing.T) (*config.Config, *adr.Store, *scan.Facts) {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"crux.config.yaml": "title: t\n",
		"go.mod":           "module example.com/shop\n\ngo 1.22\n\nrequire (\n\tgithub.com/segmentio/kafka-go v0.4.47\n\tgithub.com/redis/go-redis/v9 v9.5.1\n)\n",
		"services/orders/crux.md": "---\ncrux: service\nexposes: [\"http:POST /orders\", \"http:GET /orders/{id}\"]\npublishes: [\"topic:order.created\", \"topic:order.cancelled\"]\n---\n# Orders\n",
		"services/orders/main.go": `package main

import (
	"github.com/segmentio/kafka-go"
	"github.com/redis/go-redis/v9"
	"example.com/shop/services/billing/charge"
)

const OrderCreatedTopic = "order.created"

func main() {
	r.Post("/orders", nil)
	r.Get("/orders/{id}", nil)
	r.Delete("/orders/{id}", nil)
	r.Get("/healthz", nil)
	w.WriteMessages(ctx, kafka.Message{Topic: OrderCreatedTopic})
	_ = redis.NewClient(nil)
	charge.Do()
}
`,
		"services/billing/crux.md":        "---\ncrux: service\nconsumes: [\"topic:order.created\"]\n---\n# Billing\n",
		"services/billing/charge/c.go":    "package charge\n\nfunc Do() {}\n",
		"services/billing/main.go":        "package main\n\nfunc main() { sub.Subscribe(ctx, \"payment.done\") }\n",
		"services/shipping/main.go":       "package main\n\nfunc main() {}\n",
		"services/web/package.json":       `{"name":"web","dependencies":{"express":"^4","kafkajs":"^2"}}`,
		"services/web/index.ts":           "import express from 'express';\nconst app = express();\napp.get('/home', h);\nproducer.send({ topic: 'page.viewed' });\n",
		"docs/flows/checkout.md":          "---\ncrux: flow\n---\n# Checkout\n```steps\nbuy: orders --> billing : topic order.created\nship: billing -> orders : http POST /ship\n```\n",
		"docs/contracts/unused.md":        "---\ncrux: contract\nid: \"topic:nobody\"\n---\n# nobody\n",
		"docs/system/svc.md":              "---\ncrux: service\nid: ghost\ncode: [services/ghost/**]\ntech: [quantumdb]\n---\n# Ghost\n",
		"docker-compose.yml":              "services:\n  db:\n    image: bitnami/postgresql:16\n  web:\n    build: ./services/web\n",
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
	return cfg, s, scan.Run(cfg, s.Catalog, nil)
}

func has(fs []Finding, rule, sub string) bool {
	for _, f := range fs {
		if f.Rule == rule && strings.Contains(f.Message, sub) {
			return true
		}
	}
	return false
}

func TestScanFacts(t *testing.T) {
	_, _, f := fixture(t)
	routes := map[string]bool{}
	for _, r := range f.Routes {
		routes[r.Method+" "+r.Path] = true
	}
	for _, want := range []string{"POST /orders", "GET /orders/{id}", "DELETE /orders/{id}", "GET /home"} {
		if !routes[want] {
			t.Errorf("route %s not found in %v", want, routes)
		}
	}
	topics := map[string]string{}
	for _, tp := range f.Topics {
		topics[tp.Name] = tp.Dir
	}
	if topics["order.created"] != "pub" || topics["payment.done"] != "sub" || topics["page.viewed"] == "" {
		t.Errorf("topics: %v", topics)
	}
	tech := map[string]bool{}
	for _, x := range f.Tech {
		tech[x.ID] = true
	}
	for _, want := range []string{"kafka", "redis", "express", "postgres"} {
		if !tech[want] {
			t.Errorf("tech %s missing: %v", want, tech)
		}
	}
	names := map[string]bool{}
	for _, c := range f.Services {
		names[c.Name] = true
	}
	for _, want := range []string{"orders", "billing", "shipping", "web"} {
		if !names[want] {
			t.Errorf("candidate %s missing: %+v", want, f.Services)
		}
	}
}

func TestGraphLint(t *testing.T) {
	cfg, s, _ := fixture(t)
	fs := Graph(cfg, s)
	if !has(fs, "flow-hop", "ship: billing → orders") {
		t.Errorf("undeclared flow hop not reported: %+v", fs)
	}
	if !has(fs, "contract-provider", "topic:nobody") {
		t.Errorf("contract without provider not reported")
	}
	if !has(fs, "code-path", "services/ghost") || !has(fs, "tech-unknown", "quantumdb") {
		t.Errorf("code path / unknown tech not reported: %+v", fs)
	}
	if has(fs, "flow-hop", "buy:") {
		t.Errorf("a declared publish/consume hop was reported")
	}
}

func TestCodeLint(t *testing.T) {
	cfg, s, f := fixture(t)
	fs := Code(cfg, s, f)
	if !has(fs, "code-import", "orders imports code of billing") {
		t.Errorf("cross-service import not reported: %+v", fs)
	}
	if !has(fs, "code-route-undeclared", "DELETE /orders/{}") && !has(fs, "code-route-undeclared", "DELETE /orders/{id}") {
		t.Errorf("undeclared route not reported: %+v", fs)
	}
	if has(fs, "code-route", "GET /orders") || has(fs, "code-route-undeclared", "healthz") {
		t.Errorf("declared or boring route reported: %+v", fs)
	}
	if !has(fs, "code-topic", "order.cancelled") || has(fs, "code-topic", "orders publishes topic:order.created") {
		t.Errorf("topic check wrong: %+v", fs)
	}
	if !has(fs, "code-topic-undeclared", "payment.done") {
		t.Errorf("undeclared consume not reported: %+v", fs)
	}
	if !has(fs, "code-tech", "redis") {
		t.Errorf("tech drift not reported: %+v", fs)
	}
	if !has(fs, "coverage", "shipping") || !has(fs, "coverage", "\"web\"") {
		t.Errorf("undocumented services not reported: %+v", fs)
	}
}
