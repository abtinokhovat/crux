// Locates and loads adr.config.yaml for a project.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";

export const CONFIG_NAMES = ["adr.config.yaml", "adr.config.yml", "adr.config.json"];

export const DEFAULTS = Object.freeze({
  title: "Decision records",
  dir: "docs/adr",
  architecture: "docs/adr/architecture.yaml",
  components: ".adr/components",
  template: ".adr/template.md",
  // Extra markdown folders shown as "docs" (design notes, research); not ADRs.
  docs: [],
  // Prefix used when writing and recognizing references: ADR-0004.
  prefix: "ADR",
  digits: 4,
  statuses: {
    open: { label: "Open", color: "warn", order: 0 },
    proposed: { label: "Proposed", color: "info", order: 1 },
    accepted: { label: "Accepted", color: "ok", order: 2 },
    rejected: { label: "Rejected", color: "err", order: 3 },
    superseded: { label: "Superseded", color: "mute", order: 4 },
    deprecated: { label: "Deprecated", color: "mute", order: 5 },
  },
  // Free-form tag descriptions/colors: { kafka: { color: "#..." , desc: "..." } }
  tags: {},
});

export function findRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (CONFIG_NAMES.some((n) => existsSync(join(dir, n)))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function loadConfig(root) {
  const file = CONFIG_NAMES.map((n) => join(root, n)).find(existsSync);
  const raw = file ? YAML.parse(readFileSync(file, "utf8")) ?? {} : {};
  const cfg = { ...DEFAULTS, ...raw };
  cfg.statuses = { ...DEFAULTS.statuses, ...(raw.statuses ?? {}) };
  cfg.docs = [].concat(cfg.docs ?? []);
  cfg.root = root;
  cfg.file = file ?? null;
  cfg.abs = (p) => resolve(root, p);
  return cfg;
}
