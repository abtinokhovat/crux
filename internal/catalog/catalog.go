// Package catalog is the registry of technologies, categories and transports. Each entry
// carries its own look (color, icon, shape, edge style), so a project only names things.
package catalog

import (
	_ "embed"
	"os"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed catalog.yaml
var builtin []byte

type Category struct {
	Label string `json:"label" yaml:"label"`
	Shape string `json:"shape" yaml:"shape"` // card | cylinder | pipe
}

type Detect struct {
	Go    []string `json:"go,omitempty" yaml:"go"`
	Npm   []string `json:"npm,omitempty" yaml:"npm"`
	Image []string `json:"image,omitempty" yaml:"image"`
}

type Tech struct {
	ID       string   `json:"id" yaml:"-"`
	Label    string   `json:"label" yaml:"label"`
	Category string   `json:"category" yaml:"category"`
	Color    string   `json:"color" yaml:"color"`
	Icon     string   `json:"icon,omitempty" yaml:"icon"`
	Shape    string   `json:"shape,omitempty" yaml:"shape"`
	Aliases  []string `json:"aliases,omitempty" yaml:"aliases"`
	Detect   Detect   `json:"-" yaml:"detect"`
}

type Transport struct {
	ID      string   `json:"id" yaml:"-"`
	Label   string   `json:"label" yaml:"label"`
	Mode    string   `json:"mode" yaml:"mode"` // sync | async | stream | data | trigger
	Aliases []string `json:"aliases,omitempty" yaml:"aliases"`
}

type Catalog struct {
	Categories map[string]Category   `json:"categories" yaml:"categories"`
	Tech       map[string]*Tech      `json:"tech" yaml:"tech"`
	Transports map[string]*Transport `json:"transports" yaml:"transports"`
	alias      map[string]string
	talias     map[string]string
}

// Load reads the built-in catalog and merges the project file over it (entries by id; a partial
// entry keeps the built-in fields it does not set).
func Load(projectFile string) (*Catalog, error) {
	c := &Catalog{}
	if err := yaml.Unmarshal(builtin, c); err != nil {
		return nil, err
	}
	if projectFile != "" {
		if b, err := os.ReadFile(projectFile); err == nil {
			var p Catalog
			if err := yaml.Unmarshal(b, &p); err != nil {
				return nil, err
			}
			for k, v := range p.Categories {
				c.Categories[k] = v
			}
			for k, v := range p.Tech {
				if old := c.Tech[k]; old != nil && v != nil {
					merged := *old
					if v.Label != "" {
						merged.Label = v.Label
					}
					if v.Category != "" {
						merged.Category = v.Category
					}
					if v.Color != "" {
						merged.Color = v.Color
					}
					if v.Icon != "" {
						merged.Icon = v.Icon
					}
					if v.Shape != "" {
						merged.Shape = v.Shape
					}
					merged.Aliases = append(merged.Aliases, v.Aliases...)
					merged.Detect.Go = append(merged.Detect.Go, v.Detect.Go...)
					merged.Detect.Npm = append(merged.Detect.Npm, v.Detect.Npm...)
					merged.Detect.Image = append(merged.Detect.Image, v.Detect.Image...)
					c.Tech[k] = &merged
				} else if v != nil {
					c.Tech[k] = v
				}
			}
			for k, v := range p.Transports {
				c.Transports[k] = v
			}
		}
	}
	c.index()
	return c, nil
}

// Builtin is the catalog without project overrides.
func Builtin() *Catalog {
	c, _ := Load("")
	return c
}

func (c *Catalog) index() {
	c.alias, c.talias = map[string]string{}, map[string]string{}
	for id, t := range c.Tech {
		t.ID = id
		if t.Label == "" {
			t.Label = id
		}
		if t.Shape == "" {
			t.Shape = c.Categories[t.Category].Shape
		}
		c.alias[key(id)] = id
		c.alias[key(t.Label)] = id
		for _, a := range t.Aliases {
			c.alias[key(a)] = id
		}
	}
	for id, t := range c.Transports {
		t.ID = id
		c.talias[key(id)] = id
		for _, a := range t.Aliases {
			c.talias[key(a)] = id
		}
	}
}

func key(s string) string {
	return strings.ToLower(strings.NewReplacer(" ", "", "-", "", "_", "", ".", "").Replace(strings.TrimSpace(s)))
}

// TechID resolves a name or alias ("PostgreSQL", "pg") to a catalog id. Unknown names come back
// lowercased, so a project can use any word and still get a stable class.
func (c *Catalog) TechID(name string) (string, bool) {
	if id, ok := c.alias[key(name)]; ok {
		return id, true
	}
	return strings.ToLower(strings.TrimSpace(name)), false
}

// TransportID resolves "event" → "topic", "rest" → "http".
func (c *Catalog) TransportID(name string) (string, bool) {
	id, ok := c.talias[key(name)]
	return id, ok
}

func (c *Catalog) Mode(transport string) string {
	if t := c.Transports[transport]; t != nil {
		return t.Mode
	}
	return ""
}

// DetectGo returns tech ids implied by a Go module path.
func (c *Catalog) DetectGo(module string) []string {
	return c.detect(func(d Detect) []string { return d.Go }, func(p string) bool { return module == p || strings.HasPrefix(module, p+"/") || strings.HasPrefix(module, p) })
}

// DetectNpm returns tech ids implied by an npm package name.
func (c *Catalog) DetectNpm(pkg string) []string {
	return c.detect(func(d Detect) []string { return d.Npm }, func(p string) bool { return pkg == p })
}

// DetectImage returns tech ids implied by a container image ("postgres:16-alpine").
func (c *Catalog) DetectImage(image string) []string {
	name := image
	if i := strings.LastIndex(name, "@"); i > 0 {
		name = name[:i]
	}
	if i := strings.LastIndex(name, ":"); i > strings.LastIndex(name, "/") {
		name = name[:i]
	}
	name = strings.TrimPrefix(name, "docker.io/")
	name = strings.TrimPrefix(name, "library/")
	return c.detect(func(d Detect) []string { return d.Image }, func(p string) bool { return name == p })
}

func (c *Catalog) detect(get func(Detect) []string, match func(string) bool) []string {
	var out []string
	for id, t := range c.Tech {
		for _, p := range get(t.Detect) {
			if match(p) {
				out = append(out, id)
				break
			}
		}
	}
	sort.Strings(out)
	return out
}
