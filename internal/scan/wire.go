package scan

// Wiring facts: what points at what. Manifests say which deployable talks to which host
// (compose depends_on and environment, Kubernetes env), code says which env vars it reads and
// which hosts it names, migrations say which tables exist, protos say which services and
// messages exist, CODEOWNERS says who owns which folder. All of it is read, never guessed:
// lint.Derive turns these facts into connections only where the match is exact.

import (
	"bufio"
	"os"
	"path"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// EnvUse: the code reads an environment variable.
type EnvUse struct {
	Name string `json:"name"`
	Mod  string `json:"module"`
	File string `json:"file"`
	Line int    `json:"line"`
}

// HostUse: the code names a host in a string literal (a URL or host:port).
type HostUse struct {
	Host string `json:"host"`
	Text string `json:"text"`
	Mod  string `json:"module"`
	File string `json:"file"`
	Line int    `json:"line"`
}

// Client: the code builds a gRPC client for a service (NewOrdersClient → Orders).
type Client struct {
	Service string `json:"service"`
	Mod     string `json:"module"`
	File    string `json:"file"`
	Line    int    `json:"line"`
}

// Wire: a manifest connects a deployable to a host.
type Wire struct {
	From    string `json:"from"`              // the deployable's name in the manifest
	FromDir string `json:"fromDir,omitempty"` // its code folder, when built from source
	Host    string `json:"host"`
	How     string `json:"how"` // depends_on | env | link
	Env     string `json:"env,omitempty"`
	File    string `json:"file"`
	Line    int    `json:"line,omitempty"`
}

// Unwired: an env var a manifest sets from somewhere crux cannot read (a secret, a config map).
type Unwired struct {
	From string `json:"from"`
	Env  string `json:"env"`
	File string `json:"file"`
	Line int    `json:"line,omitempty"`
}

// K8sService routes a name to the workloads its selector matches.
type K8sService struct {
	Name     string            `json:"name"`
	Selector map[string]string `json:"selector"`
	File     string            `json:"file"`
}

type IngressRule struct {
	Host    string `json:"host,omitempty"`
	Path    string `json:"path"`
	Service string `json:"service"`
	File    string `json:"file"`
	Line    int    `json:"line,omitempty"`
}

type Table struct {
	Name    string   `json:"name"`
	Columns []Column `json:"columns"`
	File    string   `json:"file"`
	Line    int      `json:"line"`
}

type Column struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Ref  string `json:"ref,omitempty"` // the table a foreign key points at
}

type ProtoService struct {
	Package string     `json:"package,omitempty"`
	Name    string     `json:"name"`
	Methods []ProtoRPC `json:"methods"`
	File    string     `json:"file"`
	Line    int        `json:"line"`
}

type ProtoRPC struct {
	Name string `json:"name"`
	In   string `json:"in"`
	Out  string `json:"out"`
	Line int    `json:"line"`
}

type ProtoMessage struct {
	Package string   `json:"package,omitempty"`
	Name    string   `json:"name"`
	Fields  []string `json:"fields"`
	File    string   `json:"file"`
	Line    int      `json:"line"`
}

type OwnerRule struct {
	Pattern string   `json:"pattern"`
	Owners  []string `json:"owners"`
	File    string   `json:"file"`
	Line    int      `json:"line"`
}

// ── hosts ─────────────────────────────────────────────────────────

var (
	urlHostRe  = regexp.MustCompile(`[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/\s"'` + "`" + `]*@)?([A-Za-z0-9_.-]+)`)
	hostPortRe = regexp.MustCompile(`(?:^|[\s,;=/@(\[])([A-Za-z][\w.-]*):\d{2,5}\b`)
	bareHostRe = regexp.MustCompile(`^[A-Za-z][\w.-]*$`)
	// a string literal holding a URL or host:port
	litHostRe = regexp.MustCompile(`["'` + "`" + `]([a-z][a-z0-9+.-]*://[^"'` + "`" + `\s]+|[A-Za-z][\w.-]*:\d{2,5})["'` + "`" + `]`)
)

// HostsIn reads the hosts a config value points at: URLs, host:port lists, or a bare name.
func HostsIn(v string) []string {
	var out []string
	for _, m := range urlHostRe.FindAllStringSubmatch(v, -1) {
		out = append(out, m[1])
	}
	if len(out) == 0 {
		for _, m := range hostPortRe.FindAllStringSubmatch(v, -1) {
			out = append(out, m[1])
		}
	}
	if len(out) == 0 && bareHostRe.MatchString(strings.TrimSpace(v)) {
		out = append(out, strings.TrimSpace(v))
	}
	for i, h := range out {
		out[i] = NormHost(h)
	}
	return uniq(out)
}

// NormHost lower-cases a host and reduces a cluster DNS name to its service name
// (orders-db.prod.svc.cluster.local → orders-db).
func NormHost(h string) string {
	h = strings.ToLower(strings.TrimSuffix(h, "."))
	for _, suf := range []string{".svc.cluster.local", ".svc"} {
		if strings.HasSuffix(h, suf) {
			return strings.SplitN(strings.TrimSuffix(h, suf), ".", 2)[0]
		}
	}
	return h
}

// ── code: env vars, host literals, gRPC clients ──────────────────

var (
	goEnvRe     = regexp.MustCompile(`\bos\.(?:Getenv|LookupEnv)\(\s*"([A-Za-z_][A-Za-z0-9_]*)"`)
	goEnvTagRe  = regexp.MustCompile("\\benv(?:config)?:\"([A-Za-z_][A-Za-z0-9_]*)")
	goClientRe  = regexp.MustCompile(`\bNew(\w+)Client\(`)
	tsEnvRe     = regexp.MustCompile(`\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)|\bprocess\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]|\bDeno\.env\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]`)
	tsClientRe  = regexp.MustCompile(`\bnew\s+(\w+)Client\(`)
	localHostRe = regexp.MustCompile(`^(localhost|127\.0\.0\.1|0\.0\.0\.0|example\.(com|org)|schemas?\..*|www\.w3\.org|json-schema\.org)$`)
)

// wireLine records the env vars, host literals and gRPC clients one line of code names.
func wireLine(line, dir, rel string, n int, env, client *regexp.Regexp, extraEnv *regexp.Regexp, f *Facts) {
	for _, re := range []*regexp.Regexp{env, extraEnv} {
		if re == nil {
			continue
		}
		for _, m := range re.FindAllStringSubmatch(line, -1) {
			for _, name := range m[1:] {
				if name != "" {
					f.Env = append(f.Env, EnvUse{Name: name, Mod: dir, File: rel, Line: n})
				}
			}
		}
	}
	for _, m := range litHostRe.FindAllStringSubmatch(line, -1) {
		for _, h := range HostsIn(m[1]) {
			if !localHostRe.MatchString(h) {
				f.Hosts = append(f.Hosts, HostUse{Host: h, Text: m[1], Mod: dir, File: rel, Line: n})
			}
		}
	}
	for _, m := range client.FindAllStringSubmatch(line, -1) {
		f.Clients = append(f.Clients, Client{Service: m[1], Mod: dir, File: rel, Line: n})
	}
}

// ── compose ───────────────────────────────────────────────────────

func mapGet(n *yaml.Node, key string) *yaml.Node {
	if n == nil || n.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			return n.Content[i+1]
		}
	}
	return nil
}

// composeWiring reads depends_on, links and environment of every compose service.
func composeWiring(p string, root *yaml.Node, dirs map[string]string, f *Facts) {
	svcs := mapGet(root, "services")
	if svcs == nil || svcs.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i+1 < len(svcs.Content); i += 2 {
		name, s := svcs.Content[i].Value, svcs.Content[i+1]
		from := dirs[name]
		if h := mapGet(s, "hostname"); h != nil && h.Value != "" && h.Value != name {
			f.Aliases = append(f.Aliases, [2]string{NormHost(h.Value), NormHost(name)})
		}
		if h := mapGet(s, "container_name"); h != nil && h.Value != "" && h.Value != name {
			f.Aliases = append(f.Aliases, [2]string{NormHost(h.Value), NormHost(name)})
		}
		if d := mapGet(s, "depends_on"); d != nil {
			var deps []*yaml.Node
			switch d.Kind {
			case yaml.SequenceNode:
				deps = d.Content
			case yaml.MappingNode:
				for j := 0; j < len(d.Content); j += 2 {
					deps = append(deps, d.Content[j])
				}
			}
			for _, x := range deps {
				f.Wires = append(f.Wires, Wire{From: name, FromDir: from, Host: NormHost(x.Value), How: "depends_on", File: p, Line: x.Line})
			}
		}
		if l := mapGet(s, "links"); l != nil && l.Kind == yaml.SequenceNode {
			for _, x := range l.Content {
				f.Wires = append(f.Wires, Wire{From: name, FromDir: from, Host: NormHost(strings.SplitN(x.Value, ":", 2)[0]), How: "link", File: p, Line: x.Line})
			}
		}
		env := mapGet(s, "environment")
		if env == nil {
			continue
		}
		add := func(k, v string, line int) {
			k = strings.TrimSpace(k)
			if strings.Contains(v, "${") && !strings.Contains(v, ":-") { // interpolated: the value is elsewhere
				f.Unwired = append(f.Unwired, Unwired{From: name, Env: k, File: p, Line: line})
				return
			}
			for _, h := range HostsIn(v) {
				f.Wires = append(f.Wires, Wire{From: name, FromDir: from, Host: h, How: "env", Env: k, File: p, Line: line})
			}
			f.EnvSet = append(f.EnvSet, EnvSet{From: name, FromDir: from, Name: k, File: p, Line: line})
		}
		switch env.Kind {
		case yaml.MappingNode:
			for j := 0; j+1 < len(env.Content); j += 2 {
				add(env.Content[j].Value, env.Content[j+1].Value, env.Content[j].Line)
			}
		case yaml.SequenceNode:
			for _, x := range env.Content {
				k, v, _ := strings.Cut(x.Value, "=")
				add(k, v, x.Line)
			}
		}
	}
}

// EnvSet: a manifest sets an env var on a deployable (whatever its value).
type EnvSet struct {
	From    string `json:"from"`
	FromDir string `json:"fromDir,omitempty"`
	Name    string `json:"name"`
	File    string `json:"file"`
	Line    int    `json:"line,omitempty"`
}

// ── kubernetes ────────────────────────────────────────────────────

// k8sWiring reads one manifest document: env of workloads, pod labels, Service selectors and
// Ingress rules.
func k8sWiring(p, kind, name string, doc *yaml.Node, f *Facts) (labels map[string]string) {
	spec := mapGet(doc, "spec")
	switch kind {
	case "Service":
		sel := map[string]string{}
		if s := mapGet(spec, "selector"); s != nil && s.Kind == yaml.MappingNode {
			for i := 0; i+1 < len(s.Content); i += 2 {
				sel[s.Content[i].Value] = s.Content[i+1].Value
			}
		}
		f.K8sServices = append(f.K8sServices, K8sService{Name: name, Selector: sel, File: p})
		return nil
	case "Ingress":
		walkIngress(p, spec, f)
		return nil
	}
	tpl := mapGet(spec, "template")
	if kind == "CronJob" {
		tpl = mapGet(mapGet(mapGet(spec, "jobTemplate"), "spec"), "template")
	}
	labels = map[string]string{}
	if l := mapGet(mapGet(tpl, "metadata"), "labels"); l != nil && l.Kind == yaml.MappingNode {
		for i := 0; i+1 < len(l.Content); i += 2 {
			labels[l.Content[i].Value] = l.Content[i+1].Value
		}
	}
	podSpec := mapGet(tpl, "spec")
	for _, key := range []string{"containers", "initContainers"} {
		cs := mapGet(podSpec, key)
		if cs == nil || cs.Kind != yaml.SequenceNode {
			continue
		}
		for _, c := range cs.Content {
			env := mapGet(c, "env")
			if env == nil || env.Kind != yaml.SequenceNode {
				continue
			}
			for _, e := range env.Content {
				n := mapGet(e, "name")
				if n == nil {
					continue
				}
				f.EnvSet = append(f.EnvSet, EnvSet{From: name, Name: n.Value, File: p, Line: n.Line})
				v := mapGet(e, "value")
				if v == nil {
					f.Unwired = append(f.Unwired, Unwired{From: name, Env: n.Value, File: p, Line: n.Line})
					continue
				}
				for _, h := range HostsIn(v.Value) {
					f.Wires = append(f.Wires, Wire{From: name, Host: h, How: "env", Env: n.Value, File: p, Line: v.Line})
				}
			}
		}
	}
	return labels
}

func walkIngress(p string, spec *yaml.Node, f *Facts) {
	rules := mapGet(spec, "rules")
	if rules == nil || rules.Kind != yaml.SequenceNode {
		return
	}
	for _, r := range rules.Content {
		host := ""
		if h := mapGet(r, "host"); h != nil {
			host = h.Value
		}
		paths := mapGet(mapGet(r, "http"), "paths")
		if paths == nil || paths.Kind != yaml.SequenceNode {
			continue
		}
		for _, x := range paths.Content {
			pth := "/"
			if v := mapGet(x, "path"); v != nil {
				pth = v.Value
			}
			b := mapGet(x, "backend")
			svc := mapGet(mapGet(b, "service"), "name")
			if svc == nil {
				svc = mapGet(b, "serviceName")
			}
			if svc != nil {
				f.Ingress = append(f.Ingress, IngressRule{Host: host, Path: pth, Service: NormHost(svc.Value), File: p, Line: svc.Line})
			}
		}
	}
}

// ── migrations ────────────────────────────────────────────────────

var (
	sqlCreateRe = regexp.MustCompile(`(?is)^create\s+(?:unlogged\s+|temporary\s+|temp\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:[\w"]+\.)?"?\w+"?)\s*\(`)
	sqlAlterRe  = regexp.MustCompile(`(?is)^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?((?:[\w"]+\.)?"?\w+"?)\s+(.*)$`)
	sqlDropRe   = regexp.MustCompile(`(?is)^drop\s+table\s+(?:if\s+exists\s+)?((?:[\w"]+\.)?"?\w+"?(?:\s*,\s*(?:[\w"]+\.)?"?\w+"?)*)`)
	sqlRenameRe = regexp.MustCompile(`(?is)^rename\s+to\s+"?(\w+)"?`)
	sqlAddCol   = regexp.MustCompile(`(?is)^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+(.+)$`)
	sqlDropCol  = regexp.MustCompile(`(?is)^drop\s+(?:column\s+)?(?:if\s+exists\s+)?"?(\w+)"?`)
	sqlRefRe    = regexp.MustCompile(`(?is)\breferences\s+((?:[\w"]+\.)?"?\w+"?)`)
	sqlFKRe     = regexp.MustCompile(`(?is)\bforeign\s+key\s*\(\s*"?(\w+)"?[^)]*\)\s*references\s+((?:[\w"]+\.)?"?\w+"?)`)
	sqlNotCol   = regexp.MustCompile(`(?i)^(constraint|primary|unique|foreign|check|exclude|index|key|like)\b`)
	sqlDownRe   = regexp.MustCompile(`(?i)^--\s*(\+goose\s+down|\+migrate\s+down|migrate:down)`)
)

func tableName(s string) string {
	s = strings.ReplaceAll(s, `"`, "")
	if i := strings.LastIndex(s, "."); i >= 0 {
		s = s[i+1:]
	}
	return strings.ToLower(s)
}

// migrationTables replays SQL migrations in file order into the tables they leave behind.
func migrationTables(cfg interface{ Abs(string) string }, files []string, f *Facts) {
	byName := map[string]*Table{}
	var order []string
	for _, p := range files {
		low := strings.ToLower(p)
		if !strings.HasSuffix(low, ".sql") || strings.Contains(low, ".down.") || strings.HasSuffix(low, "_down.sql") || strings.HasSuffix(low, ".undo.sql") {
			continue
		}
		b, err := os.ReadFile(cfg.Abs(p))
		if err != nil {
			continue
		}
		for _, st := range sqlStatements(string(b)) {
			text := st.text
			switch {
			case sqlCreateRe.MatchString(text):
				m := sqlCreateRe.FindStringSubmatch(text)
				name := tableName(m[1])
				body := text[len(m[0]):]
				if i := strings.LastIndex(body, ")"); i >= 0 {
					body = body[:i]
				}
				t := &Table{Name: name, Columns: []Column{}, File: p, Line: st.line}
				for _, part := range splitTop(body) {
					part = strings.TrimSpace(part)
					if part == "" {
						continue
					}
					if sqlNotCol.MatchString(part) {
						if fk := sqlFKRe.FindStringSubmatch(part); fk != nil {
							setRef(t, strings.ToLower(fk[1]), tableName(fk[2]))
						}
						continue
					}
					fs := strings.Fields(part)
					if len(fs) < 2 {
						continue
					}
					c := Column{Name: strings.ToLower(strings.Trim(fs[0], `"`)), Type: strings.ToLower(fs[1])}
					if r := sqlRefRe.FindStringSubmatch(part); r != nil {
						c.Ref = tableName(r[1])
					}
					t.Columns = append(t.Columns, c)
				}
				if _, ok := byName[name]; !ok {
					order = append(order, name)
				}
				byName[name] = t
			case sqlAlterRe.MatchString(text):
				m := sqlAlterRe.FindStringSubmatch(text)
				t := byName[tableName(m[1])]
				if t == nil {
					continue
				}
				for _, act := range splitTop(m[2]) {
					act = strings.TrimSpace(act)
					if r := sqlRenameRe.FindStringSubmatch(act); r != nil {
						delete(byName, t.Name)
						t.Name = strings.ToLower(r[1])
						byName[t.Name] = t
						order = append(order, t.Name)
						continue
					}
					if fk := sqlFKRe.FindStringSubmatch(act); fk != nil {
						setRef(t, strings.ToLower(fk[1]), tableName(fk[2]))
						continue
					}
					if sqlNotCol.MatchString(strings.TrimPrefix(strings.ToLower(act), "add ")) {
						continue
					}
					if a := sqlAddCol.FindStringSubmatch(act); a != nil {
						fs := strings.Fields(a[2])
						c := Column{Name: strings.ToLower(a[1])}
						if len(fs) > 0 {
							c.Type = strings.ToLower(fs[0])
						}
						if r := sqlRefRe.FindStringSubmatch(a[2]); r != nil {
							c.Ref = tableName(r[1])
						}
						t.Columns = append(t.Columns, c)
					} else if d := sqlDropCol.FindStringSubmatch(act); d != nil && !strings.HasPrefix(strings.ToLower(act), "drop constraint") {
						for i, c := range t.Columns {
							if c.Name == strings.ToLower(d[1]) {
								t.Columns = append(t.Columns[:i], t.Columns[i+1:]...)
								break
							}
						}
					}
				}
			case sqlDropRe.MatchString(text):
				for _, n := range strings.Split(sqlDropRe.FindStringSubmatch(text)[1], ",") {
					delete(byName, tableName(strings.TrimSpace(n)))
				}
			}
		}
	}
	seen := map[string]bool{}
	for _, n := range order {
		if t := byName[n]; t != nil && !seen[n] && t.Name == n {
			seen[n] = true
			f.Tables = append(f.Tables, *t)
		}
	}
}

func setRef(t *Table, col, ref string) {
	for i := range t.Columns {
		if t.Columns[i].Name == col {
			t.Columns[i].Ref = ref
		}
	}
}

type stmt struct {
	text string
	line int
}

// sqlStatements splits SQL on semicolons outside strings and parentheses, drops comments and
// stops at a "down" section marker.
func sqlStatements(src string) []stmt {
	var out []stmt
	var b strings.Builder
	start := 0
	depth := 0
	inStr := false
	lines := strings.Split(src, "\n")
	for li, l := range lines {
		t := strings.TrimSpace(l)
		if sqlDownRe.MatchString(t) {
			break
		}
		if i := strings.Index(l, "--"); i >= 0 && !inStr {
			l = l[:i]
		}
		for _, r := range l {
			switch {
			case r == '\'':
				inStr = !inStr
			case inStr:
			case r == '(':
				depth++
			case r == ')':
				depth--
			case r == ';' && depth <= 0:
				if s := strings.TrimSpace(b.String()); s != "" {
					out = append(out, stmt{s, start})
				}
				b.Reset()
				start = 0
				continue
			}
			if start == 0 && r != ' ' && r != '\t' {
				start = li + 1
			}
			b.WriteRune(r)
		}
		b.WriteRune('\n')
	}
	if s := strings.TrimSpace(b.String()); s != "" {
		out = append(out, stmt{s, start})
	}
	return out
}

// splitTop splits on commas outside parentheses.
func splitTop(s string) []string {
	var out []string
	depth, last := 0, 0
	for i, r := range s {
		switch r {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				out = append(out, s[last:i])
				last = i + 1
			}
		}
	}
	return append(out, s[last:])
}

// ── protos ────────────────────────────────────────────────────────

var (
	pbPackageRe = regexp.MustCompile(`^\s*package\s+([\w.]+)\s*;`)
	pbServiceRe = regexp.MustCompile(`^\s*service\s+(\w+)`)
	pbRPCRe     = regexp.MustCompile(`^\s*rpc\s+(\w+)\s*\(\s*(?:stream\s+)?([\w.]+)\s*\)\s*returns\s*\(\s*(?:stream\s+)?([\w.]+)`)
	pbMessageRe = regexp.MustCompile(`^\s*message\s+(\w+)`)
	pbFieldRe   = regexp.MustCompile(`^\s*(?:repeated\s+|optional\s+)?([\w.<>, ]+?)\s+(\w+)\s*=\s*\d+`)
)

func protoFile(abs, rel string, f *Facts) {
	fh, err := os.Open(abs)
	if err != nil {
		return
	}
	defer fh.Close()
	sc := bufio.NewScanner(fh)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	pkg := ""
	depth := 0
	var svc *ProtoService
	var msg *ProtoMessage
	n := 0
	for sc.Scan() {
		n++
		line := sc.Text()
		if i := strings.Index(line, "//"); i >= 0 {
			line = line[:i]
		}
		if m := pbPackageRe.FindStringSubmatch(line); m != nil {
			pkg = m[1]
		}
		if depth == 0 {
			if m := pbServiceRe.FindStringSubmatch(line); m != nil {
				f.Protos = append(f.Protos, ProtoService{Package: pkg, Name: m[1], Methods: []ProtoRPC{}, File: rel, Line: n})
				svc = &f.Protos[len(f.Protos)-1]
			} else if m := pbMessageRe.FindStringSubmatch(line); m != nil {
				f.Messages = append(f.Messages, ProtoMessage{Package: pkg, Name: m[1], Fields: []string{}, File: rel, Line: n})
				msg = &f.Messages[len(f.Messages)-1]
			}
		} else if depth == 1 {
			if m := pbRPCRe.FindStringSubmatch(line); m != nil && svc != nil {
				svc.Methods = append(svc.Methods, ProtoRPC{Name: m[1], In: m[2], Out: m[3], Line: n})
			} else if m := pbFieldRe.FindStringSubmatch(line); m != nil && msg != nil {
				msg.Fields = append(msg.Fields, m[2])
			}
		}
		depth += strings.Count(line, "{") - strings.Count(line, "}")
		if depth <= 0 {
			depth = 0
			if strings.Contains(line, "}") {
				svc, msg = nil, nil
			}
		}
	}
}

// ── CODEOWNERS ────────────────────────────────────────────────────

func codeowners(abs, rel string, f *Facts) {
	b, err := os.ReadFile(abs)
	if err != nil {
		return
	}
	for i, l := range strings.Split(string(b), "\n") {
		t := strings.TrimSpace(l)
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		fs := strings.Fields(t)
		if len(fs) < 2 {
			continue
		}
		f.Owners = append(f.Owners, OwnerRule{Pattern: fs[0], Owners: fs[1:], File: rel, Line: i + 1})
	}
}

// OwnerOf applies CODEOWNERS rules to a folder: the last rule that matches wins.
func (f *Facts) OwnerOf(dir string) []string {
	var out []string
	for _, r := range f.Owners {
		if ownerMatch(r.Pattern, dir) {
			out = r.Owners
		}
	}
	return out
}

func ownerMatch(pat, dir string) bool {
	if pat == "*" || pat == "/*" || pat == "/**" {
		return true
	}
	anchored := strings.HasPrefix(pat, "/")
	p := strings.TrimSuffix(strings.TrimSuffix(strings.TrimPrefix(pat, "/"), "/**"), "/")
	if p == "" {
		return true
	}
	if !anchored && !strings.Contains(p, "/") { // a bare name matches any segment
		for _, seg := range strings.Split(dir, "/") {
			if ok, _ := path.Match(p, seg); ok {
				return true
			}
		}
		return false
	}
	for d := dir; d != "." && d != "/" && d != ""; d = path.Dir(d) {
		if ok, _ := path.Match(p, d); ok {
			return true
		}
	}
	return false
}
