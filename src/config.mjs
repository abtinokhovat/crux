// Locates and loads adr.config.yaml for a project.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
  // Flow: Draft (private) → Open (question) → Review (shared) → Accepted | Rejected.
  statuses: {
    draft: { label: "Draft", color: "purple", order: 0 },
    open: { label: "Open", color: "warn", order: 1 },
    review: { label: "In review", color: "info", order: 2 },
    proposed: { label: "Proposed", color: "info", order: 3 },
    accepted: { label: "Accepted", color: "ok", order: 4 },
    rejected: { label: "Rejected", color: "err", order: 5 },
    superseded: { label: "Superseded", color: "mute", order: 6 },
    deprecated: { label: "Deprecated", color: "mute", order: 7 },
  },
  // Share server for meeting notes and team review, e.g. https://adr.example.com
  share: null,
  // Free-form tag descriptions/colors: { kafka: { color: "#..." , desc: "..." } }
  tags: {},
});

// Per-user settings outside the repo: handle and share-server tokens.
export const USER_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "adr-kit");
export const USER_FILE = join(USER_DIR, "user.json");

export function loadUser() {
  try {
    return JSON.parse(readFileSync(USER_FILE, "utf8"));
  } catch {
    return { me: null, servers: {} };
  }
}

export function saveUser(u) {
  mkdirSync(USER_DIR, { recursive: true });
  writeFileSync(USER_FILE, JSON.stringify(u, null, 2), { mode: 0o600 });
}

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
  const user = loadUser();
  cfg.user = user;
  cfg.me = raw.me ?? user.me ?? process.env.ADR_ME ?? null;
  cfg.share = process.env.ADR_SHARE || cfg.share || null;
  cfg.shareToken = cfg.share ? user.servers?.[cfg.share.replace(/\/$/, "")]?.token ?? process.env.ADR_TOKEN ?? null : null;
  return cfg;
}
