package scan

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type absRoot string

func (r absRoot) Abs(p string) string { return filepath.Join(string(r), p) }

func TestHostsIn(t *testing.T) {
	for in, want := range map[string][]string{
		"postgres://app:pw@orders-db:5432/orders":     {"orders-db"},
		"kafka-1:9092,kafka-2:9092":                   {"kafka-1", "kafka-2"},
		"redis":                                       {"redis"},
		"http://orders.prod.svc.cluster.local:8080/x": {"orders"},
		"some words here":                             nil,
	} {
		if got := HostsIn(in); !reflect.DeepEqual(got, want) && !(len(got) == 0 && len(want) == 0) {
			t.Errorf("HostsIn(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestMigrationTables(t *testing.T) {
	root := t.TempDir()
	write := func(rel, text string) {
		p := filepath.Join(root, rel)
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		_ = os.WriteFile(p, []byte(text), 0o644)
	}
	write("db/001.sql", `CREATE TABLE orders (
  id uuid PRIMARY KEY, -- the id
  total numeric(12, 2),
  CONSTRAINT x CHECK (total > 0)
);
CREATE TABLE IF NOT EXISTS public.order_lines (id uuid, order_id uuid REFERENCES orders(id));
CREATE TABLE tmp (id int);
-- +goose Down
DROP TABLE orders;
`)
	write("db/002.sql", "ALTER TABLE orders ADD COLUMN status text;\nALTER TABLE order_lines ADD CONSTRAINT fk FOREIGN KEY (order_id) REFERENCES orders(id);\nDROP TABLE tmp;\nALTER TABLE orders DROP COLUMN total;\n")
	f := &Facts{}
	migrationTables(absRoot(root), []string{"db/001.sql", "db/002.sql"}, f)
	if len(f.Tables) != 2 {
		t.Fatalf("tables = %+v", f.Tables)
	}
	o := f.Tables[0]
	if o.Name != "orders" || len(o.Columns) != 2 || o.Columns[1].Name != "status" || o.Line != 1 {
		t.Errorf("orders = %+v", o)
	}
	l := f.Tables[1]
	if l.Name != "order_lines" || l.Columns[1].Ref != "orders" || l.Line != 6 {
		t.Errorf("order_lines = %+v", l)
	}
}

func TestOwnerMatch(t *testing.T) {
	for _, c := range []struct {
		pat, dir string
		want     bool
	}{
		{"*", "a/b", true}, {"/services/orders/", "services/orders", true}, {"/services/orders/", "services/orders/x", true},
		{"orders", "services/orders", true}, {"/services/", "lib/x", false}, {"services/*/api", "services/x/api", true},
	} {
		if got := ownerMatch(c.pat, c.dir); got != c.want {
			t.Errorf("ownerMatch(%q, %q) = %v", c.pat, c.dir, got)
		}
	}
}
