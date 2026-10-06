// System components: flows (steps), entities, contracts, element cards and the tech legend.
// They read the project graph from ctx.cfg.site (elements, links, catalog), so a block in any
// file links to the real services and draws them in their catalog colors.
import { sequence } from "./sequence.js";

const ARROW = /^(?:([\w.-]+)\s*:\s+)?(.+?)\s*(-->|->|~>|=>)\s*(.+?)(?:\s+:\s*(.*)|:\s+(.*))?$/;
const BRANCH = /^\?\s*(.+?)\s*(?:->|=>|→)\s*([\w.-]+)\s*$/;
const PHASE = /^==\s*(.+?)\s*(?:==)?$/;
const NOTE = /^note\s*:\s*(.+)$/i;

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cls = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");

function finder(site) {
  const els = site?.elements ?? [];
  const byId = new Map(els.map((e) => [e.id, e]));
  const byKey = new Map();
  for (const e of els) for (const k of [slug(e.id), slug(e.title)]) if (k && !byKey.has(k)) byKey.set(k, e);
  return (x) => byId.get(String(x).trim()) ?? byKey.get(slug(x)) ?? null;
}

const transportOf = (site, word) => {
  const ts = site?.catalog?.transports ?? {};
  const w = String(word ?? "").toLowerCase();
  if (ts[w]) return w;
  for (const [id, t] of Object.entries(ts)) if ((t.aliases ?? []).includes(w)) return id;
  return null;
};

// Same grammar as the Go parser (internal/adr/element.go ParseSteps).
export function parseSteps(text, site) {
  const out = [];
  let phase = "";
  String(text).split("\n").forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith("//") || t.startsWith("#")) return;
    let m;
    if ((m = t.match(PHASE))) { phase = m[1]; out.push({ kind: "phase", text: phase, line: i + 1 }); return; }
    const last = [...out].reverse().find((s) => s.kind === "step");
    if ((m = t.match(BRANCH)) && last) { last.branches.push({ when: m[1], to: m[2] }); return; }
    if ((m = t.match(NOTE)) && last) { last.notes.push(m[1]); return; }
    if (!(m = t.match(ARROW))) return;
    const label = (m[5] ?? m[6] ?? "").trim();
    const first = label.split(/\s+/)[0];
    const tr = label ? transportOf(site, first) : null;
    const mode = tr ? site?.catalog?.transports?.[tr]?.mode : null;
    out.push({ kind: "step", id: m[1] || `s${out.filter((s) => s.kind === "step").length + 1}`, from: m[2].trim(), to: m[4].trim(), async: m[3] === "-->" || m[3] === "~>" || mode === "async" || mode === "stream", transport: tr, name: tr ? label.slice(first.length).trim() : label, label, branches: [], notes: [], phase, line: i + 1 });
  });
  return out;
}

export const steps = {
  name: "steps",
  summary: "A flow: hops between elements with transports, phases, notes and branches; plays back and replays on the map",
  syntax: `\`\`\`steps
== phase ==
id: from -> to : transport name     ← sync hop (-> ) · async hop (-->)
  ? condition -> other-step-id      ← branch from the step above (or -> end)
note: text                          ← note at this point
\`\`\`
- from / to are element ids or names (services, stores, actors, externals).
- The first word after ":" is a transport from the catalog (http, grpc, topic, queue, sql…); the rest names the contract.`,
  example: "```steps\nplace:  customer -> api : http POST /orders\nemit:   orders --> billing : topic order.created\ncharge: billing -> psp : http POST /charges\n  ? declined -> failed\nfailed: billing --> orders : topic payment.failed\n```",
  render(text, opts) {
    const { esc, ComponentError, ctx } = opts;
    const site = ctx?.cfg?.site;
    const find = finder(site);
    const items = parseSteps(text, site);
    const stepItems = items.filter((s) => s.kind === "step");
    if (!stepItems.length) throw new ComponentError("steps needs at least one line like: a -> b : http POST /x", 1);
    const arch = ctx?.cfg?.arch?.nodes ?? {};
    const names = new Map();
    const nameOf = (x) => {
      const e = find(x);
      const n = e ? (e.kind === "contract" ? e.name : e.title) : x;
      if (!names.has(n)) names.set(n, e);
      return n;
    };
    const lines = [];
    for (const it of items) {
      if (it.kind === "phase") { lines.push(`== ${it.text} ==`); continue; }
      const a = nameOf(it.from), b = nameOf(it.to);
      const lbl = [it.transport, it.name || (!it.transport ? it.label : "")].filter(Boolean).join(" ");
      lines.push(`${a} ${it.async ? "-->" : "->"} ${b}: ${lbl}`);
      for (const n of it.notes) lines.push(`note ${a}, ${b}: ${n}`);
      for (const br of it.branches) lines.push(`note ${b}: ◇ ${br.when} → ${br.to}`);
    }
    const links = [...names].filter(([, e]) => e && arch[e.id]).map(([n, e]) => `participant ${n} = ${e.id}`);
    const seq = sequence.render([...links, ...lines].join("\n"), { ...opts, args: "num play" });
    const missing = [...new Set(stepItems.flatMap((s) => [s.from, s.to]).filter((x) => !find(x)))];
    const branches = stepItems.reduce((n, s) => n + s.branches.length, 0);
    const meta = `<div class="ak-steps-meta"><span><b>${stepItems.length}</b> steps</span><span><b>${stepItems.filter((s) => s.async).length}</b> async</span>${branches ? `<span><b>${branches}</b> branches</span>` : ""}${missing.length ? `<span class="ak-steps-miss">not in the system: ${esc(missing.join(", "))}</span>` : ""}</div>`;
    return `<div class="ak-steps">${meta}${seq}</div>`;
  },
};

// entity: one field per line — name  type  notes (pk, fk target, unique, required, enum a | b).
export const entity = {
  name: "entity",
  summary: "Entity fields: name, type, keys, references and rules",
  syntax: `\`\`\`entity [Title]
id          uuid      pk
customer_id uuid      fk customer
status      enum      pending | paid | failed
total       money     frozen at create
lines       order-line[]  1..n
\`\`\`
- Columns split on whitespace: name, type, then notes. pk, fk <entity>, unique, required and enum values (a | b) get badges.`,
  example: "```entity\nid uuid pk\nstatus enum pending | paid\ntotal money\n```",
  render(text, { args, esc, ComponentError, ctx }) {
    const find = finder(ctx?.cfg?.site);
    const rows = String(text).split("\n").map((l, i) => ({ t: l.trim(), line: i + 1 })).filter((l) => l.t && !l.t.startsWith("//"));
    if (!rows.length) throw new ComponentError("entity needs at least one field: name type", 1);
    const link = (name) => {
      const base = name.replace(/\[\]$/, "");
      const e = find(base);
      return e && e.kind === "entity" ? `<a href="#/el/${encodeURIComponent(e.id)}" data-el="${esc(e.id)}">${esc(name)}</a>` : esc(name);
    };
    const body = rows.map(({ t }) => {
      const [name, type = "", ...rest] = t.split(/\s+/);
      let note = rest.join(" ");
      const badges = [];
      note = note.replace(/\bpk\b/i, () => (badges.push(`<b class="ak-ent-b pk">PK</b>`), "")).replace(/\bunique\b/i, () => (badges.push(`<b class="ak-ent-b">UNIQUE</b>`), "")).replace(/\brequired\b/i, () => (badges.push(`<b class="ak-ent-b">REQ</b>`), ""));
      note = note.replace(/\bfk\s+([\w.-]+)/i, (_, x) => (badges.push(`<b class="ak-ent-b fk">FK</b> ${link(x)}`), ""));
      let enumHtml = "";
      if (/\|/.test(note)) { enumHtml = note.split("|").map((v) => `<span class="ak-ent-enum">${esc(v.trim())}</span>`).join(""); note = ""; }
      return `<tr><td class="ak-ent-name">${esc(name)}</td><td class="ak-ent-type">${link(type)}</td><td>${badges.join(" ")} ${enumHtml}${note.trim() ? `<span class="ak-ent-note">${esc(note.trim())}</span>` : ""}</td></tr>`;
    }).join("");
    const title = args.trim() || (ctx?.adr?.kind === "entity" ? ctx.adr.title : "");
    return `<figure class="ak-entity">${title ? `<figcaption><span>ENTITY</span>${esc(title)}</figcaption>` : ""}<table><tbody>${body}</tbody></table></figure>`;
  },
};

// contract: key: value lines; payload becomes field chips. On a contract page it also shows
// who produces and who consumes it.
export const contract = {
  name: "contract",
  summary: "Contract card: key facts, payload fields, producers and consumers",
  syntax: `\`\`\`contract [topic:order.created]
key: order_id
retention: 7d
payload: order_id uuid, total money, lines[]
\`\`\`
- On a crux: contract file the producers and consumers come from the graph.`,
  example: "```contract\nkey: order_id\npayload: order_id uuid, total money\n```",
  render(text, { args, esc, ctx }) {
    const site = ctx?.cfg?.site;
    const find = finder(site);
    const kv = String(text).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(":"); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, ""]; });
    const id = args.trim() || (ctx?.adr?.kind === "contract" ? ctx.adr.id : "");
    const c = (site?.elements ?? []).find((e) => e.id === id) ?? null;
    const chip = (eid) => { const e = find(eid); return e ? `<a class="ak-el k-${esc(e.kind)}" href="#/el/${encodeURIComponent(e.id)}" data-el="${esc(e.id)}"><span>${esc(e.title)}</span></a>` : ""; };
    const links = site?.links ?? [];
    const prod = c ? [...new Set(links.filter((l) => l.to === c.id && (l.type === "exposes" || l.type === "publishes")).map((l) => l.from))] : [];
    const cons = c ? [...new Set(links.filter((l) => l.to === c.id && (l.type === "uses" || l.type === "consumes")).map((l) => l.from))] : [];
    const cells = kv.map(([k, v]) => {
      if (/^(payload|fields|body)$/i.test(k)) return `<div class="ak-ct-row ak-ct-row--wide"><dt>${esc(k)}</dt><dd>${v.split(",").map((f) => f.trim()).filter(Boolean).map((f) => { const [n, ...t] = f.split(/\s+/); return `<span class="ak-ct-field"><b>${esc(n)}</b>${t.length ? ` ${esc(t.join(" "))}` : ""}</span>`; }).join("")}</dd></div>`;
      return `<div class="ak-ct-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
    }).join("");
    const sides = c ? `<div class="ak-ct-sides"><div><span>${c.transport === "topic" || c.transport === "queue" ? "published by" : "provided by"}</span>${prod.map(chip).join("") || "—"}</div><div><span>${c.transport === "topic" || c.transport === "queue" ? "consumed by" : "used by"}</span>${cons.map(chip).join("") || "—"}</div></div>` : "";
    return `<figure class="ak-ct">${c ? `<figcaption><b class="ak-tr">${esc(c.transport)}</b>${esc(c.name)}</figcaption>` : ""}<dl>${cells}</dl>${sides}</figure>`;
  },
};

// element: cards for named elements, with tech icons and their connection counts.
export const element = {
  name: "element",
  summary: "Embedded cards for services, stores, contracts or flows",
  syntax: "```element orders billing kafka\n```\n- Ids or names in the fence line or the body, one per line.",
  example: "```element orders billing\n```",
  render(text, { args, esc, ComponentError, ctx }) {
    const site = ctx?.cfg?.site;
    const find = finder(site);
    const icon = ctx?.cfg?.techIcon ?? (() => "");
    const ids = `${args} ${text}`.split(/[\s,]+/).filter(Boolean);
    if (!ids.length) throw new ComponentError("element needs at least one id", 1);
    const links = site?.links ?? [];
    return `<div class="ak-elcards">${ids.map((x) => {
      const e = find(x);
      if (!e) return `<div class="ak-elcard is-missing">${esc(x)} — not in the system</div>`;
      const t = e.tech?.[0];
      const out = links.filter((l) => l.from === e.id && ["calls", "publishes", "writes", "reads"].includes(l.type) && !l.implied).length;
      const inn = links.filter((l) => l.to === e.id && ["calls", "reads", "writes", "consumes", "uses"].includes(l.type)).length;
      return `<a class="ak-elcard k-${esc(e.kind)}${t ? ` tech tech-${cls(t)}` : ""}" href="#/el/${encodeURIComponent(e.id)}" data-el="${esc(e.id)}"><span class="ak-elcard-k">${esc(e.kind === "contract" ? e.transport : e.kind).toUpperCase()}</span><b>${t ? icon(t, 15) : ""}${esc(e.kind === "contract" ? e.name : e.title)}</b>${e.subtitle ? `<small>${esc(e.subtitle)}</small>` : ""}<span class="ak-elcard-f">${(e.tech ?? []).map((x) => `<span class="tech tech-${cls(x)}">${icon(x, 12)}</span>`).join("")}<em>← ${inn} · ${out} →</em></span></a>`;
    }).join("")}</div>`;
  },
};

// catalog: legend of technologies — the listed ids, or every one used in the project.
export const catalogLegend = {
  name: "catalog",
  summary: "Legend of the technologies in use (or the ones listed), with icons and categories",
  syntax: "```catalog [go postgres kafka]\n```",
  example: "```catalog\n```",
  render(text, { args, esc, ctx }) {
    const site = ctx?.cfg?.site;
    const icon = ctx?.cfg?.techIcon ?? (() => "");
    const tech = site?.catalog?.tech ?? {};
    let ids = `${args} ${text}`.split(/[\s,]+/).filter(Boolean);
    if (!ids.length) ids = [...new Set((site?.elements ?? []).flatMap((e) => e.tech ?? []))];
    const cats = site?.catalog?.categories ?? {};
    const by = new Map();
    for (const id of ids) { const t = tech[id] ?? { label: id, category: "other" }; const c = cats[t.category]?.label ?? t.category; if (!by.has(c)) by.set(c, []); by.get(c).push([id, t]); }
    return `<div class="ak-catalog">${[...by].map(([c, xs]) => `<div class="ak-catalog-g"><span>${esc(c)}</span>${xs.map(([id, t]) => `<span class="ak-tech tech tech-${cls(id)}">${icon(id, 13)}${esc(t.label)}</span>`).join("")}</div>`).join("")}</div>`;
  },
};
