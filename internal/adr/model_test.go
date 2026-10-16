package adr

import "testing"

func TestParseFields(t *testing.T) {
	fs := ParseFields(`id          uuid      pk
customer_id uuid      fk customer 0..1
status      enum      pending | paid
lines       order-line[]  1..n
// ignored
`)
	if len(fs) != 4 {
		t.Fatalf("want 4 fields, got %+v", fs)
	}
	if !fs[0].PK || fs[1].FK != "customer" || fs[1].Card != "0..1" || len(fs[2].Enum) != 2 || fs[3].Type != "order-line[]" || fs[3].Card != "1..n" {
		t.Fatalf("fields: %+v", fs)
	}
}

func TestModelRelationsAndHomes(t *testing.T) {
	entity := func(id, fields string) string {
		return "---\ncrux: entity\nid: " + id + "\n---\n# " + id + "\n\n```entity\n" + fields + "\n```\n"
	}
	s := project(t, map[string]string{
		"crux.config.yaml":     "title: t\n",
		"orders/crux.md":       "---\ncrux: service\nwrites: [orders-db]\n---\n# Orders\n",
		"orders/order.md":      entity("order", "id uuid pk\nlines order-line[] 1..n\ncustomer customer"),
		"orders/order-line.md": entity("order-line", "order_id uuid fk order"),
		"orders/customer.md":   entity("customer", "id uuid pk"),
		"billing/crux.md":      "---\ncrux: service\nwrites: [billing-db, cache]\n---\n# Billing\n",
		"billing/payment.md":   entity("payment", "order_id uuid\nghost_id uuid fk ghost"),
		"billing/session.md":   "---\ncrux: entity\nid: session\nstored_in: cache\n---\n# session\n",
		"infra/orders-db.md":   "---\ncrux: store\n---\n# orders-db\n",
		"infra/billing-db.md":  "---\ncrux: store\n---\n# billing-db\n",
		"infra/cache.md":       "---\ncrux: cache\n---\n# cache\n",
	})
	if l := linked(s, "order", "has", "order-line"); l == nil || l.Card != "1..n" || l.Label != "lines" {
		t.Fatalf("order has order-line: %+v", l)
	}
	if l := linked(s, "order-line", "references", "order"); l == nil || l.Card != "1..1" {
		t.Fatalf("order-line references order (fk): %+v", l)
	}
	if l := linked(s, "order", "references", "customer"); l == nil {
		t.Fatal("type X → references X")
	}
	if l := linked(s, "payment", "references", "order"); l == nil || !l.Implied {
		t.Fatalf("order_id → references order, calculated from the name: %+v", l)
	}
	if o := s.ByID["order"]; o.Parent != "orders" || o.Store != "orders-db" || !o.StoreInferred {
		t.Fatalf("order home: parent %q store %q inferred %v", o.Parent, o.Store, o.StoreInferred)
	}
	if p := s.ByID["payment"]; p.Store != "billing-db" {
		t.Fatalf("payment: the owner's one store wins over its cache, got %q", p.Store)
	}
	if ss := s.ByID["session"]; ss.Store != "cache" || ss.StoreInferred {
		t.Fatalf("session: explicit stored_in, got %q inferred %v", ss.Store, ss.StoreInferred)
	}
	found := false
	for _, p := range s.Problems {
		if p.File == "billing/payment.md" && p.Level == "warn" {
			found = true
		}
	}
	if !found {
		t.Fatalf("fk to an unknown entity is a problem: %+v", s.Problems)
	}
}
