package index

import (
	"embed"
	"fmt"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed rules/*.yaml
var ruleFS embed.FS

// Rule recognizes a library call (or composite literal) and says what it means. Match is a
// callee id with * for "anything"; a rule is data, so a project or a community adds one for a
// library without touching code.
type Rule struct {
	ID    string `yaml:"id" json:"id"`
	Match string `yaml:"match" json:"match"`
	// Role: publish | consume | declare | route | serve-grpc | client-grpc | call-http | db | use
	Role string `yaml:"role" json:"role"`
	Kind string `yaml:"kind" json:"kind"` // topic | queue | http | grpc | sql …
	Tech string `yaml:"tech" json:"tech"`
	// Name is the argument number holding the name (topic, route, url, sql); Field names a field
	// of a composite literal instead. Key is the routing key argument.
	Name  *int   `yaml:"name" json:"name,omitempty"`
	Field string `yaml:"field" json:"field,omitempty"`
	Key   *int   `yaml:"key" json:"key,omitempty"`
	// ArgType: argument 0's type must contain this text (tells a gRPC connection from any other).
	ArgType string `yaml:"arg_type" json:"arg_type,omitempty"`
	// Service: regexp on the callee's last segment; group 1 is the service (NewOrdersClient → Orders).
	Service string `yaml:"service" json:"service,omitempty"`
	// Method: fixed HTTP method, or "callee" to take it from the callee's name (Router.GET → GET).
	Method string `yaml:"method" json:"method,omitempty"`

	re  *regexp.Regexp
	svc *regexp.Regexp
}

type ruleFile struct {
	Rules []Rule `yaml:"rules"`
}

// DefaultRules loads the rules that ship with crux.
func DefaultRules() ([]Rule, error) {
	ents, err := ruleFS.ReadDir("rules")
	if err != nil {
		return nil, err
	}
	var all []Rule
	for _, e := range ents {
		b, err := ruleFS.ReadFile("rules/" + e.Name())
		if err != nil {
			return nil, err
		}
		rs, err := ParseRules(b)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", e.Name(), err)
		}
		all = append(all, rs...)
	}
	return all, nil
}

// ParseRules reads a rules file (also used for a project's own rules).
func ParseRules(b []byte) ([]Rule, error) {
	var f ruleFile
	if err := yaml.Unmarshal(b, &f); err != nil {
		return nil, err
	}
	for i := range f.Rules {
		r := &f.Rules[i]
		if r.Match == "" || r.Role == "" {
			return nil, fmt.Errorf("rule %q needs match and role", r.ID)
		}
		parts := strings.Split(r.Match, "*")
		for j := range parts {
			parts[j] = regexp.QuoteMeta(parts[j])
		}
		re, err := regexp.Compile("^" + strings.Join(parts, ".*") + "$")
		if err != nil {
			return nil, err
		}
		r.re = re
		if r.Service != "" {
			if r.svc, err = regexp.Compile(r.Service); err != nil {
				return nil, fmt.Errorf("rule %q service: %w", r.ID, err)
			}
		}
	}
	return f.Rules, nil
}

func (r *Rule) matches(c *Call) bool {
	if !r.re.MatchString(c.Callee) {
		return false
	}
	if r.ArgType != "" && (len(c.Args) == 0 || !strings.Contains(c.Args[0].Type, r.ArgType)) {
		return false
	}
	return true
}
