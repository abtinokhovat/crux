// Scans the project's markdown and builds the in-memory index:
// ADRs, extra docs, tags, relation graph and the architecture map.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import YAML from "yaml";
import { md } from "./am.mjs";
import { asList, parseAdr, plainText, refId, statusKey } from "./parse.mjs";

export const RELATIONS = {
  supersedes: { label: "supersedes", inverse: "superseded by" },
  superseded_by: { label: "superseded by", inverse: "supersedes" },
  depends_on: { label: "depends on", inverse: "required by" },
  amends: { label: "amends", inverse: "amended by" },
  relates: { label: "relates to", inverse: "relates to" },
  mentions: { label: "mentions", inverse: "mentioned by" },
};
const REL_ALIASES = { "superseded-by": "superseded_by", supersededby: "superseded_by", "depends-on": "depends_on", depends: "depends_on", related: "relates", relates_to: "relates" };

const ADR_FILE = /^(\d{1,6})-([\w.-]+)\.md$/;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.name.startsWith(".") || e.name === "node_modules") return [];
    return e.isDirectory() ? walk(p) : e.name.endsWith(".md") ? [p] : [];
  });
}

const cleanTitle = (title, id, prefix) =>
  String(title ?? "").replace(new RegExp(`^\\s*${prefix}[-\\s]?0*${Number(id)}\\s*[—–:-]\\s*`, "i"), "").trim();

function mentionsIn(body, cfg, self) {
  const ids = new Set();
  const re = new RegExp(`\\b${cfg.prefix}[-\\s]?(\\d{1,6})\\b`, "gi");
  for (const m of body.matchAll(re)) ids.add(refId(m[1], cfg.digits));
  for (const m of body.matchAll(/\]\((?:[^)]*\/)?(\d{1,6})-[\w.-]+\.(?:md|html)\)/g)) ids.add(refId(m[1], cfg.digits));
  ids.delete(self);
  return [...ids];
}

function readAdr(file, cfg) {
  const name = basename(file);
  const [, num, slug] = name.match(ADR_FILE);
  const id = refId(num, cfg.digits);
  const source = readFileSync(file, "utf8");
  const parsed = parseAdr(source);
  const { meta, facts } = parsed;
  const rel = {};
  for (const [k, v] of Object.entries(meta)) {
    const key = REL_ALIASES[k.toLowerCase()] ?? k.toLowerCase();
    if (RELATIONS[key] && key !== "mentions") rel[key] = asList(v).map((x) => refId(x, cfg.digits)).filter(Boolean);
  }
  const status = String(meta.status ?? "Proposed");
  const sup = status.match(/superseded\s+by\s+(?:\w+-)?(\d+)/i);
  if (sup) rel.superseded_by = [...new Set([...(rel.superseded_by ?? []), refId(sup[1], cfg.digits)])];
  return {
    kind: "adr",
    id,
    num: Number(num),
    slug,
    file: relative(cfg.root, file),
    mtime: statSync(file).mtimeMs,
    title: cleanTitle(meta.title || slug.replace(/-/g, " "), num, cfg.prefix),
    subtitle: meta.subtitle ?? "",
    status,
    statusKey: statusKey(status),
    date: meta.date ? String(meta.date instanceof Date ? meta.date.toISOString().slice(0, 10) : meta.date) : "",
    author: meta.author ?? meta.authors ?? "",
    tags: asList(meta.tags).map((t) => t.toLowerCase()),
    components: asList(meta.components ?? meta.component),
    rel,
    mentions: mentionsIn(parsed.body, cfg, id),
    facts,
    sections: parsed.panels.map((p) => ({ id: p.id, title: p.title })),
    text: plainText(parsed.body),
    source,
  };
}

function readDoc(file, cfg) {
  const source = readFileSync(file, "utf8");
  const parsed = parseAdr(source);
  const rel = relative(cfg.root, file);
  const heading = parsed.body.match(/^#\s+(.+)$/m)?.[1];
  return {
    kind: "doc",
    id: `doc:${rel}`,
    file: rel,
    mtime: statSync(file).mtimeMs,
    title: parsed.meta.title || heading || basename(file, ".md"),
    subtitle: parsed.meta.subtitle ?? "",
    status: parsed.meta.status ?? "",
    statusKey: parsed.meta.status ? statusKey(parsed.meta.status) : "doc",
    date: parsed.meta.date ? String(parsed.meta.date) : "",
    tags: asList(parsed.meta.tags).map((t) => t.toLowerCase()),
    components: asList(parsed.meta.components),
    rel: {},
    mentions: mentionsIn(parsed.body, cfg, null),
    facts: parsed.facts,
    sections: parsed.panels.map((p) => ({ id: p.id, title: p.title })),
    text: plainText(parsed.body),
    source,
  };
}

// "a -> b: label", "a --> b" (dashed), "a <-> b" (both ways) or { from, to, label }.
function parseEdge(e) {
  // YAML reads "- a -> b: label" as { "a -> b": "label" }.
  if (e && typeof e === "object" && !("from" in e)) {
    const [k] = Object.keys(e);
    if (!k) return null;
    e = e[k] == null ? k : `${k}: ${e[k]}`;
  }
  if (typeof e !== "string") return { from: String(e.from), to: String(e.to), label: e.label ?? "", dashed: !!e.dashed, both: !!e.both, sel: !!e.sel, lp: e.lp ?? null, lo: e.lo ?? null };
  const m = e.match(/^\s*(.+?)\s*(<->|-->|->)\s*(.+?)\s*(?::\s*(.*))?$/);
  if (!m) return null;
  return { from: m[1], to: m[3], label: m[4] ?? "", dashed: m[2] === "-->", both: m[2] === "<->" };
}

function loadArchitecture(cfg, adrs, problems) {
  const file = cfg.abs(cfg.architecture);
  if (!existsSync(file)) return null;
  let raw;
  try {
    raw = YAML.parse(readFileSync(file, "utf8")) ?? {};
  } catch (err) {
    problems.push({ file: cfg.architecture, message: `architecture: ${err.message}` });
    return null;
  }
  const nodes = {};
  const edges = [];
  const visit = (list, parent) => {
    for (const n of list ?? []) {
      if (!n?.id) { problems.push({ file: cfg.architecture, message: `node without id under ${parent ?? "root"}` }); continue; }
      nodes[n.id] = {
        id: String(n.id),
        label: n.label ?? n.id,
        kind: n.kind ?? "component",
        sub: n.sub ?? "",
        desc: n.desc ?? "",
        descHtml: n.desc ? md(String(n.desc)) : "",
        tags: asList(n.tags).map((t) => t.toLowerCase()),
        parent,
        children: (n.children ?? []).map((c) => String(c.id)),
        adrs: asList(n.adrs).map((x) => refId(x, cfg.digits)),
        docs: asList(n.docs),
        at: n.at ?? null,
        // Optional manual geometry (pixels), like a hand-drawn map: x, y, w, h. Tag overrides the kind label.
        x: n.x ?? null, y: n.y ?? null, w: n.w ?? null, h: n.h ?? null,
        tag: n.tag ?? null,
        // Dashed frames around some children at this node's zoom level: [{ label, nodes: [ids] }]
        groups: (n.groups ?? []).map((g) => ({ label: g.label ?? "", nodes: asList(g.nodes) })),
      };
      for (const e of n.edges ?? []) { const pe = parseEdge(e); if (pe) edges.push(pe); }
      visit(n.children, String(n.id));
    }
  };
  visit(raw.nodes, null);
  for (const e of raw.edges ?? []) { const pe = parseEdge(e); if (pe) edges.push(pe); }
  for (const e of edges) for (const end of [e.from, e.to]) if (!nodes[end]) problems.push({ file: cfg.architecture, message: `edge references unknown node "${end}"` });

  // Link both ways: node.adrs in YAML and adr.components in frontmatter.
  for (const a of adrs) {
    for (const c of a.components) {
      if (!nodes[c]) { problems.push({ file: a.file, message: `component "${c}" is not in ${cfg.architecture}` }); continue; }
      if (!nodes[c].adrs.includes(a.id)) nodes[c].adrs.push(a.id);
    }
  }
  for (const n of Object.values(nodes)) {
    for (const id of n.adrs) {
      const a = adrs.find((x) => x.id === id);
      if (a && !a.components.includes(n.id)) a.components.push(n.id);
    }
  }
  const deep = (id) => {
    const n = nodes[id];
    if (n.deep) return n.deep;
    n.deep = [...new Set([...n.adrs, ...n.children.flatMap(deep)])];
    return n.deep;
  };
  Object.keys(nodes).forEach(deep);
  return {
    groups: (raw.groups ?? []).map((g) => ({ label: g.label ?? "", nodes: asList(g.nodes) })),
    title: raw.title ?? "Architecture",
    desc: raw.desc ?? "",
    roots: (raw.nodes ?? []).map((n) => String(n.id)),
    nodes,
    edges,
  };
}

export function loadStore(cfg) {
  const problems = [];
  const adrDir = cfg.abs(cfg.dir);
  const adrs = [];
  for (const f of existsSync(adrDir) ? readdirSync(adrDir) : []) {
    if (!ADR_FILE.test(f)) continue;
    try {
      adrs.push(readAdr(join(adrDir, f), cfg));
    } catch (err) {
      problems.push({ file: relative(cfg.root, join(adrDir, f)), message: err.message, line: err.line });
    }
  }
  adrs.sort((a, b) => a.num - b.num);

  const docs = [];
  for (const d of cfg.docs) {
    for (const f of walk(cfg.abs(d))) {
      if (f.startsWith(adrDir) && ADR_FILE.test(basename(f))) continue;
      try {
        docs.push(readDoc(f, cfg));
      } catch (err) {
        problems.push({ file: relative(cfg.root, f), message: err.message });
      }
    }
  }

  const byId = new Map(adrs.map((a) => [a.id, a]));
  for (const a of adrs) {
    for (const [type, ids] of Object.entries(a.rel)) for (const t of ids) if (!byId.has(t)) problems.push({ file: a.file, message: `${type}: ${cfg.prefix}-${t} does not exist` });
    for (const t of a.mentions) if (!byId.has(t)) problems.push({ file: a.file, message: `mentions ${cfg.prefix}-${t}, which does not exist` });
    if (!cfg.statuses[a.statusKey]) problems.push({ file: a.file, message: `unknown status "${a.status}" (known: ${Object.values(cfg.statuses).map((s) => s.label).join(", ")})` });
  }

  // Graph edges. Explicit relations win over plain mentions for the same pair.
  const edges = [];
  const seen = new Set();
  const pair = (a, b) => [a, b].sort().join("|");
  const all = [...adrs, ...docs];
  const known = new Set(all.map((x) => x.id));
  for (const a of adrs) {
    for (const [type, ids] of Object.entries(a.rel)) {
      for (const t of ids) {
        if (!known.has(t)) continue;
        const [from, to, kind] = type === "superseded_by" ? [t, a.id, "supersedes"] : [a.id, t, type];
        const k = `${from}>${to}>${kind}`;
        if (seen.has(k)) continue;
        seen.add(k);
        seen.add(pair(from, to));
        edges.push({ from, to, type: kind });
      }
    }
  }
  for (const a of all) {
    for (const t of a.mentions) {
      if (!known.has(t) || seen.has(pair(a.id, t))) continue;
      seen.add(pair(a.id, t));
      edges.push({ from: a.id, to: t, type: "mentions" });
    }
  }

  const architecture = loadArchitecture(cfg, adrs, problems);

  const tags = {};
  for (const x of all) for (const t of x.tags) (tags[t] ??= []).push(x.id);
  if (architecture) for (const n of Object.values(architecture.nodes)) for (const t of n.tags) tags[t] ??= [];

  return { adrs, docs, edges, tags, architecture, problems, byId: new Map(all.map((x) => [x.id, x])) };
}

export function nextNumber(store) {
  return store.adrs.reduce((m, a) => Math.max(m, a.num), 0) + 1;
}

// Summary sent to the browser (no raw source).
export function siteData(cfg, store) {
  const strip = ({ source, ...rest }) => rest;
  return {
    title: cfg.title,
    prefix: cfg.prefix,
    statuses: cfg.statuses,
    tagInfo: cfg.tags,
    relations: RELATIONS,
    adrs: store.adrs.map(strip),
    docs: store.docs.map(strip),
    edges: store.edges,
    tags: store.tags,
    architecture: store.architecture,
    problems: store.problems,
  };
}
