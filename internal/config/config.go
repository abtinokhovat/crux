// Package config finds and loads crux.config.yaml and the per-user settings file.
package config

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Names checked when looking for the project root, in order. adr.config.* is the old name.
var Names = []string{"crux.config.yaml", "crux.config.yml", "crux.config.json", "adr.config.yaml", "adr.config.yml"}

type Status struct {
	Label string `json:"label" yaml:"label"`
	Color string `json:"color" yaml:"color"`
	Order int    `json:"order" yaml:"order"`
}

type TagInfo struct {
	Desc  string `json:"desc,omitempty" yaml:"desc"`
	Color string `json:"color,omitempty" yaml:"color"`
}

type Config struct {
	Title        string             `yaml:"title"`
	Dir          string             `yaml:"dir"`
	Architecture string             `yaml:"architecture"`
	Components   string             `yaml:"components"`
	Template     string             `yaml:"template"`
	Docs         []string           `yaml:"docs"`
	Prefix       string             `yaml:"prefix"`
	Digits       int                `yaml:"digits"`
	Statuses     map[string]Status  `yaml:"statuses"`
	Share        string             `yaml:"share"`
	Me           string             `yaml:"me"`
	Tags         map[string]TagInfo `yaml:"tags"`
	Glossary     map[string]string  `yaml:"glossary"` // term → short definition, shown on hover

	Root       string `yaml:"-"`
	File       string `yaml:"-"`
	ShareToken string `yaml:"-"`
	User       User   `yaml:"-"`
}

// Flow: Draft (private) → Open → In review (shared) → Accepted | Rejected.
func DefaultStatuses() map[string]Status {
	return map[string]Status{
		"draft":      {"Draft", "purple", 0},
		"open":       {"Open", "warn", 1},
		"review":     {"In review", "info", 2},
		"proposed":   {"Proposed", "info", 3},
		"accepted":   {"Accepted", "ok", 4},
		"rejected":   {"Rejected", "err", 5},
		"superseded": {"Superseded", "mute", 6},
		"deprecated": {"Deprecated", "mute", 7},
	}
}

func defaults() Config {
	return Config{
		Title:        "Decision records",
		Dir:          "docs/adr",
		Architecture: "docs/adr/architecture.yaml",
		Components:   ".crux/components",
		Template:     ".crux/template.md",
		Prefix:       "ADR",
		Digits:       4,
		Statuses:     DefaultStatuses(),
		Tags:         map[string]TagInfo{},
	}
}

// FindRoot walks up from start to the folder holding a config file. Empty when none.
func FindRoot(start string) string {
	dir, _ := filepath.Abs(start)
	for {
		for _, n := range Names {
			if _, err := os.Stat(filepath.Join(dir, n)); err == nil {
				return dir
			}
		}
		up := filepath.Dir(dir)
		if up == dir {
			return ""
		}
		dir = up
	}
}

func Load(root string) (*Config, error) {
	cfg := defaults()
	for _, n := range Names {
		p := filepath.Join(root, n)
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var raw Config
		if err := yaml.Unmarshal(data, &raw); err != nil {
			return nil, err
		}
		merge(&cfg, raw)
		cfg.File = p
		break
	}
	cfg.Root = root
	cfg.User = LoadUser()
	if cfg.Me == "" {
		cfg.Me = firstNonEmpty(cfg.User.Me, os.Getenv("CRUX_ME"))
	}
	if v := os.Getenv("CRUX_SHARE"); v != "" {
		cfg.Share = v
	}
	cfg.Share = strings.TrimRight(cfg.Share, "/")
	if cfg.Share != "" {
		cfg.ShareToken = firstNonEmpty(cfg.User.Servers[cfg.Share].Token, os.Getenv("CRUX_TOKEN"))
	}
	// Projects that kept the old default folder still find their components.
	if cfg.Components == ".crux/components" && !exists(cfg.Abs(".crux")) && exists(cfg.Abs(".adr/components")) {
		cfg.Components = ".adr/components"
	}
	return &cfg, nil
}

func merge(dst *Config, src Config) {
	if src.Title != "" {
		dst.Title = src.Title
	}
	if src.Dir != "" {
		dst.Dir = src.Dir
	}
	if src.Architecture != "" {
		dst.Architecture = src.Architecture
	}
	if src.Components != "" {
		dst.Components = src.Components
	}
	if src.Template != "" {
		dst.Template = src.Template
	}
	if src.Docs != nil {
		dst.Docs = src.Docs
	}
	if src.Prefix != "" {
		dst.Prefix = src.Prefix
	}
	if src.Digits > 0 {
		dst.Digits = src.Digits
	}
	maps.Copy(dst.Statuses, src.Statuses)
	maps.Copy(dst.Tags, src.Tags)
	dst.Share = firstNonEmpty(src.Share, dst.Share)
	dst.Me = firstNonEmpty(src.Me, dst.Me)
}

func (c *Config) Abs(p string) string {
	if filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(c.Root, p)
}

func (c *Config) Rel(p string) string {
	r, err := filepath.Rel(c.Root, p)
	if err != nil {
		return p
	}
	return filepath.ToSlash(r)
}

// StatusOrder lists status keys by their order.
func (c *Config) StatusOrder() []string {
	keys := make([]string, 0, len(c.Statuses))
	for k := range c.Statuses {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return c.Statuses[keys[i]].Order < c.Statuses[keys[j]].Order })
	return keys
}

// ── per-user settings: ~/.config/crux/user.json ─────────────────────

type Server struct {
	Token  string `json:"token"`
	Handle string `json:"handle"`
}

type User struct {
	Me      string            `json:"me,omitempty"`
	Servers map[string]Server `json:"servers,omitempty"`
}

func UserFile() string {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "crux", "user.json")
}

func LoadUser() User {
	u := User{Servers: map[string]Server{}}
	if data, err := os.ReadFile(UserFile()); err == nil {
		_ = json.Unmarshal(data, &u)
	}
	if u.Servers == nil {
		u.Servers = map[string]Server{}
	}
	return u
}

func SaveUser(u User) error {
	p := UserFile()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(u, "", "  ")
	return os.WriteFile(p, data, 0o600)
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
