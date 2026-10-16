package index

import "testing"

func rulesT(t *testing.T) []Rule {
	t.Helper()
	rs, err := DefaultRules()
	if err != nil {
		t.Fatal(err)
	}
	return rs
}

func TestGRPCClientService(t *testing.T) {
	p := &Program{
		Units: []Unit{{ID: "app", Dir: "cmd/app", Main: true}},
		Funcs: []Func{{ID: "app.main", Unit: "app", File: "cmd/app/main.go", Line: 3}},
		Calls: []Call{{Caller: "app.main", Callee: "gen/orders.NewOrdersClient", Unit: "app", File: "cmd/app/main.go", Line: 5,
			Args: []Value{{Kind: "dynamic", Type: "*google.golang.org/grpc.ClientConn"}}}},
	}
	res := Interpret(p, rulesT(t))
	if len(res.Obs) != 1 || res.Obs[0].Service != "Orders" || len(res.Obs[0].Entries) != 1 {
		t.Fatalf("got %+v", res.Obs)
	}
}

func TestWrapperFollowsParameter(t *testing.T) {
	p := &Program{
		Units: []Unit{{ID: "svc", Dir: "cmd/svc", Main: true}, {ID: "lib", Dir: "pkg/lib"}},
		Funcs: []Func{{ID: "svc.main", Unit: "svc"}, {ID: "lib.NewPub", Unit: "lib", File: "pkg/lib/pub.go", Line: 9}},
		Calls: []Call{
			{Caller: "lib.NewPub", Callee: "github.com/rabbitmq/amqp091-go.Channel.Publish", Unit: "lib", File: "pkg/lib/pub.go", Line: 12,
				Args: []Value{{Kind: "param", Param: 1}, {Kind: "dynamic", Str: "key"}}},
			{Caller: "svc.main", Callee: "lib.NewPub", Unit: "svc", File: "cmd/svc/main.go", Line: 7,
				Args: []Value{{Kind: "dynamic"}, {Kind: "const", Str: "orders"}}},
		},
	}
	res := Interpret(p, rulesT(t))
	if len(res.Obs) != 1 {
		t.Fatalf("got %+v", res.Obs)
	}
	o := res.Obs[0]
	if !o.Name.Exact() || o.Name.Str != "orders" || o.File != "cmd/svc/main.go" || len(o.Via) != 1 || len(o.Entries) != 1 {
		t.Fatalf("got %+v", o)
	}
}

func TestNameFlowsThroughStructField(t *testing.T) {
	p := &Program{
		Units: []Unit{{ID: "svc", Dir: "cmd/svc", Main: true}, {ID: "lib", Dir: "pkg/lib"}},
		Funcs: []Func{{ID: "svc.main", Unit: "svc"}, {ID: "lib.NewPub", Unit: "lib"}, {ID: "lib.Cfg.Send", Unit: "lib"}},
		Calls: []Call{
			{Caller: "lib.NewPub", Callee: "lib.Cfg.exchange=", Unit: "lib", File: "pkg/lib/pub.go", Line: 5, Args: []Value{{Kind: "param", Param: 0}}},
			{Caller: "lib.Cfg.Send", Callee: "github.com/rabbitmq/amqp091-go.Channel.Publish", Unit: "lib", File: "pkg/lib/pub.go", Line: 20,
				Args: []Value{{Kind: "field", Str: "lib.Cfg.exchange"}, {Kind: "dynamic"}}},
			{Caller: "svc.main", Callee: "lib.NewPub", Unit: "svc", File: "cmd/svc/main.go", Line: 7, Args: []Value{{Kind: "const", Str: "billing"}}},
		},
	}
	res := Interpret(p, rulesT(t))
	if len(res.Obs) != 1 || res.Obs[0].Name.Str != "billing" || len(res.Obs[0].Entries) != 1 {
		t.Fatalf("got %+v", res.Obs)
	}
}

func TestRangeOverParameterNamesEachElement(t *testing.T) {
	p := &Program{
		Units: []Unit{{ID: "svc", Dir: "cmd/svc", Main: true}, {ID: "lib", Dir: "pkg/lib"}},
		Funcs: []Func{{ID: "svc.main", Unit: "svc"}, {ID: "lib.Make", Unit: "lib"}},
		Calls: []Call{
			{Caller: "lib.Make", Callee: "github.com/rabbitmq/amqp091-go.Channel.Publish", Unit: "lib", File: "pkg/lib/m.go", Line: 8,
				Args: []Value{{Kind: "param", Param: 0, Elem: true}}},
			{Caller: "svc.main", Callee: "lib.Make", Unit: "svc", File: "cmd/svc/main.go", Line: 7,
				Args: []Value{{Kind: "list", Items: []Value{{Kind: "const", Str: "a"}, {Kind: "const", Str: "b"}}}}},
		},
	}
	res := Interpret(p, rulesT(t))
	if len(res.Obs) != 2 || res.Obs[0].Name.Str != "a" || res.Obs[1].Name.Str != "b" {
		t.Fatalf("got %+v", res.Obs)
	}
}

func TestCandidatesScoreStoredAndModelTypes(t *testing.T) {
	p := &Program{Types: []Type{
		{ID: "svc/model.Order", File: "svc/model/order.go", Line: 10, Fields: []Field{{Name: "ID", Type: "uint", Tag: `gorm:"primaryKey"`}, {Name: "Total", Type: "int64"}}},
		{ID: "svc/api.CreateOrderRequest", File: "svc/api/order.go", Fields: []Field{{Name: "ID", Type: "uint"}, {Name: "Total", Type: "int64"}}},
		{ID: "svc/util.Point", File: "svc/util/point.go", Fields: []Field{{Name: "X", Type: "int"}, {Name: "Y", Type: "int"}}},
		{ID: "svc/db.Refund", File: "svc/db/refund.go", Table: "refunds", Fields: []Field{{Name: "Amount", Type: "int64"}, {Name: "State", Type: "string"}}},
	}}
	got := Candidates(p)
	if len(got) != 2 || got[0].Name != "Order" || got[1].Name != "Refund" || got[1].Table != "refunds" {
		t.Fatalf("got %+v", got)
	}
}
