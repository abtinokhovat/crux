#!/usr/bin/env node
// adr — visual, connected Architecture Decision Records in your repo.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { findRoot, loadConfig } from "../src/config.mjs";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const C = process.stdout.isTTY ? { b: (s) => `\x1b[1m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, c: (s) => `\x1b[36m${s}\x1b[0m` } : new Proxy({}, { get: () => (s) => s });
const ST = { open: C.y, proposed: C.c, accepted: C.g, rejected: C.r };

const HELP = `${C.b("adr")} — visual, connected Architecture Decision Records

${C.b("Usage")}  adr <command> [options]

${C.b("Commands")}
  init                  Create adr.config.yaml, the ADR folder, an architecture map and a template
  serve                 Run the web app with live reload        [--port 4321] [--host] [--open]
  build [-o dist]       Export a static site (GitHub Pages, S3, nginx)
  new <title>           Create the next ADR from the template   [--open] [--tags a,b] [--components x,y]
                                                                 [--status S] [--author A] [--json]
  list                  Table of ADRs                           [--status S] [--tag T] [--json]
  show <id>             Summary of one ADR: decision, options, links   [--json]
  search <query>        Full-text search                        [--json]
  lint                  Check frontmatter, references, statuses, components, render errors
  index                 Rewrite the index table in <dir>/README.md (between adr:index markers)
  graph                 Print relations                         [--json] [--mermaid]
  tags                  Tag counts                              [--json]
  components            List fenced components available in ADRs
  next                  Print the next free ADR number
  skill install         Copy the bundled Claude skills into .claude/skills/ of this project

${C.b("Decision flow")}  capture → enrich (your Claude) → shape → share → team review → finalize
  q <question>          Capture a question as a private Draft  [--notes] [-c "what we know"] [--due D]
  notes <id>            Open the question for meeting notes on the share server  [--close] [--import]
  share <id>            Publish the ADR for team review (re-run to update)  [--close]
  pull <id>             Bring team input into .adr/reviews/<id>.md for you and your Claude
  finalize <id>         Accept an option: decision callout, verdicts, dissent  --option C [--decision "…"] [--reopen "a; b"]
  link <a> <rel> <b>    Link two ADRs, both sides (relates, supersedes, depends_on, amends)
  context [paths|terms] What is decided for these paths/topics — for agents  [--json]

${C.b("Share server")}
  server                Run the share server (Docker-friendly)  [--port 8080] [--data ./data]
                        env: ADR_TOKENS="handle:token,…" ADR_PASSCODE ADR_PUBLIC_URL
  login <url>           Store your owner token for a share server  --token T
  me [handle]           Show or set your handle (default: share-server login)

${C.b("Global")}
  --root <dir>          Project root (default: nearest folder with adr.config.yaml, else cwd)
`;

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith("-") ? argv.shift() : "help";
const { values: opt, positionals: pos } = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    root: { type: "string" }, port: { type: "string" }, host: { type: "string" }, open: { type: "boolean" },
    out: { type: "string", short: "o" }, tags: { type: "string" }, components: { type: "string" }, status: { type: "string" },
    author: { type: "string" }, tag: { type: "string" }, json: { type: "boolean" }, mermaid: { type: "boolean" },
    force: { type: "boolean" }, help: { type: "boolean", short: "h" },
    notes: { type: "boolean" }, context: { type: "string", short: "c" }, due: { type: "string" }, close: { type: "boolean" },
    import: { type: "boolean" }, option: { type: "string" }, decision: { type: "string" }, reopen: { type: "string" },
    token: { type: "string" }, data: { type: "string" },
  },
});

function project({ needConfig = true } = {}) {
  const root = opt.root ? resolve(opt.root) : findRoot() ?? process.cwd();
  const cfg = loadConfig(root);
  if (needConfig && !cfg.file) process.stderr.write(C.d(`No adr.config.yaml in ${root}; using defaults (dir: ${cfg.dir}). Run "adr init" to create one.\n`));
  return cfg;
}
async function store(cfg) {
  const { loadProjectComponents } = await import("../src/render.mjs");
  await loadProjectComponents(cfg);
  const { loadStore } = await import("../src/store.mjs");
  return loadStore(cfg);
}
function getAdr(cfg, s, raw) {
  const id = String(raw ?? "").replace(/\D/g, "").padStart(cfg.digits, "0");
  const a = s.byId.get(id);
  if (!a) throw new Error(`No ${cfg.prefix}-${id || "?"}. Run "adr list".`);
  return a;
}
const out = (data) => process.stdout.write(typeof data === "string" ? data + "\n" : JSON.stringify(data, null, 2) + "\n");
const pad = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s).padEnd(n));
const color = (a) => (ST[a.statusKey] ?? C.d)(pad(a.status, 12));

const commands = {
  help: () => out(HELP),

  async init() {
    const root = opt.root ? resolve(opt.root) : process.cwd();
    const cfgFile = join(root, "adr.config.yaml");
    const wrote = [];
    const put = (rel, body) => {
      const p = join(root, rel);
      if (existsSync(p) && !opt.force) return;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
      wrote.push(rel);
    };
    const name = root.split(/[\\/]/).pop();
    put("adr.config.yaml", `# adr-kit config — https://github.com/ (see README)
title: ${name} decisions
dir: docs/adr                         # ADR markdown files: NNNN-kebab-title.md
architecture: docs/adr/architecture.yaml
components: .adr/components           # project components: *.mjs exporting { name, render }
template: .adr/template.md            # used by "adr new" (falls back to the built-in one)
docs: []                              # extra markdown folders to index, e.g. [docs/design, docs/research]
prefix: ADR
# share: https://adr.example.com     # share server for meeting notes and team review (adr login <url> --token …)
# statuses:                           # add or recolor statuses (ok|info|warn|err|mute|purple|#hex)
#   piloting: { label: Piloting, color: purple, order: 2 }
# tags:
#   kafka: { desc: Event log and streaming }
`);
    put("docs/adr/architecture.yaml", `# Architecture map. Nodes nest with "children"; ADRs link with "adrs: [4]"
# or from the ADR side with "components: [kafka]". Edges may connect any two nodes;
# each zoom level shows them between the boxes visible there.
title: ${name}
desc: Select a box to see its decisions.
nodes:
  - id: clients
    label: Clients
    kind: actor
    sub: web and mobile apps
  - id: backend
    label: Backend
    kind: context
    sub: services and modules
    children:
      - id: api
        label: API
        kind: component
  - id: messaging
    label: Message broker
    kind: infra
    sub: async events between services
    children:
      - id: kafka
        label: Kafka
        kind: tech
        tags: [kafka]
  - id: storage
    label: Storage
    kind: store
    children:
      - id: postgres
        label: PostgreSQL
        kind: tech
edges:
  - clients -> api: HTTP
  - api -> kafka: domain events
  - api -> postgres: SQL
`);
    put(".adr/template.md", readFileSync(join(PKG, "templates/adr.md"), "utf8"));
    put(".adr/components/example.mjs", readFileSync(join(PKG, "templates/component.example.mjs"), "utf8"));
    put("docs/adr/README.md", `# Architecture Decision Records

Run \`npx adr serve\` to browse them visually (graph, architecture map, search).

- Source of truth: \`NNNN-kebab-title.md\`. Never renumber; never delete — supersede.
- Status: \`Open\` → \`Proposed\` → \`Accepted\` | \`Rejected\`; later \`Superseded by NNNN\` / \`Deprecated\`.
- Create one: \`adr new "Use Kafka for domain events" --tags kafka,messaging --components kafka\`

## Index

<!-- adr:index:start -->
<!-- adr:index:end -->
`);
    out(wrote.length ? `${C.g("✓")} created\n${wrote.map((w) => `  ${w}`).join("\n")}\n\nNext: ${C.b('adr new "My first decision"')} then ${C.b("adr serve")}` : `Nothing to do; files exist (use --force to overwrite). Config: ${relative(process.cwd(), cfgFile) || cfgFile}`);
  },

  async serve() {
    const cfg = project();
    const { serve } = await import("../src/server.mjs");
    const port = Number(opt.port ?? process.env.PORT ?? 4321);
    let res;
    for (let p = port; p < port + 20; p++) {
      try {
        res = await serve(cfg, { port: p, host: opt.host ?? "127.0.0.1" });
        break;
      } catch (err) {
        if (err.code !== "EADDRINUSE") throw err;
      }
    }
    const s = res.app.store;
    out(`${C.g("●")} ${C.b(cfg.title)}  ${C.c(res.url)}\n  ${s.adrs.length} ADRs · ${s.docs.length} docs · ${s.edges.length} links · ${Object.keys(s.tags).length} tags${s.architecture ? ` · ${Object.keys(s.architecture.nodes).length} components` : ""}\n  watching ${cfg.dir}${s.problems.length ? `\n  ${C.y(`${s.problems.length} problem(s)`)} — run ${C.b("adr lint")}` : ""}\n  ${C.d("Ctrl+C to stop")}`);
    if (opt.open) spawn(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [res.url], { stdio: "ignore", detached: true }).unref();
  },

  async build() {
    const cfg = project();
    const { build } = await import("../src/build.mjs");
    const r = await build(cfg, resolve(cfg.root, opt.out ?? pos[0] ?? "dist/adr"));
    out(`${C.g("✓")} ${r.count} pages → ${relative(process.cwd(), r.dir) || r.dir}${r.errors ? C.y(`  (${r.errors} render errors)`) : ""}\n  Serve with any static server, e.g. ${C.b(`npx serve ${relative(process.cwd(), r.dir)}`)}`);
  },

  async new() {
    const cfg = project();
    const title = pos.join(" ").trim();
    if (!title) return fail('Give a title: adr new "Use Kafka for domain events"');
    const s = await store(cfg);
    const { nextNumber } = await import("../src/store.mjs");
    const n = nextNumber(s);
    const id = String(n).padStart(cfg.digits, "0");
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const custom = cfg.abs(cfg.template);
    const tpl = opt.open ? join(PKG, "templates/adr-open.md") : existsSync(custom) ? custom : join(PKG, "templates/adr.md");
    const vars = {
      prefix: cfg.prefix, id, title, date: new Date().toISOString().slice(0, 10),
      status: opt.status ?? (opt.open ? "Open" : "Proposed"), author: opt.author ?? process.env.USER ?? "",
      tags: (opt.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).join(", "),
      components: (opt.components ?? "").split(",").map((t) => t.trim()).filter(Boolean).join(", "),
    };
    const body = readFileSync(tpl, "utf8").replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
    const file = join(cfg.abs(cfg.dir), `${id}-${slug}.md`);
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) return fail(`${file} exists`);
    writeFileSync(file, body);
    if (opt.json) return out({ id, file: relative(cfg.root, file), title });
    out(`${C.g("✓")} ${cfg.prefix}-${id}  ${relative(process.cwd(), file)}`);
  },

  async next() {
    const cfg = project();
    const { nextNumber } = await import("../src/store.mjs");
    out(String(nextNumber(await store(cfg))).padStart(cfg.digits, "0"));
  },

  async list() {
    const cfg = project();
    const s = await store(cfg);
    let items = s.adrs;
    if (opt.status) items = items.filter((a) => a.statusKey === opt.status.toLowerCase());
    if (opt.tag) items = items.filter((a) => a.tags.includes(opt.tag.toLowerCase()));
    if (opt.json) return out(items.map(({ source, text, ...a }) => a));
    out(items.map((a) => `${C.b(a.id)}  ${color(a)} ${pad(a.title, 52)} ${C.d(a.tags.map((t) => "#" + t).join(" "))}`).join("\n") || C.d("No ADRs."));
  },

  async show() {
    const cfg = project();
    const s = await store(cfg);
    const id = String(pos[0] ?? "").replace(/\D/g, "").padStart(cfg.digits, "0");
    const a = s.byId.get(id);
    if (!a) return fail(`No ${cfg.prefix}-${id}`);
    const links = s.edges.filter((e) => e.from === id || e.to === id);
    if (opt.json) return out({ ...a, source: undefined, text: undefined, links });
    const f = a.facts;
    const lines = [`${C.b(`${cfg.prefix}-${a.id}`)}  ${color(a)} ${C.b(a.title)}`, a.subtitle ? C.d(a.subtitle) : null, C.d(a.file)];
    if (f.decision) lines.push("", C.g("Decision  ") + f.decision);
    if (f.question) lines.push("", C.y("Question  ") + f.question);
    if (f.recommendation) lines.push("", C.c("Leaning   ") + f.recommendation);
    for (const o of f.options) {
      lines.push("", C.b(`Options${o.title ? `: ${o.title}` : ""}`));
      for (const it of o.items) lines.push(`  ${{ ok: C.g("✓"), no: C.r("✗"), warn: C.y("~") }[it.verdict.kind] ?? "·"} ${it.key ? it.key + " — " : ""}${it.name}${it.verdict.label ? C.d(` (${it.verdict.label})`) : ""}`);
    }
    if (f.questions.length) lines.push("", C.y(`Open questions (${f.questions.length})`), ...f.questions.map((q, i) => `  ${i + 1}. ${q}`));
    if (a.tags.length) lines.push("", `Tags: ${a.tags.map((t) => "#" + t).join(" ")}`);
    if (a.components.length) lines.push(`Components: ${a.components.join(", ")}`);
    if (links.length) lines.push(`Links: ${links.map((e) => (e.from === id ? `→ ${e.type} ${e.to}` : `← ${e.type} ${e.from}`)).join(", ")}`);
    out(lines.filter((l) => l != null).join("\n"));
  },

  async search() {
    const cfg = project();
    const s = await store(cfg);
    const q = pos.join(" ").toLowerCase().split(/\s+/).filter(Boolean);
    if (!q.length) return fail("adr search <words>");
    const hits = [...s.byId.values()]
      .map((a) => {
        const hay = [a.id, a.title, a.subtitle, a.tags.join(" "), a.components.join(" "), a.text].join(" ").toLowerCase();
        const title = (a.title + " " + a.tags.join(" ")).toLowerCase();
        if (!q.every((w) => hay.includes(w))) return null;
        return { a, score: q.reduce((n, w) => n + (title.includes(w) ? 5 : 1), 0) };
      })
      .filter(Boolean)
      .sort((x, y) => y.score - x.score);
    if (opt.json) return out(hits.map(({ a }) => ({ id: a.id, title: a.title, status: a.status, file: a.file })));
    out(hits.map(({ a }) => `${C.b(a.kind === "adr" ? a.id : "doc ")}  ${color(a)} ${a.title}  ${C.d(a.file)}`).join("\n") || C.d("No match."));
  },

  async lint() {
    const cfg = project();
    const s = await store(cfg);
    const { renderAdr } = await import("../src/render.mjs");
    const problems = [...s.problems];
    for (const a of s.byId.values()) {
      for (const e of renderAdr(a, s, cfg).errors) problems.push({ file: a.file, message: `render: ${e.panel}: ${e.message}`, line: e.line });
      if (a.kind === "adr") {
        if (!a.date) problems.push({ file: a.file, message: "missing date", level: "warn" });
        if (["accepted", "proposed"].includes(a.statusKey) && !a.facts.decision) problems.push({ file: a.file, message: 'no "## Decision" panel with a callout — the UI cannot show the decision', level: "warn" });
        if (a.statusKey === "open" && !a.facts.question) problems.push({ file: a.file, message: 'open ADR without a "## Question" callout', level: "warn" });
        if (!a.tags.length) problems.push({ file: a.file, message: "no tags", level: "warn" });
      }
    }
    if (opt.json) return out(problems);
    const errs = problems.filter((p) => p.level !== "warn");
    for (const p of problems) out(`${p.level === "warn" ? C.y("warn ") : C.r("error")} ${p.file}${p.line ? `:${p.line}` : ""}  ${p.message}`);
    out(problems.length ? `\n${errs.length} error(s), ${problems.length - errs.length} warning(s)` : `${C.g("✓")} ${s.adrs.length} ADRs clean`);
    if (errs.length) process.exitCode = 1;
  },

  async index() {
    const cfg = project();
    const s = await store(cfg);
    const file = join(cfg.abs(cfg.dir), "README.md");
    const rows = s.adrs.map((a) => `| [${a.id}](${a.file.split("/").pop()}) | ${a.title} | ${a.status} | ${a.tags.map((t) => `\`${t}\``).join(" ")} |`);
    const table = `<!-- adr:index:start -->\n| # | Title | Status | Tags |\n|---|---|---|---|\n${rows.join("\n")}\n<!-- adr:index:end -->`;
    let text = existsSync(file) ? readFileSync(file, "utf8") : "# Architecture Decision Records\n\n## Index\n\n";
    text = /<!-- adr:index:start -->[\s\S]*<!-- adr:index:end -->/.test(text) ? text.replace(/<!-- adr:index:start -->[\s\S]*<!-- adr:index:end -->/, table) : `${text.trimEnd()}\n\n${table}\n`;
    writeFileSync(file, text);
    out(`${C.g("✓")} ${rows.length} rows → ${relative(process.cwd(), file)}`);
  },

  async graph() {
    const cfg = project();
    const s = await store(cfg);
    if (opt.json) return out({ nodes: s.adrs.map((a) => ({ id: a.id, title: a.title, status: a.statusKey, tags: a.tags })), edges: s.edges });
    if (opt.mermaid) {
      const arrow = { supersedes: "==>|supersedes|", depends_on: "-->|depends on|", amends: "-->|amends|", relates: "---", mentions: "-.->" };
      return out(["graph LR", ...s.adrs.map((a) => `  A${a.id}["${a.id} ${a.title.replace(/"/g, "'")}"]:::${a.statusKey}`), ...s.edges.filter((e) => /^\d/.test(e.from) && /^\d/.test(e.to)).map((e) => `  A${e.from} ${arrow[e.type] ?? "-->"} A${e.to}`)].join("\n"));
    }
    out(s.edges.map((e) => `${e.from} ${C.d(`─${e.type}→`)} ${e.to}`).join("\n"));
  },

  async tags() {
    const cfg = project();
    const s = await store(cfg);
    const t = Object.entries(s.tags).sort((a, b) => b[1].length - a[1].length);
    if (opt.json) return out(Object.fromEntries(t));
    out(t.map(([k, ids]) => `${pad("#" + k, 24)} ${String(ids.length).padStart(3)}  ${C.d(ids.join(" "))}`).join("\n") || C.d("No tags."));
  },

  async components() {
    const cfg = project({ needConfig: false });
    const { listComponents, loadProjectComponents } = await import("../src/render.mjs");
    const proj = await loadProjectComponents(cfg);
    for (const c of listComponents()) out(`${C.b(pad(c.name, 11))} ${pad(c.origin, 22)} ${c.summary}`);
    for (const p of proj.filter((p) => p.error)) out(C.r(`${p.name}: ${p.summary}`));
  },

  async q() {
    const cfg = project();
    const question = pos.join(" ").trim();
    if (!question) return fail('adr q "Which broker do we use for v1?"');
    const { createDraft } = await import("../src/flow.mjs");
    const r = createDraft(cfg, await store(cfg), { question, notes: opt.context ?? "", due: opt.due ?? "" });
    out(`${C.g("✓")} ${cfg.prefix}-${r.id} draft  ${C.d(r.file)}  ${C.d("(private — only on your laptop)")}`);
    if (opt.notes) {
      const { openNotes } = await import("../src/share/client.mjs");
      const item = await openNotes(cfg, getAdr(cfg, await store(cfg), r.id));
      out(`${C.y("◐")} open for notes: ${C.b(item.url)}`);
    } else out(C.d(`Next: enrich it with your Claude (/adr enrich ${r.id}), or "adr notes ${r.id}" to collect notes from the room.`));
  },

  async notes() {
    const cfg = project();
    const s = await store(cfg);
    const adr = getAdr(cfg, s, pos[0]);
    const share = await import("../src/share/client.mjs");
    if (opt.import) {
      const item = await share.fetchItem(cfg, adr);
      if (!item) return fail(`ADR-${adr.id} has no notes on the share server`);
      const { importNotes } = await import("../src/flow.mjs");
      const n = importNotes(cfg, adr, item.entries.filter((e) => e.kind === "note"));
      return out(`${C.g("✓")} ${n} note(s) added to "## Notes" in ${adr.file}`);
    }
    if (opt.close) {
      await share.setMode(cfg, adr, "closed");
      return out(`${C.g("✓")} notes closed for ADR-${adr.id}`);
    }
    const item = await share.openNotes(cfg, adr);
    out(`${C.y("◐")} ADR-${adr.id} open for notes — share this link in the room:\n  ${C.b(item.url)}\n${C.d("Teammates see the question and your notes so far; nothing else from your draft.")}`);
  },

  async share() {
    const cfg = project();
    const s = await store(cfg);
    const adr = getAdr(cfg, s, pos[0]);
    const share = await import("../src/share/client.mjs");
    if (opt.close) {
      await share.setMode(cfg, adr, "closed");
      return out(`${C.g("✓")} review closed for ADR-${adr.id}`);
    }
    const { setStatus } = await import("../src/flow.mjs");
    if (["draft", "open", "proposed"].includes(adr.statusKey)) setStatus(cfg, adr, "In review");
    const fresh = getAdr(cfg, await store(cfg), adr.id);
    const item = await share.shareReview(cfg, await store(cfg), fresh);
    const q = item.snapshot?.questions ?? [];
    out(`${C.c("◉")} ADR-${adr.id} shared for review (v${item.versions ?? 1}):\n  ${C.b(item.url)}${q.length ? `\n  asks: ${q.map((x) => (x.to ? "@" + x.to : "anyone")).join(", ")}` : ""}\n${C.d("Re-run after edits to update what reviewers see. Their input stays.")}`);
  },

  async pull() {
    const cfg = project();
    const s = await store(cfg);
    const adr = getAdr(cfg, s, pos[0]);
    const share = await import("../src/share/client.mjs");
    const item = await share.fetchItem(cfg, adr);
    if (!item) return fail(`ADR-${adr.id} is not shared. Run "adr share ${adr.id}" or "adr notes ${adr.id}".`);
    const file = share.writeDigest(cfg, adr, item);
    if (opt.json) return out(item);
    const k = (x) => item.entries.filter((e) => e.kind === x).length;
    out(`${C.g("✓")} ${item.entries.length} entries → ${C.b(file.replace(cfg.root + "/", ""))}\n  picks ${k("pick")} · pros ${k("pro")} · cons ${k("con")} · answers ${k("answer")} · comments ${k("comment")} · notes ${k("note")}\n${C.d(`Ask your Claude: /adr digest ${adr.id}`)}`);
  },

  async finalize() {
    const cfg = project();
    const s = await store(cfg);
    const adr = getAdr(cfg, s, pos[0]);
    if (!opt.option) return fail(`adr finalize ${adr.id} --option C [--decision "…"]`);
    const share = await import("../src/share/client.mjs");
    let dissent = [];
    let item = null;
    try {
      item = await share.fetchItem(cfg, adr);
    } catch (err) {
      process.stderr.write(C.y(`! share server: ${err.message} — finalizing without team picks\n`));
    }
    if (item) dissent = item.entries.filter((e) => e.kind === "pick" && e.opt !== opt.option).map((e) => ({ by: e.by, opt: e.opt, why: e.text }));
    const { finalize } = await import("../src/flow.mjs");
    const decision = opt.decision ?? adr.facts.recommendation ?? `Chose option ${opt.option}.`;
    finalize(cfg, adr, { option: opt.option, decision, dissent, reopen: (opt.reopen ?? "").split(";").map((x) => x.trim()).filter(Boolean) });
    if (item) await share.publishFinal(cfg, await store(cfg), getAdr(cfg, await store(cfg), adr.id), { option: opt.option, decision });
    out(`${C.g("✓")} ADR-${adr.id} accepted (option ${opt.option})${dissent.length ? ` · ${dissent.length} dissent recorded` : ""}${item ? " · reviewers see the decision" : ""}\n${C.d(`Edited ${adr.file}. Commit it when you are ready.`)}`);
  },

  async link() {
    const cfg = project();
    const [a, rel, b] = pos;
    if (!b) return fail("adr link 0020 relates 0004");
    const { link } = await import("../src/flow.mjs");
    const changed = link(cfg, await store(cfg), a, rel, b);
    out(changed.length ? `${C.g("✓")} ${changed.join(", ")}` : C.d("already linked"));
  },

  async context() {
    const cfg = project({ needConfig: false });
    const { context } = await import("../src/flow.mjs");
    const list = context(cfg, await store(cfg), pos);
    if (opt.json) return out(list);
    if (!list.length) return out(C.d("No recorded decisions match. If you are about to make one, capture it: adr q \"…?\""));
    for (const d of list) {
      out(`${C.b(`${cfg.prefix}-${d.id}`)} ${d.binding ? C.g("ACCEPTED") : C.y(d.status.toUpperCase())} ${C.b(d.title)}${d.matched.length ? C.d(`  (${d.matched.join(", ")})`) : ""}`);
      if (d.decision) out(`  decided: ${d.decision}`);
      if (d.leaning) out(`  leaning: ${d.leaning}`);
      if (d.question && !d.leaning) out(`  open question: ${d.question}`);
      if (d.rejected.length) out(`  rejected: ${d.rejected.map((r) => r.name + (r.why ? ` — ${r.why}` : "")).join(" · ")}`);
      if (d.reopen_when.length) out(`  reopen when: ${d.reopen_when.join(" · ")}`);
      if (d.links.length) out(C.d(`  links: ${d.links.join(", ")}`));
      out(C.d(`  ${d.file}`));
    }
  },

  async server() {
    const { startShareServer } = await import("../src/share/server.mjs");
    const r = await startShareServer({
      port: Number(opt.port ?? process.env.PORT ?? 8080), host: opt.host ?? process.env.HOST ?? "0.0.0.0", data: opt.data ?? process.env.ADR_DATA ?? "./data",
      tokens: process.env.ADR_TOKENS ?? "", passcode: process.env.ADR_PASSCODE ?? "", publicUrl: process.env.ADR_PUBLIC_URL ?? "",
    });
    out(`${C.g("●")} share server ${C.b(r.url)} · owners: ${r.owners.join(", ") || C.y("none (set ADR_TOKENS)")} · passcode: ${process.env.ADR_PASSCODE ? "on" : C.y("off")}`);
  },

  async login() {
    const url = (pos[0] ?? "").replace(/\/$/, "");
    if (!url || !opt.token) return fail("adr login https://adr.example.com --token <token>");
    const { whoami } = await import("../src/share/client.mjs");
    const handle = await whoami(url, opt.token);
    const { loadUser, saveUser } = await import("../src/config.mjs");
    const u = loadUser();
    u.servers = { ...(u.servers ?? {}), [url]: { token: opt.token, handle } };
    u.me ??= handle;
    saveUser(u);
    const cfg = project({ needConfig: false });
    out(`${C.g("✓")} logged in to ${url} as @${handle}${cfg.share?.replace(/\/$/, "") === url ? "" : `\n${C.d(`Add to adr.config.yaml:  share: ${url}`)}`}`);
  },

  async me() {
    const { loadUser, saveUser } = await import("../src/config.mjs");
    const u = loadUser();
    if (pos[0]) { u.me = pos[0].replace(/^@/, ""); saveUser(u); }
    out(u.me ? `@${u.me}` : C.d('not set — run "adr me <handle>" or "adr login"'));
  },

  async skill() {
    if (pos[0] !== "install") return fail("adr skill install");
    const cfg = project({ needConfig: false });
    const from = join(PKG, "skills");
    const to = join(cfg.root, ".claude/skills");
    for (const name of ["adr", "answer-me-with-html"]) {
      const dest = join(to, name);
      if (existsSync(dest) && !opt.force) { out(C.d(`skip ${name} (exists, --force to overwrite)`)); continue; }
      cpSync(join(from, name), dest, { recursive: true });
      out(`${C.g("✓")} ${relative(process.cwd(), dest)}`);
    }
  },
};

function fail(msg) {
  process.stderr.write(C.r(`✗ ${msg}\n`));
  process.exitCode = 1;
}

if (opt.help || !commands[cmd]) {
  if (!commands[cmd]) fail(`unknown command "${cmd}"`);
  out(HELP);
} else {
  try {
    await commands[cmd]();
  } catch (err) {
    fail(err.message);
  }
}
