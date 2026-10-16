package lint

// Gaps: what crux saw in the code but could not connect on its own. Each gap names its kind,
// the evidence and the fix; the skills (skills/crux/gaps.md) say, per kind, how an agent closes
// it. A gap closes in one of two ways: a config hint that makes the connection deterministic
// (preferred — crux then keeps it fresh), or a hand-written connection with an at: anchor that
// lint verifies.

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/abtinokhovat/crux/internal/adr"
	"github.com/abtinokhovat/crux/internal/config"
	"github.com/abtinokhovat/crux/internal/scan"
)

type Gap struct {
	Kind     string   `json:"kind"`
	Element  string   `json:"element,omitempty"`
	Subject  string   `json:"subject"` // what the gap is about: a topic, an env var, a host, a table, a step…
	Message  string   `json:"message"`
	Evidence []string `json:"evidence,omitempty"` // file:line in the code or the crux files
	Fix      string   `json:"fix"`
}

// GapKinds in the order they are worked: connections first (they feed flows), then the data
// model, then flows and anchors.
var GapKinds = []string{
	"wire-unresolved", "env-unmapped", "host-unmapped", "infra-unmodeled", "deployable-unmodeled",
	"topic-direction", "topic-no-consumer", "topic-no-publisher", "topic-no-broker",
	"table-no-entity", "entity-candidate", "entity-no-table", "entity-no-store",
	"contract-no-flow", "step-no-anchor", "edge-no-anchor", "anchor-broken",
}

var connEnvRe = regexp.MustCompile(`(?i)(_URL|_URI|_DSN|_HOST|_HOSTNAME|_ADDR|_ADDRESS|_ENDPOINT|_BROKERS?|_SERVERS?|_CONN(ECTION)?(_STRING)?)$|^(DATABASE|REDIS|KAFKA|AMQP|RABBIT(MQ)?|NATS|MONGO(DB)?|POSTGRES|PG|MYSQL|ELASTIC(SEARCH)?|S3|SQS|SNS)_`)

// Gaps runs after Derive and Merge: s holds declared and scanned connections.
func Gaps(cfg *config.Config, s *adr.Store, f *scan.Facts, d *Derived) []Gap {
	var out []Gap
	o := newOwners(s)
	n := d.names
	at := func(file string, line int) string {
		if line > 0 {
			return fmt.Sprintf("%s:%d", file, line)
		}
		return file
	}
	// manifests that point at a name crux cannot place
	type wireKey struct{ from, host string }
	wires := map[wireKey][]string{}
	var wireOrder []wireKey
	resolvedEnv := map[string]bool{} // env vars that became a connection
	for _, w := range f.Wires {
		from := n.deployable(w.From, w.FromDir)
		to := n.element(w.Host)
		if from != nil && len(to) > 0 {
			if w.Env != "" {
				resolvedEnv[w.Env] = true
			}
			continue
		}
		if from != nil && w.How == "env" && !n.known(w.Host) {
			continue // the value names something that is not a service here (a public host, a path)
		}
		k := wireKey{w.From, w.Host}
		if _, ok := wires[k]; !ok {
			wireOrder = append(wireOrder, k)
		}
		wires[k] = append(wires[k], at(w.File, w.Line))
	}
	for _, k := range wireOrder {
		from := n.deployable(k.from, "")
		el := ""
		if from != nil {
			el = from.ID
		}
		missing := k.host
		fix := fmt.Sprintf("crux scan.names hint in crux.config.yaml: scan: {names: {%s: <element id>}} — or create the element (crux new store|cache|broker|service %q)", k.host, k.host)
		if from == nil {
			missing = k.from
			fix = fmt.Sprintf("scan: {names: {%s: <element id>}} — or describe the deployable (crux new service %q)", k.from, k.from)
		}
		out = append(out, Gap{Kind: "wire-unresolved", Element: el, Subject: k.from + " → " + k.host, Message: fmt.Sprintf("a manifest connects %s to %s, but %q is no element crux knows", k.from, k.host, missing), Evidence: uniq(wires[k]), Fix: fix})
	}
	// env vars that look like connections but lead nowhere crux can read
	type envKey struct{ el, name string }
	envs := map[envKey][]string{}
	var envOrder []envKey
	addEnv := func(el, name, ev string) {
		if !connEnvRe.MatchString(name) || resolvedEnv[name] || cfg.Scan.Env[name] != "" {
			return
		}
		k := envKey{el, name}
		if _, ok := envs[k]; !ok {
			envOrder = append(envOrder, k)
		}
		envs[k] = append(envs[k], ev)
	}
	for _, e := range f.Env {
		addEnv(o.of(e.Mod), e.Name, at(e.File, e.Line))
	}
	for _, u := range f.Unwired {
		el := ""
		if x := n.deployable(u.From, ""); x != nil {
			el = x.ID
		}
		addEnv(el, u.Env, at(u.File, u.Line))
	}
	for _, k := range envOrder {
		out = append(out, Gap{Kind: "env-unmapped", Element: k.el, Subject: k.name, Message: fmt.Sprintf("%s reads %s, whose value crux cannot see (a secret, an interpolation or unset)", firstNonEmpty(k.el, "code"), k.name), Evidence: first(uniq(envs[k]), 3), Fix: fmt.Sprintf("find what %s points at (deploy config, .env.example, secret names, the code that dials it), then add to crux.config.yaml: scan: {env: {%s: <element id>}}", k.name, k.name)})
	}
	// hosts named in code that are no element
	type hostKey struct{ el, host string }
	hosts := map[hostKey][]string{}
	var hostOrder []hostKey
	for _, h := range f.Hosts {
		if len(n.element(h.Host)) > 0 || !strings.Contains(h.Host, ".") && !n.known(h.Host) {
			continue
		}
		k := hostKey{o.of(h.Mod), h.Host}
		if _, ok := hosts[k]; !ok {
			hostOrder = append(hostOrder, k)
		}
		hosts[k] = append(hosts[k], at(h.File, h.Line))
	}
	for _, k := range hostOrder {
		out = append(out, Gap{Kind: "host-unmapped", Element: k.el, Subject: k.host, Message: fmt.Sprintf("%s calls %s, which no element answers for", firstNonEmpty(k.el, "code"), k.host), Evidence: first(uniq(hosts[k]), 3), Fix: fmt.Sprintf("if it is a third party: an external element with hosts: [%s]; if it is ours: scan: {names: {%s: <element id>}}", k.host, k.host)})
	}
	// infrastructure and deployables in manifests with no element
	for _, x := range f.Infra {
		if len(n.element(x.Name)) == 0 {
			out = append(out, Gap{Kind: "infra-unmodeled", Subject: x.Name, Message: fmt.Sprintf("%s %s (%s) runs in %s but no element describes it", x.Kind, x.Name, firstNonEmpty(x.Tech, x.Image), x.File), Evidence: []string{x.File}, Fix: fmt.Sprintf("crux new %s %q --tech %s — or scan: {names: {%s: <element id>}} if it is an element under another name", x.Kind, x.Name, x.Tech, x.Name)})
		}
	}
	for _, c := range f.Services {
		if c.Kind == "app" && c.Lang == "go" {
			continue
		}
		if o.of(c.Dir) == "" && len(n.element(c.Name)) == 0 {
			out = append(out, Gap{Kind: "deployable-unmodeled", Subject: c.Name, Message: fmt.Sprintf("%s %s at %s has no element", c.Kind, c.Name, c.Dir), Evidence: first(c.Evidence, 2), Fix: fmt.Sprintf("crux new %s %q --dir %s", c.Kind, c.Name, c.Dir)})
		}
	}
	// topics whose direction is a guess, or whose other side is missing
	sure := map[string]bool{}
	for _, t := range f.Topics {
		if !t.Guess && t.Dir != "" {
			sure[t.Name+"|"+t.Mod] = true
		}
	}
	type topicKey struct{ el, name string }
	guessed := map[topicKey][]string{}
	var guessOrder []topicKey
	for _, t := range f.Topics {
		if sure[t.Name+"|"+t.Mod] || !(t.Guess || t.Dir == "") {
			continue
		}
		k := topicKey{o.of(t.Mod), t.Name}
		if k.el != "" && (declaresTopic(s, k.el, "publishes", t.Name) || declaresTopic(s, k.el, "consumes", t.Name)) {
			continue
		}
		if _, ok := guessed[k]; !ok {
			guessOrder = append(guessOrder, k)
		}
		guessed[k] = append(guessed[k], at(t.File, t.Line))
	}
	for _, k := range guessOrder {
		out = append(out, Gap{Kind: "topic-direction", Element: k.el, Subject: k.name, Message: fmt.Sprintf("%s names %s, but crux cannot tell whether it publishes or consumes it", firstNonEmpty(k.el, "code"), k.name), Evidence: first(uniq(guessed[k]), 3), Fix: fmt.Sprintf("read the call; add publishes: or consumes: [{to: \"topic:%s\", at: <file#Symbol>}] to %s — or teach crux the wrapper once: lint.publishes / lint.consumes", k.name, firstNonEmpty(k.el, "the element"))})
	}
	for _, c := range s.Elements {
		if c.Kind != "contract" || (c.Transport != "topic" && c.Transport != "queue") {
			continue
		}
		var pubs, subs []string
		for _, l := range s.Links {
			if l.To == c.ID && l.Type == "publishes" {
				pubs = append(pubs, l.From)
			}
			if l.To == c.ID && l.Type == "consumes" {
				subs = append(subs, l.From)
			}
		}
		if len(pubs) > 0 && len(subs) == 0 {
			out = append(out, Gap{Kind: "topic-no-consumer", Element: pubs[0], Subject: c.ID, Message: fmt.Sprintf("%s publishes %s; nobody here consumes it", strings.Join(uniq(pubs), ", "), c.Name), Evidence: linkAts(s, c.ID, "publishes"), Fix: "find the consumer (another repo, a wrapper crux cannot read, or none): add consumes: with at:, or an external element that consumes it, or note it is unconsumed"})
		}
		if len(subs) > 0 && len(pubs) == 0 {
			out = append(out, Gap{Kind: "topic-no-publisher", Element: subs[0], Subject: c.ID, Message: fmt.Sprintf("%s consumes %s; nobody here publishes it", strings.Join(uniq(subs), ", "), c.Name), Evidence: linkAts(s, c.ID, "consumes"), Fix: "find the publisher: add publishes: with at: to it, or an external element that publishes it"})
		}
	}
	// topics with no broker, entities with no store: data with no home in the infrastructure
	for _, c := range s.Elements {
		if c.Kind == "contract" && (c.Transport == "topic" || c.Transport == "queue") && c.Parent == "" {
			var users []string
			for _, l := range s.Links {
				if l.To == c.ID && (l.Type == "publishes" || l.Type == "consumes") {
					users = append(users, l.From)
				}
			}
			if len(users) == 0 {
				continue
			}
			out = append(out, Gap{Kind: "topic-no-broker", Element: users[0], Subject: c.ID, Message: fmt.Sprintf("%s has no broker: its publishers and consumers (%s) connect to none, or to several", c.ID, strings.Join(uniq(users), ", ")), Evidence: linkAts(s, c.ID, ""), Fix: fmt.Sprintf("a contract file with on: <broker id> (crux new contract %q), or connect the publisher to its broker (depends_on, or the scan.env hint for its broker URL)", c.ID)})
		}
	}
	for _, e := range s.Elements {
		if e.Kind == "entity" && e.Store == "" && !planned(e) {
			out = append(out, Gap{Kind: "entity-no-store", Element: e.ID, Subject: e.ID, Message: fmt.Sprintf("entity %s has no store: its owner writes none, or several", e.ID), Evidence: []string{e.File}, Fix: "stored_in: <store id> on the entity — or connect its owner to its store (writes:, or the scan.env hint for the database URL)"})
		}
	}
	// tables and entities
	for _, t := range f.Tables {
		if _, ok := d.Tables[t.Name]; ok || strings.HasPrefix(t.Name, "schema_") || strings.Contains(t.Name, "migration") {
			continue
		}
		el := o.of(dirOf(t.File))
		out = append(out, Gap{Kind: "table-no-entity", Element: el, Subject: t.Name, Message: fmt.Sprintf("table %s (%d columns) has no entity", t.Name, len(t.Columns)), Evidence: []string{at(t.File, t.Line)}, Fix: fmt.Sprintf("crux new entity %q --in %s with a ```entity block from the columns, table: %s — or table: on the entity it is", t.Name, firstNonEmpty(el, "<owner>"), t.Name)})
	}
	// record types that look like entities and that no entity element covers: by an at: that
	// names the type, or by its table
	covered := map[string]bool{}
	for _, e := range s.Elements {
		if e.Kind != "entity" {
			continue
		}
		for _, a := range e.At {
			covered[a] = true
		}
		if e.Table != "" {
			covered["table:"+e.Table] = true
		}
	}
	for _, t := range d.Tables {
		covered["entity:"+t] = true
	}
	for _, c := range f.Entities {
		if covered[c.File+"#"+c.Name] || (c.Table != "" && covered["table:"+c.Table]) {
			continue
		}
		if _, ok := d.Tables[c.Table]; ok && c.Table != "" {
			continue
		}
		el := o.of(dirOf(c.File))
		out = append(out, Gap{Kind: "entity-candidate", Element: el, Subject: c.Name, Message: fmt.Sprintf("%s looks like an entity (%s) and no entity covers it", c.Name, strings.Join(c.Why, "; ")), Evidence: []string{at(c.File, c.Line)}, Fix: fmt.Sprintf("if it is a domain entity: crux new entity %q --in %s with at: %s#%s and an ```entity block of the fields that carry meaning — else lint.ignore: [entity-candidate:%s]", c.Name, firstNonEmpty(el, "<owner>"), c.File, c.Name, c.Name)})
	}
	if len(f.Tables) > 0 {
		for _, e := range s.Elements {
			if e.Kind != "entity" || e.Origin == "scan" {
				continue
			}
			found := false
			for _, ent := range d.Tables {
				found = found || ent == e.ID
			}
			if !found && len(e.At) == 0 {
				out = append(out, Gap{Kind: "entity-no-table", Element: e.ID, Subject: e.ID, Message: fmt.Sprintf("entity %s matches no table in the migrations and has no at:", e.ID), Evidence: []string{e.File}, Fix: "table: <name> if it is a table under another name; else at: the type that holds it (path#Type)"})
			}
		}
	}
	// contracts no flow walks
	inFlow := map[string]bool{}
	for _, e := range s.Elements {
		for _, st := range e.Steps {
			inFlow[st.Contract] = true
		}
	}
	for _, c := range s.Elements {
		if c.Kind != "contract" || inFlow[c.ID] || (c.Transport != "http" && c.Transport != "grpc" && c.Transport != "topic" && c.Transport != "queue") {
			continue
		}
		var by []string
		for _, l := range s.Links {
			if l.To == c.ID && (l.Type == "exposes" || l.Type == "publishes") {
				by = append(by, l.From)
			}
		}
		if len(by) == 0 {
			continue
		}
		out = append(out, Gap{Kind: "contract-no-flow", Element: by[0], Subject: c.ID, Message: fmt.Sprintf("%s (from %s) is in no flow", c.ID, strings.Join(uniq(by), ", ")), Evidence: linkAts(s, c.ID, ""), Fix: "write or extend the business flow that uses it (crux new flow), one step per hop, each with @ <file#Symbol>"})
	}
	// flow steps and declared connections no code backs
	for _, e := range s.Elements {
		if planned(e) {
			continue
		}
		for _, st := range e.Steps {
			if st.At == "" && st.FromID != "" && st.ToID != "" && !planned(s.ByID[st.FromID]) && !planned(s.ByID[st.ToID]) {
				out = append(out, Gap{Kind: "step-no-anchor", Element: e.ID, Subject: e.ID + "#" + st.ID, Message: fmt.Sprintf("flow %s step %s (%s → %s) points at no code", e.ID, st.ID, st.FromID, st.ToID), Evidence: []string{at(e.File, st.Line)}, Fix: "end the step line with @ <file#Symbol> of the code that performs it (the handler, the publish call)"})
			}
		}
	}
	for _, l := range s.Links {
		if l.Implied || l.Source != "" || l.At != "" || !anchorable[l.Type] {
			continue
		}
		from := s.ByID[l.From]
		if from == nil || !adr.IsStructural(from.Kind) || from.Kind == "actor" || from.Kind == "external" || len(from.Code) == 0 || planned(from) || planned(s.ByID[l.To]) {
			continue
		}
		out = append(out, Gap{Kind: "edge-no-anchor", Element: l.From, Subject: l.Type + " " + l.To, Message: fmt.Sprintf("%s %s %s — declared, but crux did not find it in the code and no at: says where", l.From, l.Type, l.To), Evidence: []string{from.File}, Fix: fmt.Sprintf("find the code; write it as {to: %s, at: <file#Symbol>} — or remove it if the code no longer does this", l.To)})
	}
	for _, a := range s.Anchors {
		if a.Err != "" {
			out = append(out, Gap{Kind: "anchor-broken", Element: a.Element, Subject: a.Ref, Message: fmt.Sprintf("%s %s: anchor %s — %s", a.Element, a.Where, a.Ref, a.Err), Evidence: []string{at(a.Doc, a.DocLine)}, Fix: "point it at the symbol that does this now, or remove it"})
		}
	}
	rank := map[string]int{}
	for i, k := range GapKinds {
		rank[k] = i
	}
	sort.SliceStable(out, func(i, j int) bool { return rank[out[i].Kind] < rank[out[j].Kind] })
	if len(cfg.Lint.Ignore) > 0 {
		kept := out[:0]
		for _, g := range out {
			if !contains(cfg.Lint.Ignore, g.Kind) && !contains(cfg.Lint.Ignore, g.Kind+":"+g.Subject) {
				kept = append(kept, g)
			}
		}
		out = kept
	}
	return out
}

// planned: designed, not built yet — there is no code to anchor to.
func planned(d *adr.Doc) bool {
	if d == nil {
		return false
	}
	st := strings.ToLower(d.Status)
	return st == "planned" || st == "proposed" || st == "draft" || st == "designed"
}

var anchorable = map[string]bool{"calls": true, "publishes": true, "consumes": true, "reads": true, "writes": true, "exposes": true, "uses": true}

// known: the name is something running here (a compose service, a workload, a Kubernetes Service).
func (n *names) known(host string) bool {
	host = scan.NormHost(host)
	if _, ok := n.alias[host]; ok {
		return true
	}
	for _, c := range n.f.Services {
		if c.Name == host {
			return true
		}
	}
	for _, x := range n.f.Infra {
		if x.Name == host {
			return true
		}
	}
	for _, k := range n.f.K8sServices {
		if k.Name == host {
			return true
		}
	}
	return false
}

func linkAts(s *adr.Store, to, typ string) []string {
	var out []string
	for _, l := range s.Links {
		if l.To == to && (typ == "" || l.Type == typ) && l.At != "" {
			out = append(out, l.At)
		}
	}
	return first(uniq(out), 3)
}

func dirOf(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[:i]
	}
	return "."
}
