package adr

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/abtinokhovat/crux/internal/catalog"
	"github.com/abtinokhovat/crux/internal/config"
)

func write(t *testing.T, root, rel, text string) {
	t.Helper()
	p := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func project(t *testing.T, files map[string]string) *Store {
	t.Helper()
	root := t.TempDir()
	for rel, text := range files {
		write(t, root, rel, text)
	}
	cfg, err := config.Load(root)
	if err != nil {
		t.Fatal(err)
	}
	return Load(cfg)
}

func linked(s *Store, from, typ, to string) *Link {
	for i, l := range s.Links {
		if l.From == from && l.Type == typ && l.To == to {
			return &s.Links[i]
		}
	}
	return nil
}

func TestParseSteps(t *testing.T) {
	cat := catalog.Builtin()
	steps := ParseSteps(`== order ==
place:  customer -> api : http post /orders
emit:   orders --> billing : event order.created
  ? declined -> failed
note: one transaction
billing -> psp: POST /v1/charges
// ignored
`, cat)
	if len(steps) != 3 {
		t.Fatalf("want 3 steps, got %+v", steps)
	}
	if s := steps[0]; s.ID != "place" || s.From != "customer" || s.To != "api" || s.Transport != "http" || s.Contract != "http:POST /orders" || s.Phase != "order" || s.Async {
		t.Fatalf("step 1: %+v", s)
	}
	if s := steps[1]; !s.Async || s.Transport != "topic" || s.Contract != "topic:order.created" || len(s.Branches) != 1 || s.Branches[0].To != "failed" || len(s.Notes) != 1 {
		t.Fatalf("step 2: %+v", s)
	}
	if s := steps[2]; s.ID != "s3" || s.Label != "POST /v1/charges" || s.Transport != "" {
		t.Fatalf("step 3: %+v", s)
	}
}

func TestContractID(t *testing.T) {
	cat := catalog.Builtin()
	for in, want := range map[string]string{"event: order.created": "topic:order.created", "rest:get /a/{id}": "http:GET /a/{id}", "rpc:x.v1.X/Do": "grpc:x.v1.X/Do"} {
		if id, _, _, ok := ContractID(cat, in); !ok || id != want {
			t.Errorf("%q → %q, want %q", in, id, want)
		}
	}
	if _, _, _, ok := ContractID(cat, "billing"); ok {
		t.Error("a bare id is not a contract")
	}
}

func TestElementGraph(t *testing.T) {
	s := project(t, map[string]string{
		"crux.config.yaml": "title: t\n",
		"docs/adr/0001-use-kafka.md": "---\ntitle: Use Kafka\nstatus: Accepted\ndate: 2026-01-01\ntags: [k]\n---\n## Decision\n```callout ok\nKafka.\n```\n",
		"services/crux.md": "---\ncrux: domain\nid: backend\n---\n# Backend\n",
		"services/orders/crux.md": "---\ncrux: service\ntech: [Go, PostgreSQL]\nexposes: [\"grpc:orders.v1.Orders/Create\"]\npublishes: [\"topic:order.created\"]\nwrites: [orders-db]\ndecided_by: [1]\n---\n# Orders\nSee [[billing]].\n",
		"services/orders/main.go": "package main\n",
		"services/orders/order.md": "---\ncrux: entity\n---\n# Order\n",
		"services/billing/crux.md": "---\ncrux: service\nconsumes: [\"topic:order.created\"]\n---\n# Billing\n",
		"services/billing/index.ts": "export {}\n",
		"infra/db.md": "---\ncrux: database\nid: orders-db\ntech: [postgres]\n---\n# Orders DB\n",
		"infra/kafka.md": "---\ncrux: broker\nid: kafka\n---\n# Kafka\n",
		"api/crux.md": "---\ncrux: service\ncalls: [\"orders via grpc:orders.v1.Orders/Create\"]\n---\n# API\n",
		"flows/checkout.md": "---\ncrux: flow\ntrigger: t\noutcome: o\n---\n# Checkout\n```steps\ncreate: api -> orders : grpc orders.v1.Orders/Create\nemit: orders --> billing : topic order.created\n  ? oops -> nowhere\n```\n",
		"notes/q.md": "---\ncrux: question\nid: retry\nraised_from: flow:checkout#emit\nblocks: [checkout]\n---\n# Retry?\n",
	})
	if len(s.Adrs) != 1 || s.ByID["0001"] == nil {
		t.Fatalf("adr not loaded: %+v", s.Adrs)
	}
	o := s.ByID["orders"]
	if o == nil || o.Kind != "service" || o.Parent != "backend" || len(o.Code) != 1 || o.Code[0] != "services/orders/**" {
		t.Fatalf("orders: %+v", o)
	}
	if o.Tech[0] != "go" || o.Tech[1] != "postgres" {
		t.Fatalf("tech ids: %v", o.Tech)
	}
	if s.ByID["backend"].Kind != "context" || s.ByID["orders-db"].Kind != "store" {
		t.Fatal("kind aliases")
	}
	if s.ByID["order"].Parent != "orders" {
		t.Fatalf("entity parent: %q", s.ByID["order"].Parent)
	}
	c := s.ByID["topic:order.created"]
	if c == nil || !c.Implied || c.Parent != "kafka" || c.Transport != "topic" {
		t.Fatalf("implied topic on the only broker: %+v", c)
	}
	if l := linked(s, "orders", "publishes", "billing"); l == nil || !l.Implied || l.Via != "topic:order.created" || l.Mode != "async" {
		t.Fatalf("derived publisher → consumer: %+v", l)
	}
	if linked(s, "api", "uses", "grpc:orders.v1.Orders/Create") == nil || linked(s, "orders", "writes", "orders-db") == nil {
		t.Fatal("uses / writes links")
	}
	if linked(s, "orders", "decided_by", "0001") == nil || linked(s, "orders", "mentions", "billing") == nil {
		t.Fatal("decided_by / wiki mention")
	}
	if linked(s, "retry", "blocks", "checkout") == nil || linked(s, "retry", "raised_from", "checkout") == nil {
		t.Fatal("question links")
	}
	f := s.ByID["checkout"]
	if f.Steps[0].FromID != "api" || f.Steps[1].ToID != "billing" {
		t.Fatalf("flow participants: %+v", f.Steps)
	}
	foundBranch := false
	for _, p := range s.Problems {
		if p.File == "flows/checkout.md" && p.Level == "warn" {
			foundBranch = true
		}
	}
	if !foundBranch {
		t.Fatalf("expected a problem for the unknown branch target: %+v", s.Problems)
	}
	a := s.Architecture
	if a == nil || a.Nodes["orders"] == nil || a.Nodes["orders"].Parent == nil || *a.Nodes["orders"].Parent != "backend" {
		t.Fatalf("map: %+v", a)
	}
	if a.Nodes["topic:order.created"] == nil || *a.Nodes["topic:order.created"].Parent != "kafka" {
		t.Fatal("topic box under the broker")
	}
	hasEdge := func(from, to string) bool {
		for _, e := range a.Edges {
			if e.From == from && e.To == to {
				return true
			}
		}
		return false
	}
	if !hasEdge("orders", "topic:order.created") || !hasEdge("topic:order.created", "billing") || !hasEdge("api", "orders") || !hasEdge("orders", "orders-db") {
		t.Fatalf("map edges: %+v", a.Edges)
	}
	if !contains(a.Nodes["orders"].Adrs, "0001") || !contains(s.ByID["0001"].Components, "orders") {
		t.Fatal("decision on the map box and component on the ADR")
	}
}

func TestDuplicateIDAndUnknownKind(t *testing.T) {
	s := project(t, map[string]string{
		"crux.config.yaml": "title: t\n",
		"a/x.md":           "---\ncrux: service\nid: same\n---\n# A\n",
		"b/x.md":           "---\ncrux: service\nid: same\n---\n# B\n",
		"c/x.md":           "---\ncrux: spaceship\n---\n# C\n",
	})
	dup, unknown := false, false
	for _, p := range s.Problems {
		dup = dup || (p.Level == "" && containsStr(p.Message, "duplicate id"))
		unknown = unknown || containsStr(p.Message, "not a known kind")
	}
	if !dup || !unknown {
		t.Fatalf("problems: %+v", s.Problems)
	}
}

func TestIgnoreAndHeader(t *testing.T) {
	s := project(t, map[string]string{
		"crux.config.yaml":           "title: t\nscan:\n  exclude: [secret]\n",
		".gitignore":                 "build-output/\n*.tmp.md\n",
		"build-output/x.md":          "---\ncrux: service\n---\n# Hidden\n",
		"secret/x.md":                "---\ncrux: service\n---\n# Hidden2\n",
		"node_modules/pkg/README.md": "---\ncrux: service\n---\n# Hidden3\n",
		"a.tmp.md":                   "---\ncrux: service\n---\n# Hidden4\n",
		"plain.md":                   "---\ntitle: no header\n---\n# Plain\n",
		"ok.md":                      "---\ntitle: x\ncrux: store\n---\n# Visible\n",
	})
	if len(s.Elements) != 1 || s.Elements[0].ID != "x" {
		t.Fatalf("elements: %d %+v", len(s.Elements), s.Elements)
	}
}

func containsStr(s, sub string) bool {
	return len(sub) == 0 || len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
