package index

import (
	"sort"
	"strings"
)

// Obs is one thing the code does that a rule recognizes: publishes to a topic, serves a route,
// opens a gRPC client, queries a store. Name is as exact as the analyzer could make it.
type Obs struct {
	Rule    string   `json:"rule"`
	Callee  string   `json:"callee"`
	Role    string   `json:"role"`
	Kind    string   `json:"kind,omitempty"`
	Tech    string   `json:"tech,omitempty"`
	Name    Value    `json:"name"`
	Key     *Value   `json:"key,omitempty"`
	Service string   `json:"service,omitempty"`
	Method  string   `json:"method,omitempty"`
	Unit    string   `json:"unit"`
	File    string   `json:"file"`
	Line    int      `json:"line"`
	Func    string   `json:"func"`
	Via     []string `json:"via,omitempty"`     // wrapper functions the name was followed through, innermost first
	Entries []string `json:"entries,omitempty"` // main units whose call graph reaches this
}

// Result is what Interpret reports.
type Result struct {
	Obs []Obs `json:"obs"`
	// Unattributed: observations no entry point reaches by static calls (interface dispatch,
	// reflection, goroutines started through function values). Reported, never dropped.
	Unattributed int `json:"unattributed"`
}

type wrapper struct {
	rule  *Rule
	param int
	via   []string
	key   *Value
}

// Interpret turns calls into observations. A call whose name comes from the caller's own
// parameter makes the caller a wrapper: its callers' arguments are followed, up to maxDepth
// levels, so `queue.NewPublisher(cfg, "orders")` names the exchange even though the broker call
// sits in a shared package.
func Interpret(p *Program, rules []Rule) *Result {
	const maxDepth = 6
	funcs := map[string]*Func{}
	for i := range p.Funcs {
		funcs[p.Funcs[i].ID] = &p.Funcs[i]
	}
	byCallee := map[string][]*Call{}
	for i := range p.Calls {
		byCallee[p.Calls[i].Callee] = append(byCallee[p.Calls[i].Callee], &p.Calls[i])
	}

	// writes to struct fields ("<unit>.<Type>.<field>="): a name read from a field is whatever
	// was stored in it, so the broker call in a shared package is named by the constructor's caller
	stores := map[string][]*Call{}
	for i := range p.Calls {
		if c := &p.Calls[i]; strings.HasSuffix(c.Callee, "=") && len(c.Args) == 1 {
			stores[strings.TrimSuffix(c.Callee, "=")] = append(stores[strings.TrimSuffix(c.Callee, "=")], c)
		}
	}

	var obs []Obs
	wrappers := map[string][]wrapper{}
	type seenKey struct {
		fn, rule string
		param    int
	}
	seen := map[seenKey]bool{}

	// emit evaluates a matched call (or a wrapper call) and either reports it or, when the name
	// is a parameter of the enclosing function, registers that function as a wrapper.
	var emit func(c *Call, r *Rule, name Value, key *Value, via []string)
	emit = func(c *Call, r *Rule, name Value, key *Value, via []string) {
		if name.Kind == "list" { // one of several: each item is a separate name
			for _, it := range name.Items {
				emit(c, r, it, key, via)
			}
			return
		}
		if name.Kind == "field" && len(via) < maxDepth {
			if ss := stores[name.Str]; len(ss) > 0 {
				v := append(append([]string{}, via...), name.Str)
				for _, s := range ss {
					emit(s, r, s.Args[0], key, v)
				}
				return
			}
		}
		if name.Kind == "param" && funcs[c.Caller] != nil && len(via) < maxDepth {
			k := seenKey{c.Caller, r.ID, name.Param}
			if !seen[k] {
				seen[k] = true
				w := wrapper{rule: r, param: name.Param, via: append(append([]string{}, via...), c.Caller), key: key}
				wrappers[c.Caller] = append(wrappers[c.Caller], w)
				for _, up := range byCallee[c.Caller] {
					if name.Param >= len(up.Args) {
						continue
					}
					arg := up.Args[name.Param]
					if name.Elem && arg.Kind == "param" {
						arg.Elem = true // a slice handed on: still "each element"
					} else if name.Elem && arg.Kind != "list" {
						arg = Value{Kind: "dynamic", Str: "elements of " + arg.Str}
					}
					emit(up, r, arg, key, w.via)
				}
			}
			return
		}
		o := Obs{Rule: r.ID, Callee: c.Callee, Role: r.Role, Kind: r.Kind, Tech: r.Tech, Name: name, Key: key,
			Unit: c.Unit, File: c.File, Line: c.Line, Func: c.Caller, Via: via}
		if r.svc != nil {
			last := c.Callee[strings.LastIndex(c.Callee, ".")+1:]
			if m := r.svc.FindStringSubmatch(last); len(m) > 1 {
				o.Service = m[1]
			}
		}
		switch r.Method {
		case "":
		case "callee":
			o.Method = strings.ToUpper(c.Callee[strings.LastIndex(c.Callee, ".")+1:])
		default:
			o.Method = r.Method
		}
		obs = append(obs, o)
	}

	for i := range p.Calls {
		c := &p.Calls[i]
		if c.Ref {
			continue
		}
		for j := range rules {
			r := &rules[j]
			if !r.matches(c) {
				continue
			}
			var name Value
			switch {
			case r.Field != "":
				name = c.Fields[r.Field]
				if name.Kind == "" {
					continue // a literal that does not set the field names nothing
				}
			case r.Name != nil:
				if *r.Name >= len(c.Args) {
					continue
				}
				name = c.Args[*r.Name]
			}
			var key *Value
			if r.Key != nil && *r.Key < len(c.Args) {
				k := c.Args[*r.Key]
				key = &k
			}
			emit(c, r, name, key, nil)
			break
		}
	}
	// a wrapper nobody calls with a known name: still a fact (it is reached from somewhere)
	for fn, ws := range wrappers {
		for _, w := range ws {
			if len(byCallee[fn]) == 0 {
				f := funcs[fn]
				o := Obs{Rule: w.rule.ID, Role: w.rule.Role, Kind: w.rule.Kind, Tech: w.rule.Tech,
					Name: Value{Kind: "dynamic", Str: "parameter " + itoa(w.param) + " of " + fn}, Unit: f.Unit, File: f.File, Line: f.Line, Func: fn, Via: w.via}
				obs = append(obs, o)
			}
		}
	}

	attribute(p, funcs, obs)
	res := &Result{Obs: obs}
	for _, o := range obs {
		if len(o.Entries) == 0 {
			res.Unattributed++
		}
	}
	sort.SliceStable(res.Obs, func(i, j int) bool {
		a, b := res.Obs[i], res.Obs[j]
		if a.File != b.File {
			return a.File < b.File
		}
		return a.Line < b.Line
	})
	return res
}

// attribute fills Obs.Entries: the main units from which the enclosing function is reachable.
func attribute(p *Program, funcs map[string]*Func, obs []Obs) {
	edges := map[string][]string{}
	unitOf := map[string]string{}
	for _, f := range p.Funcs {
		unitOf[f.ID] = f.Unit
	}
	for _, c := range p.Calls {
		edges[c.Caller] = append(edges[c.Caller], c.Callee)
	}
	reach := map[string]map[string]bool{}
	for _, u := range p.Units {
		if !u.Main {
			continue
		}
		seen := map[string]bool{}
		queue := []string{u.ID + ".main", u.ID + ".init"}
		for len(queue) > 0 {
			f := queue[0]
			queue = queue[1:]
			if seen[f] {
				continue
			}
			seen[f] = true
			if un := unitOf[f]; un != "" && !seen[un+".init"] {
				queue = append(queue, un+".init") // package-level initializers run with the package
			}
			queue = append(queue, edges[f]...)
		}
		reach[u.ID] = seen
	}
	var mains []string
	for id := range reach {
		mains = append(mains, id)
	}
	sort.Strings(mains)
	for i := range obs {
		for _, m := range mains {
			if reach[m][obs[i].Func] {
				obs[i].Entries = append(obs[i].Entries, m)
			}
		}
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for ; n > 0; n /= 10 {
		b = append([]byte{byte('0' + n%10)}, b...)
	}
	return string(b)
}
