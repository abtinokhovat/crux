package code

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolve(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"svc/h.go":    "package svc\n\ntype Server struct{}\n\nfunc (s *Server) Create() {}\n\nfunc helper() {}\n",
		"web/app.ts":  "export class Billing {\n  async charge(id: string) {\n    if (id) {}\n  }\n}\nexport function refund() {}\n",
		"api.proto":   "service Orders {\n  rpc Create(Req) returns (Res);\n}\nmessage Req {}\n",
		"db/001.sql":  "CREATE TABLE IF NOT EXISTS orders (\n  id uuid primary key\n);\n",
		"jobs/run.py": "class Worker:\n    def run(self):\n        x = {}\n\ndef main():\n    pass\n",
	}
	for rel, text := range files {
		p := filepath.Join(root, rel)
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		_ = os.WriteFile(p, []byte(text), 0o644)
	}
	r := NewResolver(root)
	for ref, line := range map[string]int{
		"svc/h.go#Server.Create": 5, "svc/h.go#Create": 5, "svc/h.go#helper": 7,
		"web/app.ts#Billing.charge": 2, "web/app.ts#refund": 6,
		"api.proto#Orders.Create": 2, "api.proto#Req": 4,
		"db/001.sql#orders": 1, "jobs/run.py#Worker.run": 2, "jobs/run.py#main": 5,
		"svc/h.go:3": 3,
	} {
		if a := r.Resolve(ref); a.Err != "" || a.Line != line {
			t.Errorf("%s: got line %d err %q, want %d", ref, a.Line, a.Err, line)
		}
	}
	for _, ref := range []string{"svc/h.go#Nope", "svc/h.go:99", "missing.go#X", "README#X"} {
		if a := r.Resolve(ref); a.Err == "" {
			t.Errorf("%s: want an error", ref)
		}
	}
}
