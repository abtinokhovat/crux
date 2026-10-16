// The system side of crux: elements (services, stores, contracts, entities, flows, questions,
// sessions, conventions), styled from the catalog. Views: system index, element page, flows,
// questions, sessions; plus chips, icons and the local connection diagram other views reuse.
import { trackFromSteps } from "./track.js";
import { $, S, ancestors, childrenOf, elAncestors, esc, gist, href, isElement, label, linksIn, linksOut, pill, refChip, statusLabel, tagChip } from "./util.js";
import { panel, sheet, titleBlock } from "./blueprint.js";
import { ICONS } from "./vendor/icons.js";
import { entityRelations, homeHtml } from "./model.js";

// ── catalog: colors, icons, kinds ─────────────────────────
export const techOf = (id) => S.site.catalog?.tech?.[id] ?? { id, label: id, color: "", category: "" };
const cls = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");

// Each technology gets --tc (its color) and --tc-bg (a tint), so any element with .tech-<id>
// is colored by it: map boxes, chips, sequence participants, folder markers.
export function injectCatalogCss() {
  const tech = S.site.catalog?.tech ?? {};
  const css = Object.entries(tech)
    .filter(([, t]) => t.color)
    .map(([id, t]) => `.tech-${cls(id)}{--tc:${t.color};--tc-bg:color-mix(in srgb, ${t.color} 9%, var(--paper))}`)
    .join("\n");
  let el = $("#ak-catalog-css");
  if (!el) document.head.append((el = Object.assign(document.createElement("style"), { id: "ak-catalog-css" })));
  el.textContent = css;
}

// 24×24 Simple Icons path, or a monogram when the catalog has no icon for it.
export function techIcon(id, size = 14) {
  const t = techOf(id);
  const path = t.icon && ICONS[t.icon];
  if (path) return `<svg class="ak-ticon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const letters = String(t.label || id).replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "?";
  return `<svg class="ak-ticon ak-ticon--mono" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22"/><text x="12" y="16.5" text-anchor="middle">${esc(letters)}</text></svg>`;
}
export const techPath = (id) => ICONS[techOf(id).icon] ?? null;

export const techChip = (id) => {
  const t = techOf(id);
  return `<span class="ak-tech tech tech-${cls(id)}" title="${esc(`${t.label}${t.category ? ` · ${S.site.catalog?.categories?.[t.category]?.label ?? t.category}` : ""}`)}">${techIcon(id, 13)}${esc(t.label || id)}</span>`;
};

// Kind glyphs: 16×16 line drawings, one per kind.
const GLYPH = {
  system: '<rect x="1.5" y="1.5" width="13" height="13"/><rect x="4" y="4" width="8" height="8"/>',
  context: '<rect x="1.5" y="2.5" width="13" height="11" stroke-dasharray="2 1.5"/><path d="M4 6h8M4 9h5"/>',
  service: '<rect x="2" y="3" width="12" height="10"/><path d="M2 6h12"/><rect x="3.5" y="4" width="1" height="1"/>',
  app: '<rect x="4" y="1.5" width="8" height="13"/><path d="M7 12.5h2"/>',
  module: '<rect x="2" y="3" width="12" height="10"/><path d="M5 3v10"/>',
  library: '<path d="M3 2.5v11M6 2.5v11M9.5 3l3 10.5"/>',
  job: '<rect x="2" y="2" width="12" height="12"/><path d="M8 4.5V8h3"/>',
  actor: '<rect x="5.5" y="2" width="5" height="5"/><path d="M3 14l1.5-5h7L13 14z"/>',
  external: '<rect x="2" y="3" width="12" height="10" stroke-dasharray="2.2 1.6"/><path d="M6 10l4-4M7 6h3v3"/>',
  store: '<rect x="2.5" y="2" width="11" height="12"/><path d="M2.5 5h11M2.5 8.5h11"/>',
  cache: '<rect x="2.5" y="2" width="11" height="12"/><path d="M2.5 5h11"/><path d="M8.5 6.5L6.5 9.5h3l-2 3"/>',
  broker: '<rect x="1.5" y="5" width="13" height="6"/><path d="M5 8h6M9 6.5L11 8 9 9.5"/>',
  gateway: '<path d="M8 1.5l5.5 2.5v5L8 14.5 2.5 9V4z"/>',
  infra: '<rect x="2" y="2.5" width="12" height="4"/><rect x="2" y="9.5" width="12" height="4"/><rect x="4" y="4" width="1" height="1"/><rect x="4" y="11" width="1" height="1"/>',
  contract: '<path d="M2 8h4M10 8h4"/><rect x="6" y="5" width="4" height="6"/>',
  entity: '<rect x="2" y="2.5" width="12" height="11"/><path d="M2 6h12M2 9.5h12M6 6v7.5"/>',
  flow: '<rect x="1.5" y="6.5" width="3" height="3"/><rect x="11.5" y="2.5" width="3" height="3"/><rect x="11.5" y="10.5" width="3" height="3"/><path d="M4.5 8H8V4h3.5M8 8v4h3.5"/>',
  question: '<rect x="1.5" y="1.5" width="13" height="13"/><path d="M5.5 5V3.8h5V7.5H8v2"/><rect x="7.5" y="11" width="1" height="1"/>',
  session: '<rect x="2" y="3" width="12" height="11"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3"/>',
  convention: '<path d="M3 2.5h10v11H3zM5.5 6h5M5.5 8.5h5M5.5 11h3"/>',
  adr: '<path d="M3 2.5h7l3 3v8H3z"/><path d="M5.5 9l1.8 1.8 3.4-3.6"/>',
  doc: '<path d="M3 2.5h7l3 3v8H3z"/><path d="M5.5 7.5h5M5.5 10h5"/>',
};
export const kindGlyph = (kind, size = 14) => `<svg class="ak-kg" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${GLYPH[kind] ?? GLYPH.service}</svg>`;

const KIND_NAME = { system: "System", context: "Context", service: "Service", app: "App", module: "Module", library: "Library", job: "Job", actor: "Actor", external: "External", store: "Store", broker: "Broker", cache: "Cache", gateway: "Gateway", infra: "Infra", contract: "Contract", entity: "Entity", flow: "Flow", question: "Question", session: "Session", convention: "Convention", adr: "Decision", doc: "Doc" };
export const kindName = (k) => KIND_NAME[k] ?? k;
const MODE_NAME = { sync: "sync call", async: "async event", stream: "stream", data: "data access", trigger: "trigger" };

const CODE_KINDS = new Set(["service", "app", "job", "library", "module"]);
const LANGLIKE = new Set(["language", "runtime", "framework", "protocol", "observability"]);
// The tech that colors an element: infrastructure tech for infra; the first non-language tech
// otherwise, else the language (code kinds keep a neutral frame in CSS either way).
const mainTech = (e) => {
  const ts = e?.tech ?? [];
  if (!ts.length) return undefined;
  if (CODE_KINDS.has(e.kind)) return ts[0];
  return ts.find((t) => !LANGLIKE.has(techOf(t).category)) ?? ts[0];
};
const elName = (e) => (e.kind === "contract" ? e.name || e.title : e.title);

// A chip for any element: kind glyph (or its main tech icon), name, colored by tech.
export function elChip(e, { sub = "", step } = {}) {
  if (!e) return "";
  if (!isElement(e)) return refChip(e);
  const t = mainTech(e);
  const icon = e.kind === "contract" ? `<b class="ak-el-tr m-${esc(modeOfTransport(e.transport))}">${esc(e.transport || "api")}</b>` : t && e.kind !== "service" ? techIcon(t, 13) : kindGlyph(e.kind, 13);
  const q = openQuestionsFor(e.id).length;
  return `<a class="ak-el k-${esc(e.kind)}${t ? ` tech tech-${cls(t)}` : ""}${e.origin === "inferred" ? " is-inferred" : ""}" href="${href(e)}${step ? `?step=${encodeURIComponent(step)}` : ""}" data-el="${esc(e.id)}">${icon}<span>${esc(elName(e))}</span>${sub ? `<small>${esc(sub)}</small>` : ""}${q ? `<i class="ak-el-q" title="${q} open question${q > 1 ? "s" : ""}">?</i>` : ""}</a>`;
}

export const modeOfTransport = (t) => S.site.catalog?.transports?.[t]?.mode ?? "sync";
export const transportChip = (t, mode) => (t ? `<span class="ak-tr m-${esc(mode ?? modeOfTransport(t))}">${esc(S.site.catalog?.transports?.[t]?.label ?? t)}</span>` : "");

// ── graph queries ─────────────────────────────────────────
export const elements = () => S.site.elements ?? [];
export const byKind = (...kinds) => elements().filter((e) => kinds.includes(e.kind));
export const flowsThrough = (id) => byKind("flow").filter((f) => (f.steps ?? []).some((s) => s.fromId === id || s.toId === id || s.contract === id));
export function questionsFor(id) {
  const ids = new Set([...linksOut(id, "blocked_by").map((l) => l.to), ...linksIn(id, "blocks").map((l) => l.from), ...linksIn(id, "raised_from").map((l) => l.from)]);
  return [...ids].map((x) => S.byId.get(x)).filter((q) => q?.kind === "question");
}
export const openQuestionsFor = (id) => questionsFor(id).filter((q) => q.state !== "answered");
export function decisionsFor(id) {
  const ids = new Set(linksOut(id, "decided_by").map((l) => l.to));
  for (const a of S.site.adrs) if (a.components?.includes(id)) ids.add(a.id);
  return [...ids].map((x) => S.byId.get(x)).filter(Boolean).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
// Contract producers (exposes/publishes) and consumers (uses/consumes).
export function contractSides(id) {
  const prod = linksIn(id, "exposes", "publishes").map((l) => S.byId.get(l.from)).filter(Boolean);
  const cons = linksIn(id, "uses", "consumes").map((l) => S.byId.get(l.from)).filter(Boolean);
  return { prod: uniq(prod), cons: uniq(cons) };
}
const uniq = (xs) => [...new Map(xs.map((x) => [x.id, x])).values()];

// Everything downstream (what this element calls, writes, publishes to and who consumes it) and
// upstream (who calls or feeds it), walked over the element links.
export function impactOf(id) {
  const FLOW = ["calls", "publishes", "writes", "reads", "uses", "consumes", "depends_on"];
  const next = (x, dir) => {
    const out = [];
    for (const l of dir === "down" ? linksOut(x) : linksIn(x)) {
      if (!FLOW.includes(l.type)) continue;
      let y = dir === "down" ? l.to : l.from;
      if (l.type === "consumes") y = dir === "down" ? null : l.to; // a consumer depends on its topic
      if (l.type === "reads" && dir === "down") continue; // reading does not push change downstream
      if (y) out.push(y);
    }
    if (dir === "down") for (const l of linksIn(x, "consumes")) out.push(l.from); // topic → its consumers
    if (dir === "down") for (const l of linksIn(x, "uses")) out.push(l.from); // endpoint → its clients (they break if it changes)
    return out;
  };
  const walk = (dir) => {
    const seen = new Map();
    let frontier = [id];
    for (let depth = 1; frontier.length && depth < 6; depth++) {
      const nxt = [];
      for (const x of frontier) for (const y of next(x, dir)) if (y !== id && !seen.has(y)) { seen.set(y, depth); nxt.push(y); }
      frontier = nxt;
    }
    return [...seen].map(([x, d]) => ({ e: S.byId.get(x), d })).filter((x) => x.e && x.e.kind !== "contract");
  };
  // changing a service also changes the contracts it exposes; their clients are downstream
  return { down: walk("down"), up: walk("up") };
}

// What is missing on an element: the "don't miss anything" checklist.
export function gaps(e) {
  const out = [];
  const code = ["service", "app", "job", "library", "module"].includes(e.kind);
  if (e.origin === "inferred") out.push({ k: "warn", t: `Inferred${e.confidence ? ` (${e.confidence} confidence)` : ""} — confirm or correct it` });
  if (!e.subtitle && !e.implied) out.push({ k: "info", t: "No summary line" });
  if (code && !e.code?.length) out.push({ k: "info", t: "No code path (code:)" });
  if (["service", "app", "job"].includes(e.kind) && !e.owner) out.push({ k: "info", t: "No owner" });
  if (["service", "store", "broker", "app", "gateway"].includes(e.kind) && !decisionsFor(e.id).length) out.push({ k: "info", t: "No decision linked (decided_by:)" });
  if (["service", "app", "job"].includes(e.kind) && !flowsThrough(e.id).length) out.push({ k: "info", t: "Not part of any flow" });
  if (e.kind === "contract") {
    const { prod, cons } = contractSides(e.id);
    if (!prod.length) out.push({ k: "warn", t: "Nobody exposes or publishes it" });
    if (!cons.length) out.push({ k: "info", t: "Nobody uses or consumes it" });
  }
  if (e.kind === "flow") {
    if (!e.trigger) out.push({ k: "info", t: "No trigger" });
    if (!e.outcome) out.push({ k: "info", t: "No outcome" });
    if (!e.steps?.length) out.push({ k: "warn", t: "No steps block" });
  }
  if (e.kind === "entity" && !e.parent) out.push({ k: "info", t: "No owner (owns: on a service, or in:)" });
  if (e.kind === "entity" && e.parent && !e.store) out.push({ k: "info", t: "No store found (stored_in:)" });
  const oq = openQuestionsFor(e.id).length;
  if (oq) out.push({ k: "warn", t: `${oq} open question${oq > 1 ? "s" : ""}` });
  const seenMsg = new Set(out.map((x) => x.t));
  for (const f of (S.site.lint ?? []).filter((f) => f.element === e.id || (f.file && f.file === e.file && !f.element))) {
    if (f.rule === "inferred" || seenMsg.has(f.message)) continue;
    seenMsg.add(f.message);
    out.push({ k: f.level === "error" ? "err" : f.level, t: f.message, fix: f.fix });
  }
  return out;
}

// ── local connection diagram ──────────────────────────────
// Left: what comes in (callers, publishers, topics it consumes). Right: what goes out (what it
// calls, writes, publishes). Lines styled by mode; labels are the contracts.
export function egoMap(e) {
  const ins = new Map(), outs = new Map();
  const put = (m, other, l, label) => {
    if (!other || other.id === e.id) return;
    const k = other.id;
    if (!m.has(k)) m.set(k, { e: other, labels: [], modes: new Set(), types: new Set() });
    const x = m.get(k);
    if (label && !x.labels.includes(label)) x.labels.push(label);
    x.modes.add(l.mode || "sync");
    x.types.add(l.type);
  };
  const lbl = (l) => l.label || (l.via ? S.byId.get(l.via)?.name : "") || (l.mode === "data" ? l.type : "");
  if (e.kind === "contract") {
    for (const l of linksIn(e.id, "exposes", "publishes")) put(ins, S.byId.get(l.from), { ...l, mode: e.transport ? modeOfTransport(e.transport) : "sync" }, l.type);
    for (const l of linksIn(e.id, "uses", "consumes")) put(outs, S.byId.get(l.from), { ...l, mode: e.transport ? modeOfTransport(e.transport) : "sync" }, l.type);
  } else {
    for (const l of linksOut(e.id)) {
      if (["calls", "reads", "writes", "depends_on", "runs_on", "implements"].includes(l.type)) put(outs, S.byId.get(l.to), l, lbl(l));
      else if (l.type === "publishes" && !l.implied) put(outs, S.byId.get(l.to), l, "");
      else if (l.type === "consumes") put(ins, S.byId.get(l.to), { ...l, mode: "async" }, "");
    }
    for (const l of linksIn(e.id)) {
      if (l.type === "calls") put(ins, S.byId.get(l.from), l, lbl(l));
      else if (["reads", "writes"].includes(l.type)) put(ins, S.byId.get(l.from), l, l.type);
      else if (l.type === "depends_on") put(ins, S.byId.get(l.from), l, "uses");
    }
  }
  const L = [...ins.values()], R = [...outs.values()];
  if (!L.length && !R.length) return `<div class="ak-empty">No connections declared. Add <code>calls:</code>, <code>publishes:</code>, <code>reads:</code>… to the frontmatter.</div>`;
  const BW = 168, BH = 40, GAP = 14, CW = 190, W = 760;
  const rows = Math.max(L.length, R.length, 1);
  const H = Math.max(rows * (BH + GAP) - GAP, BH + 30) + 20;
  const cy = H / 2;
  const colY = (n, i) => (H - (n * (BH + GAP) - GAP)) / 2 + i * (BH + GAP);
  const cx = (W - CW) / 2;
  const box = (x, y, w, h, el, center = false) => {
    const t = mainTech(el);
    const k = el.kind === "contract" ? "topic" : el.kind;
    const tag = el.kind === "contract" ? (el.transport || "contract") : t ? `${kindName(el.kind)} · ${techOf(t).label}` : kindName(el.kind);
    const icon = t ? techPath(t) : null;
    return `<a href="${href(el)}" data-el="${esc(el.id)}"><g class="eg-node k-${esc(k)}${t ? ` tech tech-${cls(t)}` : ""}${center ? " center" : ""}${el.origin === "inferred" ? " is-inferred" : ""}"><rect class="box" x="${x}" y="${y}" width="${w}" height="${h}"/>${icon ? `<svg x="${x + w - 18}" y="${y + 5}" width="12" height="12" viewBox="0 0 24 24"><path class="ic" d="${icon}"/></svg>` : ""}<text class="tag" x="${x + 8}" y="${y + 13}">${esc(clip(tag.toUpperCase(), Math.floor((w - 26) / 6)))}</text><text class="label" x="${x + 8}" y="${y + 30}">${esc(clip(elName(el), Math.floor((w - 14) / 7.2)))}</text></g></a>`;
  };
  const edge = (x1, y1, x2, y2, it, dir) => {
    const mode = it.modes.has("async") ? "async" : it.modes.has("stream") ? "stream" : it.modes.has("data") ? "data" : it.types.has("depends_on") ? "dep" : "sync";
    const mx = (x1 + x2) / 2;
    const d = `M${x1},${y1} H${mx} V${y2} H${x2}`;
    const text = it.labels.join(", ");
    const ly = dir === "in" ? y1 : y2;
    const lx = dir === "in" ? x1 + 10 : x2 - 10;
    return `<g class="eg-edge m-${mode}"><path d="${d}" marker-end="url(#eg-arr-${mode === "async" || mode === "stream" ? "a" : "s"})"/>${text ? `<text x="${lx}" y="${ly - 5}" text-anchor="${dir === "in" ? "start" : "end"}">${esc(clip(text, 30))}</text>` : ""}</g>`;
  };
  const parts = [];
  L.forEach((it, i) => { const y = colY(L.length, i); parts.push(edge(BW, y + BH / 2, cx, cy, it, "in")); });
  R.forEach((it, i) => { const y = colY(R.length, i); parts.push(edge(cx + CW, cy, W - BW, y + BH / 2, it, "out")); });
  L.forEach((it, i) => parts.push(box(0, colY(L.length, i), BW, BH, it.e)));
  R.forEach((it, i) => parts.push(box(W - BW, colY(R.length, i), BW, BH, it.e)));
  parts.push(box(cx, cy - 26, CW, 52, e, true));
  const heads = `<defs><marker id="eg-arr-s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="eg-head"/></marker><marker id="eg-arr-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="eg-head eg-head--a"/></marker></defs>`;
  const legend = `<div class="ak-legend eg-legend"><span><i class="eg-key"></i>sync call</span><span><i class="eg-key m-async"></i>async event</span><span><i class="eg-key m-data"></i>data access</span><span><i class="eg-key m-dep"></i>dependency</span><span class="muted">← in · out →</span></div>`;
  return `<figure class="ak-ego-map"><svg viewBox="-4 -4 ${W + 8} ${H + 8}" role="img" aria-label="Connections of ${esc(elName(e))}">${heads}${parts.join("")}</svg>${legend}</figure>`;
}
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, Math.max(1, n - 1)) + "…" : String(s));

// ── tracks ────────────────────────────────────────────────
// What a ```track scene needs from crux: stations as elements, hops as chips, transports by mode.
const TRANSPORT_ALIAS = () => {
  const out = new Map();
  for (const [id, t] of Object.entries(S.site.catalog?.transports ?? {})) { out.set(id, id); for (const a of t.aliases ?? []) out.set(a, id); }
  return out;
};
export function trackResolver() {
  const alias = TRANSPORT_ALIAS();
  return {
    el(id) {
      const e = S.byId.get(id);
      if (!e) return null;
      const t = mainTech(e);
      return { id: e.id, title: elName(e), kind: e.kind, tag: t ? `${kindName(e.kind)} · ${techOf(t).label}` : kindName(e.kind), techClass: t ? `tech tech-${cls(t)}` : "", icon: t ? techPath(t) : null, href: href(e), inferred: e.origin === "inferred" };
    },
    chip: (id) => (S.byId.get(id) ? elChip(S.byId.get(id)) : null),
    transport(word) {
      const id = alias.get(String(word ?? "").toLowerCase());
      if (!id) return null;
      const mode = modeOfTransport(id);
      return { id, mode, html: transportChip(id, mode) };
    },
  };
}

// ── flows ─────────────────────────────────────────────────
// Steps as a route: numbered stops grouped by phase, each with its hop, contract and branches.
export function routeHtml(f, current) {
  const steps = f.steps ?? [];
  if (!steps.length) return `<div class="ak-empty">No <code>steps</code> block yet.</div>`;
  let phase = null;
  const out = [];
  steps.forEach((s, i) => {
    if (s.phase && s.phase !== phase) { phase = s.phase; out.push(`<li class="ak-route-phase">${esc(phase)}</li>`); }
    const a = S.byId.get(s.fromId), b = S.byId.get(s.toId), c = S.byId.get(s.contract);
    const qs = byKind("question").filter((q) => (q.raisedFrom ?? "").endsWith(`#${s.id}`) && (q.raisedFrom.includes(f.id)));
    const mode = s.async ? "async" : s.transport ? modeOfTransport(s.transport) : "sync";
    const br = (s.branches ?? []).map((x) => `<div class="ak-route-br"><span class="ak-route-cond">${esc(x.when)}</span><span class="ak-route-to">→ <a href="#step-${esc(f.id)}-${esc(x.to)}" data-step-jump="${esc(x.to)}">${esc(x.to)}</a></span></div>`).join("");
    out.push(`<li class="ak-route-step m-${mode}${current === s.id ? " is-current" : ""}" id="step-${esc(f.id)}-${esc(s.id)}" data-step="${esc(s.id)}">
<span class="ak-route-n">${i + 1}</span>
<div class="ak-route-body"><div class="ak-route-hop">${a ? elChip(a) : `<span class="ak-el is-missing">${esc(s.from)}</span>`}<span class="ak-route-arrow" aria-label="${esc(MODE_NAME[mode] ?? mode)}">${mode === "async" ? "⇢" : "→"}</span>${b ? elChip(b) : `<span class="ak-el is-missing">${esc(s.to)}</span>`}</div>
<div class="ak-route-what"><code class="ak-route-id">${esc(s.id)}</code>${transportChip(s.transport, mode)}${c ? `<a class="ak-route-contract" href="${href(c)}">${esc(c.name)}</a>` : s.label ? `<span>${esc(s.label)}</span>` : ""}${qs.map((q) => `<a class="ak-route-q" href="${href(q)}" title="${esc(q.title)}">? ${esc(clip(q.title, 40))}</a>`).join("")}</div>
${(s.notes ?? []).map((n) => `<div class="ak-route-note">${esc(n)}</div>`).join("")}${br}</div></li>`);
  });
  return `<ol class="ak-route">${out.join("")}</ol>`;
}

// Map level that holds the most of a flow's hops, then replay its steps there.
export function playOnMap(f) {
  const steps = (f.steps ?? []).map((s) => ({ from: S.byId.get(s.fromId)?.title ?? s.from, to: S.byId.get(s.toId)?.title ?? s.to, fromNode: boxFor(s.fromId), toNode: boxFor(s.toId), label: [s.transport, S.byId.get(s.contract)?.name ?? s.label].filter(Boolean).join(" ") }));
  const nodes = [...new Set(steps.flatMap((x) => [x.fromNode, x.toNode]).filter(Boolean))];
  const path = new Map(nodes.map((id) => [id, ancestors(id).map((n) => n.id)]));
  const levels = new Set([""]);
  for (const p of path.values()) p.slice(0, -1).forEach((id) => levels.add(id));
  const boxAt = (lvl, id) => {
    if (!id) return null;
    const p = path.get(id);
    const i = lvl ? p.indexOf(lvl) : -1;
    return lvl && i < 0 ? id : p[i + 1] ?? id;
  };
  let lvl = "", best = -1, bestDepth = -1;
  for (const L of levels) {
    const score = steps.filter((x) => { const a = boxAt(L, x.fromNode), b = boxAt(L, x.toNode); return a && b && a !== b; }).length;
    const depth = L ? ancestors(L).length : 0;
    if (score > best || (score === best && depth > bestDepth)) { lvl = L; best = score; bestDepth = depth; }
  }
  S.replay = { steps, back: location.hash, speed: 1.5 };
  location.hash = `#/map/${encodeURIComponent(lvl)}?replay=1`;
}
// The map box for an element: itself or its nearest ancestor on the map.
function boxFor(id) {
  const nodes = S.site.architecture?.nodes ?? {};
  for (let e = S.byId.get(id); e; e = S.byId.get(e.parent)) if (nodes[e.id]) return e.id;
  return id;
}

// ── element page ──────────────────────────────────────────
function crumbs(e) {
  const up = elAncestors(e.id);
  return up.length ? `<nav class="ak-el-crumbs">${up.map((x) => elChip(x)).join('<i>/</i>')}</nav>` : "";
}

function listRows(items, empty = "") {
  if (!items.length) return empty ? `<div class="ak-empty">${empty}</div>` : "";
  return `<div class="ak-xrows">${items.join("")}</div>`;
}

// Interfaces: what it offers and what it uses, with the other side of each contract.
function interfacesHtml(e) {
  const row = (c, verb, others, otherVerb) => `<div class="ak-xrow"><span class="ak-xrow-k">${verb}</span>${elChip(c)}<span class="ak-xrow-o">${others.length ? `<em>${otherVerb}</em>${others.map((o) => elChip(o)).join("")}` : `<em class="muted">${otherVerb === "used by" || otherVerb === "consumed by" ? "nobody yet" : ""}</em>`}</span></div>`;
  const rows = [];
  for (const l of linksOut(e.id, "exposes")) { const c = S.byId.get(l.to); if (c) rows.push(row(c, "exposes", contractSides(c.id).cons, "used by")); }
  for (const l of linksOut(e.id, "publishes")) { const c = S.byId.get(l.to); if (c?.kind === "contract") rows.push(row(c, "publishes", contractSides(c.id).cons, "consumed by")); }
  for (const l of linksOut(e.id, "consumes")) { const c = S.byId.get(l.to); if (c) rows.push(row(c, "consumes", contractSides(c.id).prod, "from")); }
  for (const l of linksOut(e.id, "uses")) { const c = S.byId.get(l.to); if (c?.kind === "contract") rows.push(row(c, "uses", contractSides(c.id).prod, "from")); }
  for (const l of linksOut(e.id, "calls").filter((l) => l.via && !l.implied)) { const c = S.byId.get(l.via); if (c) rows.push(row(c, "calls", [S.byId.get(l.to)].filter(Boolean), "on")); }
  return listRows(rows);
}

function dataHtml(e) {
  const rows = [];
  for (const l of linksOut(e.id, "owns")) rows.push(`<div class="ak-xrow"><span class="ak-xrow-k">owns</span>${elChip(S.byId.get(l.to))}</div>`);
  const rw = new Map();
  for (const l of linksOut(e.id, "reads", "writes")) { const k = l.to; rw.set(k, [...(rw.get(k) ?? []), l.type]); }
  for (const [k, types] of rw) rows.push(`<div class="ak-xrow"><span class="ak-xrow-k">${types.sort().join(" · ")}</span>${elChip(S.byId.get(k))}${transportChip(linksOut(e.id, "reads", "writes").find((l) => l.to === k)?.transport, "data")}</div>`);
  const by = new Map();
  for (const l of linksIn(e.id, "reads", "writes")) by.set(l.from, [...(by.get(l.from) ?? []), l.type]);
  for (const [k, types] of by) rows.push(`<div class="ak-xrow"><span class="ak-xrow-k">${types.sort().map((t) => (t === "reads" ? "read" : "written")).join(" · ")} by</span>${elChip(S.byId.get(k))}</div>`);
  if (e.kind === "entity") {
    const owner = linksIn(e.id, "owns").map((l) => S.byId.get(l.from)).filter(Boolean);
    for (const o of owner) rows.unshift(`<div class="ak-xrow"><span class="ak-xrow-k">owned by</span>${elChip(o)}</div>`);
  }
  return listRows(rows);
}

function flowsHtml(e) {
  const fs = e.kind === "flow" ? [] : flowsThrough(e.id);
  if (!fs.length) return "";
  return listRows(fs.map((f) => {
    const st = f.steps.filter((s) => s.fromId === e.id || s.toId === e.id || s.contract === e.id);
    return `<div class="ak-xrow ak-xrow--flow">${elChip(f)}<span class="ak-xrow-o">${st.map((s) => `<a class="ak-stepchip" href="${href(f)}?step=${encodeURIComponent(s.id)}" title="${esc(`${s.from} → ${s.to}${s.label ? ` · ${s.label}` : ""}`)}">${f.steps.indexOf(s) + 1}. ${esc(s.id)}</a>`).join("")}</span></div>`;
  }));
}

function decisionsHtml(e) {
  const ds = decisionsFor(e.id);
  if (!ds.length) return "";
  return `<div class="m-rows">${ds.map((a) => { const g = gist(a); return `<a class="m-row ak-st-${esc(a.statusKey)}" href="${href(a)}" data-ref="${esc(a.id)}"><i class="ak-dot"></i><span class="mono">${esc(a.id)}</span><span class="m-row-t">${esc(a.title)}${g.text ? `<small>${esc(clip(g.text, 110))}</small>` : ""}</span><span class="m-row-s">${esc(statusLabel(a.statusKey))}</span></a>`; }).join("")}</div>`;
}

function questionsHtml(e) {
  const qs = questionsFor(e.id);
  if (!qs.length) return "";
  return `<div class="ak-qlist">${qs.map(questionCard).join("")}</div>`;
}

export function questionCard(q) {
  const blocks = [...linksOut(q.id, "blocks").map((l) => l.to), ...linksIn(q.id, "blocked_by").map((l) => l.from)];
  const from = q.raisedFrom ? q.raisedFrom.replace(/^flow:/, "") : "";
  const [fid, step] = from.split("#");
  const f = S.byId.get(fid);
  return `<a class="ak-qcard is-${esc(q.state)}" href="${href(q)}"><div class="ak-qcard-top"><span class="ak-qstate">${q.state === "answered" ? "✓ answered" : "? open"}</span>${q.phase ? `<span class="ak-qphase">${esc(q.phase)}</span>` : ""}${q.owner ? `<span class="mono muted">${esc(q.owner)}</span>` : ""}</div><strong>${esc(q.title)}</strong>${q.answer ? `<p class="ak-qans">${esc(clip(q.answer, 160))}</p>` : q.subtitle ? `<p>${esc(q.subtitle)}</p>` : ""}<div class="ak-qcard-foot">${f ? `<span class="ak-qfrom">from ${esc(f.title)}${step ? ` · step ${esc(step)}` : ""}</span>` : ""}${[...new Set(blocks)].map((b) => S.byId.get(b)).filter(Boolean).map((b) => `<span class="ak-qblocks">blocks ${esc(elName(b))}</span>`).join("")}</div></a>`;
}

function childrenHtml(e) {
  const kids = childrenOf(e.id);
  if (!kids.length) return "";
  const groups = new Map();
  for (const k of kids) { const g = kindName(k.kind); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(k); }
  return [...groups].map(([g, ks]) => `<div class="ak-xrow"><span class="ak-xrow-k">${esc(g)} · ${ks.length}</span><span class="ak-xrow-o">${ks.map((k) => elChip(k)).join("")}</span></div>`).join("");
}

function impactHtml(e) {
  const { down, up } = impactOf(e.id);
  if (!down.length && !up.length) return "";
  const col = (title, xs, hint) => `<div class="ak-imp-col"><div class="ak-mini-label">${title} · ${xs.length}</div><p class="muted" style="font-size:12px;margin:0 0 6px">${hint}</p>${xs.length ? xs.sort((a, b) => a.d - b.d).map(({ e: x, d }) => `<div class="ak-imp-row"><span class="ak-imp-d" title="hops away">${d}</span>${elChip(x)}</div>`).join("") : `<div class="muted">—</div>`}</div>`;
  const touched = new Set([e.id, ...down.map((x) => x.e.id)]);
  const flows = byKind("flow").filter((f) => (f.steps ?? []).some((s) => touched.has(s.fromId) || touched.has(s.toId)));
  return `<div class="ak-imp">${col("Depends on it", down, "Breaks or changes if this changes")}${col("It depends on", up, "Changes here can break this")}</div>${flows.length ? `<div class="ak-mini-label" style="margin-top:12px">Flows affected · ${flows.length}</div><div class="ak-chips">${flows.map((f) => elChip(f)).join("")}</div>` : ""}`;
}

function gapsHtml(e) {
  const g = gaps(e);
  if (!g.length) return `<div class="ak-gap ak-gap--ok">✓ Nothing missing</div>`;
  return `<ul class="ak-gaps">${g.map((x) => `<li class="ak-gap ak-gap--${x.k}">${esc(x.t)}${x.fix ? `<code class="ak-gap-fix">${esc(x.fix)}</code>` : ""}</li>`).join("")}</ul>`;
}

function contractHtml(e) {
  const { prod, cons } = contractSides(e.id);
  const mode = modeOfTransport(e.transport);
  return `<div class="ak-contract m-${esc(mode)}"><div class="ak-contract-side"><div class="ak-mini-label">${mode === "async" ? "Publishers" : "Providers"}</div>${prod.map((x) => elChip(x)).join("") || `<span class="muted">none declared</span>`}</div><div class="ak-contract-mid"><span class="ak-contract-pill">${transportChip(e.transport, mode)}<b>${esc(e.name)}</b></span>${e.on ? `<small>on ${elChip(S.byId.get(e.on) ?? { id: e.on, kind: "broker", title: e.on })}</small>` : ""}${e.schema ? `<small class="mono">${esc(e.schema)}</small>` : ""}</div><div class="ak-contract-side"><div class="ak-mini-label">${mode === "async" ? "Consumers" : "Clients"}</div>${cons.map((x) => elChip(x)).join("") || `<span class="muted">none declared</span>`}</div></div>`;
}

function flowHead(f) {
  const parts = [...new Map((f.steps ?? []).flatMap((s) => [s.fromId, s.toId]).filter(Boolean).map((id) => [id, S.byId.get(id)])).values()].filter(Boolean);
  const branches = (f.steps ?? []).reduce((n, s) => n + (s.branches?.length ?? 0), 0);
  const async = (f.steps ?? []).filter((s) => s.async).length;
  return `<div class="ak-flowhead"><div class="ak-flowhead-end"><span>Trigger</span><b>${esc(f.trigger || "—")}</b></div><div class="ak-flowhead-mid">${parts.map((p) => elChip(p)).join('<i class="ak-flowhead-arrow">›</i>')}</div><div class="ak-flowhead-end ak-flowhead-end--out"><span>Outcome</span><b>${esc(f.outcome || "—")}</b></div></div>
<div class="ak-flowstats"><span><b>${f.steps?.length ?? 0}</b> steps</span><span><b>${parts.length}</b> participants</span><span><b>${async}</b> async hops</span><span><b>${branches}</b> branches</span><span><b>${openQuestionsFor(f.id).length}</b> open questions</span><button class="ak-btn" type="button" data-play-flow="${esc(f.id)}">▶ Play on map</button></div>`;
}

export async function elementPage(view, id, q, loadDoc) {
  const e = S.byId.get(id);
  if (!e) return `<div class="ak-empty">Unknown element “${esc(id)}”. <a href="#/system">Back to the system</a></div>`;
  view.innerHTML = `<div class="ak-empty">Loading ${esc(elName(e))}…</div>`;
  const doc = e.implied ? null : await loadDoc(id);
  const showSource = q.get("source") === "1";
  const t = mainTech(e);
  const node = S.site.architecture?.nodes?.[e.id];
  const mapLink = node ? `#/map/${encodeURIComponent(node.children.length ? node.id : node.parent ?? "")}${node.children.length ? "" : `?sel=${encodeURIComponent(node.id)}`}` : null;
  const kindTag = e.kind === "contract" ? `${kindName(e.kind)} · ${String(e.transport || "").toUpperCase()}` : kindName(e.kind);
  const block = titleBlock([
    { label: "Kind", value: kindTag },
    { label: "Owner", value: e.owner ?? "" },
    { label: "Status", value: e.status ?? "" },
    { label: "Date", value: e.date ?? "" },
    { label: "Tech", value: e.tech?.length ? "x" : "", html: `<span class="ak-chips">${(e.tech ?? []).map(techChip).join("")}</span>`, span: 2 },
    { label: e.storeInferred ? "Lives in (store calculated)" : "Lives in", value: e.kind === "entity" ? "x" : "", html: e.kind === "entity" ? homeHtml(e) : "", span: 2 },
    { label: e.codeImplied ? "Code (this folder)" : "Code", value: e.code?.length ? "x" : "", html: (e.code ?? []).map((c) => `<span class="mono" style="font-size:12px">${esc(c)}</span>`).join(" · "), span: 2 },
    { label: "Trigger", value: e.trigger ?? "" },
    { label: "Outcome", value: e.outcome ?? "" },
    { label: "Phase", value: e.phase ?? "" },
    { label: "Raised from", value: e.raisedFrom ?? "", html: e.raisedFrom ? raisedLink(e.raisedFrom) : "" },
    { label: "Tags", value: e.tags?.length ? "x" : "", html: `<span class="ak-chips">${(e.tags ?? []).map((x) => tagChip(x)).join("")}</span>`, span: 2 },
    { label: "Evidence", value: e.evidence?.length ? "x" : "", html: (e.evidence ?? []).map((x) => `<div class="mono" style="font-size:12px">${esc(x)}</div>`).join(""), span: 2 },
  ], 4);
  const origin = e.origin === "inferred" ? `<span class="ak-origin" title="Proposed by an agent from the code. Confirm it by removing origin: inferred.">inferred${e.confidence ? ` · ${esc(e.confidence)}` : ""}</span>` : "";
  const panels = [];
  let n = 0;
  const L = () => String.fromCharCode(65 + n++);
  if (e.kind === "flow") {
    // every flow plays: a scene made from its steps, unless the file draws its own ```track
    if (e.steps?.length && !/```\s*track\b/.test(doc?.source ?? "")) {
      const src = trackFromSteps(e, S.byId).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/\n/g, "&#10;");
      panels.push(panel(L(), "Play", `<figure class="ak-track" data-track data-src="${src}"></figure>`, { span: 3, meta: "made from the steps" }));
    }
    panels.push(panel(L(), "Route", routeHtml(e, q.get("step")), { span: 3, meta: `${e.steps?.length ?? 0} steps` }));
  } else if (e.kind === "contract") {
    panels.push(panel(L(), "Who is on each side", contractHtml(e), { span: 3 }));
  } else if (e.kind === "entity") {
    panels.push(panel(L(), "Relations", entityRelations(e), { span: 3, meta: `<a href="#/model">domain model ›</a>` }));
  } else if (!["question", "session", "convention"].includes(e.kind) && !(e.kind === "entity" && !linksOut(e.id).length && !linksIn(e.id, "reads", "writes").length)) {
    panels.push(panel(L(), "Connections", egoMap(e), { span: 3, meta: mapLink ? `<a href="${mapLink}">on the map ›</a>` : "" }));
  }
  const iface = interfacesHtml(e);
  if (iface) panels.push(panel(L(), "Interfaces", iface, { span: 2 }));
  const data = dataHtml(e);
  if (data) panels.push(panel(L(), "Data", data, { span: iface ? 1 : 3 }));
  const kids = childrenHtml(e);
  if (kids) panels.push(panel(L(), "Inside", kids, { span: 3, meta: `${childrenOf(e.id).length}` }));
  const flows = flowsHtml(e);
  if (flows) panels.push(panel(L(), "Flows through it", flows, { span: 3, meta: `${flowsThrough(e.id).length}` }));
  if (e.kind === "session") {
    const produced = linksOut(e.id, "produced").map((l) => S.byId.get(l.to)).filter(Boolean);
    if (produced.length) panels.push(panel(L(), "Produced", `<div class="ak-chips">${produced.map((x) => elChip(x)).join("")}</div>`, { span: 3 }));
  }
  if (e.kind === "question") {
    const blocks = [...new Set([...linksOut(e.id, "blocks").map((l) => l.to), ...linksIn(e.id, "blocked_by").map((l) => l.from)])].map((x) => S.byId.get(x)).filter(Boolean);
    panels.push(panel(L(), e.state === "answered" ? "Answer" : "Blocks", `${e.answer ? `<div class="ak-hero ak-hero--decision"><div class="ak-hero-label">Answer</div><div class="ak-hero-text">${esc(e.answer)}</div></div>` : ""}${blocks.length ? `<div class="ak-chips" style="margin-top:8px">${blocks.map((x) => elChip(x)).join("")}</div>` : `<div class="muted">Blocks nothing yet. Add <code>blocks: [id]</code>.</div>`}`, { span: 3 }));
  }
  const dec = decisionsHtml(e);
  const qs = e.kind === "question" ? "" : questionsHtml(e);
  const imp = ["question", "session", "flow", "convention", "entity"].includes(e.kind) ? "" : impactHtml(e);
  const body = showSource && doc ? `<figure class="ak-code"><figcaption><span>${esc(e.file)}</span><button class="ak-copy" data-copy>Copy</button></figcaption><pre class="ak-source"><code>${esc(doc.source)}</code></pre></figure>` : doc?.html ?? "";
  const html = `<article class="ak-elpage k-${esc(e.kind)}">
<header class="ak-adr-head ak-el-head${t ? ` tech tech-${cls(t)}` : ""}">
  <div class="ak-adr-actions">${mapLink ? `<a class="ak-btn ak-btn--ghost" href="${mapLink}">◫ Map</a>` : ""}${e.file ? `<a class="ak-btn ak-btn--ghost" href="${href(e)}${showSource ? "" : "?source=1"}">${showSource ? "Rendered" : "Markdown"}</a><button class="ak-btn ak-btn--ghost" type="button" data-copy-text="${esc(e.file)}" title="Copy file path">⧉ ${esc(e.file.split("/").pop())}</button>` : `<span class="ak-btn ak-btn--ghost" title="Made from a reference; no file yet">no file</span>`}</div>
  <div class="ak-adr-id ak-el-kind">${kindGlyph(e.kind, 16)}<span>${esc(kindTag)}</span>${e.kind !== "contract" && e.id !== Slugish(e.title) ? `<code>${esc(e.id)}</code>` : ""}${pill(e, true)}${origin}${e.implied ? `<span class="ak-origin ak-origin--implied" title="No file defines this; it exists because something references it">implied</span>` : ""}</div>
  ${crumbs(e)}
  <h1>${t && e.kind !== "contract" ? `<span class="ak-el-h1icon">${techIcon(t, 26)}</span>` : ""}${esc(elName(e))}</h1>
  ${e.subtitle ? `<p class="ak-sub">${esc(e.subtitle)}</p>` : ""}
  ${block}
</header>
${e.kind === "flow" ? flowHead(e) : ""}
${sheet(`<div class="ak-adr-layout ak-adr-layout--el">
  <div class="ak-body"><div class="ak-sheet-grid ak-el-grid">${panels.join("")}</div>${body ? `<div class="ak-el-doc">${body}</div>` : ""}</div>
  <aside class="ak-rail">
    <section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">!</span><h2>What's missing</h2></header><div class="am-panel-body">${gapsHtml(e)}</div></section>
    ${dec ? `<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">✓</span><h2>Decisions</h2><span class="am-panel-meta">${decisionsFor(e.id).length}</span></header><div class="am-panel-body">${dec}</div></section>` : ""}
    ${qs ? `<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">?</span><h2>Questions</h2><span class="am-panel-meta">${openQuestionsFor(e.id).length} open</span></header><div class="am-panel-body">${qs}</div></section>` : ""}
    ${imp ? `<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">⇶</span><h2>Impact</h2></header><div class="am-panel-body">${imp}</div></section>` : ""}
  </aside>
</div>`, { rows: 6 })}
</article>`;
  view.innerHTML = html;
  const onClick = (ev) => {
    const p = ev.target.closest("[data-play-flow]");
    if (p) return playOnMap(S.byId.get(p.dataset.playFlow));
    const j = ev.target.closest("[data-step-jump]");
    if (j) {
      ev.preventDefault();
      const el = document.getElementById(`step-${e.id}-${j.dataset.stepJump}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.classList.add("is-flash");
      setTimeout(() => el?.classList.remove("is-flash"), 1200);
    }
  };
  view.addEventListener("click", onClick);
  const step = q.get("step");
  if (step) setTimeout(() => document.getElementById(`step-${e.id}-${step}`)?.scrollIntoView({ block: "center" }), 50);
  return () => view.removeEventListener("click", onClick);
}

const Slugish = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function raisedLink(r) {
  const [fid, step] = r.replace(/^flow:/, "").split("#");
  const f = S.byId.get(fid);
  return f ? `<a href="${href(f)}${step ? `?step=${encodeURIComponent(step)}` : ""}">${esc(f.title)}${step ? ` · step ${esc(step)}` : ""}</a>` : esc(r);
}

// ── system index ──────────────────────────────────────────
const GROUPS = [
  ["Structure", ["system", "context"]],
  ["Services and apps", ["service", "app", "job", "library", "module"]],
  ["Infrastructure", ["store", "cache", "broker", "gateway", "infra"]],
  ["Outside", ["actor", "external"]],
  ["Contracts", ["contract"]],
  ["Domain model", ["entity"]],
  ["Conventions", ["convention"]],
];

function elCard(e) {
  const t = mainTech(e);
  const out = linksOut(e.id).filter((l) => ["calls", "publishes", "writes", "reads", "uses", "consumes"].includes(l.type) && !l.implied).length;
  const inn = linksIn(e.id).filter((l) => ["calls", "reads", "writes", "uses", "consumes"].includes(l.type)).length;
  const fl = flowsThrough(e.id).length, dq = decisionsFor(e.id).length, oq = openQuestionsFor(e.id).length;
  const g = gaps(e).filter((x) => x.k !== "info").length;
  const where = elAncestors(e.id).map((x) => x.title).join(" / ");
  return `<a class="ak-ecard k-${esc(e.kind)}${t ? ` tech tech-${cls(t)}` : ""}${e.origin === "inferred" ? " is-inferred" : ""}" href="${href(e)}" data-el="${esc(e.id)}">
<div class="ak-ecard-top">${kindGlyph(e.kind, 13)}<span>${esc(e.kind === "contract" ? (e.transport || "contract").toUpperCase() : kindName(e.kind).toUpperCase())}${where ? ` · IN ${esc(where.toUpperCase())}` : ""}</span>${e.origin === "inferred" ? `<em class="ak-origin">inferred</em>` : ""}</div>
<h3>${t && e.kind !== "contract" ? techIcon(t, 16) : ""}${esc(elName(e))}</h3>
${e.subtitle ? `<p>${esc(e.subtitle)}</p>` : ""}
${e.tech?.length > 1 ? `<div class="ak-ecard-tech">${e.tech.slice(1).map((x) => `<span class="tech tech-${cls(x)}" title="${esc(techOf(x).label)}">${techIcon(x, 12)}</span>`).join("")}</div>` : ""}
<div class="ak-ecard-foot">${inn ? `<span title="incoming">← ${inn}</span>` : ""}${out ? `<span title="outgoing">${out} →</span>` : ""}${fl ? `<span title="flows">⟿ ${fl}</span>` : ""}${dq ? `<span class="ok" title="decisions">✓ ${dq}</span>` : ""}${oq ? `<span class="warn" title="open questions">? ${oq}</span>` : ""}${g ? `<span class="err" title="warnings">! ${g}</span>` : ""}</div></a>`;
}

// A compact row for the system index: one line per element, so a big system stays on a few screens.
function elRow(e) {
  const t = mainTech(e);
  const out = linksOut(e.id).filter((l) => ["calls", "publishes", "writes", "reads", "uses", "consumes"].includes(l.type) && !l.implied).length;
  const inn = linksIn(e.id).filter((l) => ["calls", "reads", "writes", "uses", "consumes"].includes(l.type)).length;
  const fl = flowsThrough(e.id).length, dq = decisionsFor(e.id).length, oq = openQuestionsFor(e.id).length;
  const g = gaps(e).filter((x) => x.k !== "info").length;
  const where = elAncestors(e.id).map((x) => x.title).join(" / ");
  return `<a class="ak-erow k-${esc(e.kind)}${t ? ` tech tech-${cls(t)}` : ""}${e.origin === "inferred" ? " is-inferred" : ""}" href="${href(e)}" data-el="${esc(e.id)}">
<span class="ak-erow-n">${t && e.kind !== "contract" ? techIcon(t, 15) : kindGlyph(e.kind, 14)}<b>${esc(elName(e))}</b></span>
<span class="ak-erow-s">${e.subtitle ? esc(e.subtitle) : `<i>${esc(where)}</i>`}</span>
<span class="ak-erow-w">${where && e.subtitle ? esc(where) : ""}</span>
<span class="ak-erow-t">${(e.tech ?? []).slice(0, 4).map((x) => `<span class="tech tech-${cls(x)}" title="${esc(techOf(x).label)}">${techIcon(x, 13)}</span>`).join("")}</span>
<span class="ak-erow-f">${inn ? `<span title="incoming">← ${inn}</span>` : ""}${out ? `<span title="outgoing">${out} →</span>` : ""}${fl ? `<span title="flows">⟿ ${fl}</span>` : ""}${dq ? `<span class="ok" title="decisions">✓ ${dq}</span>` : ""}${oq ? `<span class="warn" title="open questions">? ${oq}</span>` : ""}${g ? `<span class="err" title="warnings">! ${g}</span>` : ""}</span></a>`;
}

const LIMIT = 14;
// Rows past the limit are hidden until "Show all" is pressed (one listener for every system page).
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-more]");
  if (!b) return;
  const sec = b.closest(".ak-sys-sec");
  for (const el of sec.querySelectorAll("[data-extra]")) el.removeAttribute("hidden");
  b.remove();
});
const more = (n) => (n > LIMIT ? `<button class="ak-btn ak-btn--ghost ak-more" type="button" data-more>Show ${n - LIMIT} more</button>` : "");

export function systemPage(parts, q) {
  const text = (q.get("q") ?? "").toLowerCase();
  const kind = q.get("kind") ?? "";
  const cards = q.get("view") === "cards";
  const els = elements().filter((e) => !["flow", "question", "session"].includes(e.kind));
  const match = (e) => (!kind || e.kind === kind) && (!text || `${e.id} ${e.title} ${e.name ?? ""} ${e.subtitle ?? ""} ${(e.tech ?? []).join(" ")} ${(e.tags ?? []).join(" ")}`.toLowerCase().includes(text));
  const shown = els.filter(match);
  const counts = new Map();
  for (const e of els) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const link = (patch) => { const p = new URLSearchParams({ q: q.get("q") ?? "", kind, view: cards ? "cards" : "", ...patch }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `#/system${p.toString() ? `?${p}` : ""}`; };
  const chips = [`<a class="ak-chip${!kind ? " on" : ""}" href="${link({ kind: "" })}">All <b>${els.length}</b></a>`].concat([...counts].sort((a, b) => b[1] - a[1]).map(([k, c]) => `<a class="ak-chip${kind === k ? " on" : ""}" href="${link({ kind: kind === k ? "" : k })}">${kindGlyph(k, 12)} ${esc(kindName(k))} <b>${c}</b></a>`)).join("");
  if (!elements().length) return `<div class="ak-page-head"><div><h1>System</h1><p>No crux files yet.</p></div></div>${emptySystem()}`;
  const filtered = !!(text || kind);
  const COLLAPSED = new Set(["contract", "entity", "convention"]);
  const sections = GROUPS.map(([title, kinds]) => {
    const xs = shown.filter((e) => kinds.includes(e.kind));
    if (!xs.length) return "";
    const open = filtered || !COLLAPSED.has(kinds[0]);
    const head = `<summary><h2>${esc(title)} <b>${xs.length}</b></h2></summary>`;
    if (kinds[0] === "contract") return `<details class="ak-sys-sec"${open ? " open" : ""}>${head}${contractTable(xs)}</details>`;
    if (cards) return `<details class="ak-sys-sec"${open ? " open" : ""}>${head}<div class="ak-deck ak-edeck">${xs.map((e, i) => (i < LIMIT ? elCard(e) : elCard(e).replace("<a ", "<a data-extra hidden "))).join("")}</div>${more(xs.length)}</details>`;
    return `<details class="ak-sys-sec"${open ? " open" : ""}>${head}<div class="ak-elist">${xs.map((e, i) => (i < LIMIT ? elRow(e) : elRow(e).replace("<a ", "<a data-extra hidden "))).join("")}</div>${more(xs.length)}</details>`;
  }).join("");
  setTimeout(() => {
    const input = $("#sys-q");
    input?.addEventListener("input", () => {
      clearTimeout(input.t);
      input.t = setTimeout(() => { history.replaceState(null, "", link({ q: input.value })); dispatchEvent(new HashChangeEvent("hashchange")); setTimeout(() => { const i = $("#sys-q"); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }, 30); }, 200);
    });
  });
  const used = [...new Set(els.flatMap((e) => e.tech ?? []))].sort((a, b) => String(techOf(a).category).localeCompare(String(techOf(b).category)) || a.localeCompare(b));
  return `<div class="ak-page-head"><div><h1>System</h1><p>${els.length} elements · ${byKind("flow").length} flows · ${byKind("question").filter((x) => x.state !== "answered").length} open questions</p></div><div class="ak-head-tools"><div class="ak-seg" role="group" aria-label="Layout"><a class="${cards ? "" : "on"}" href="${link({ view: "" })}">List</a><a class="${cards ? "on" : ""}" href="${link({ view: "cards" })}">Cards</a></div><input class="ak-input" id="sys-q" placeholder="Filter by name, tech, tag…" value="${esc(q.get("q") ?? "")}"></div></div>
<div class="ak-filters"><span class="ak-label">Kind</span><div class="ak-chips">${chips}</div></div>
${used.length ? `<details class="ak-filters ak-techfilter"${filtered ? " open" : ""}><summary class="ak-label">Tech <b>${used.length}</b></summary><div class="ak-chips">${used.map((x) => `<a href="${link({ q: x })}" class="ak-tech-link">${techChip(x)}</a>`).join("")}</div></details>` : ""}
${sections || `<div class="ak-empty">Nothing matches.</div>`}`;
}

function contractTable(xs) {
  const rows = xs.map((c, i) => {
    const { prod, cons } = contractSides(c.id);
    const mode = modeOfTransport(c.transport);
    return `<tr${i >= LIMIT ? " data-extra hidden" : ""}><td>${transportChip(c.transport, mode)}</td><td><a class="mono" href="${href(c)}">${esc(c.name)}</a>${c.implied ? ` <span class="ak-origin ak-origin--implied">implied</span>` : ""}</td><td>${prod.map((x) => elChip(x)).join("") || `<span class="ak-miss">none</span>`}</td><td>${cons.map((x) => elChip(x)).join("") || `<span class="muted">—</span>`}</td><td>${flowsThrough(c.id).map((f) => elChip(f)).join("")}</td></tr>`;
  }).join("");
  return `<div class="am-md"><div class="am-table-wrap"><table class="ak-ctable"><thead><tr><th>Transport</th><th>Contract</th><th>Provided / published by</th><th>Used / consumed by</th><th>In flows</th></tr></thead><tbody>${rows}</tbody></table></div></div>${more(xs.length)}`;
}

function emptySystem() {
  return `<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">+</span><h2>Describe your first service</h2></header><div class="am-panel-body am-md"><p>Put a markdown file next to the code — any name — with a <code>crux:</code> header:</p><pre class="am-code"><code>---
crux: service
tech: [go, postgres]
exposes: ["http:POST /orders"]
publishes: ["topic:order.created"]
writes: [orders-db]
---
# Orders</code></pre><p>Or let your agent map the repo: <code>/crux adopt</code>.</p></div></section>`;
}

// ── flows index ───────────────────────────────────────────
export function flowsPage() {
  const fs = byKind("flow");
  if (!fs.length) return `<div class="ak-page-head"><div><h1>Flows</h1><p>No flows yet.</p></div></div><section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">+</span><h2>Write a flow</h2></header><div class="am-panel-body am-md"><pre class="am-code"><code>---
crux: flow
trigger: customer submits the cart
outcome: order paid
---
# Checkout

\`\`\`steps
place:  customer -> api : http POST /orders
emit:   orders --> billing : topic order.created
charge: billing -> psp : http POST /charges
  ? declined -> failed
\`\`\`</code></pre></div></section>`;
  return `<div class="ak-page-head"><div><h1>Flows</h1><p>${fs.length} flows · ${fs.reduce((n, f) => n + (f.steps?.length ?? 0), 0)} steps</p></div></div>
<div class="ak-flowdeck">${fs.map((f) => {
    const parts = [...new Map((f.steps ?? []).flatMap((s) => [s.fromId, s.toId]).filter(Boolean).map((id) => [id, S.byId.get(id)])).values()].filter(Boolean);
    const oq = openQuestionsFor(f.id).length;
    const br = (f.steps ?? []).reduce((n, s) => n + (s.branches?.length ?? 0), 0);
    const g = gaps(f).filter((x) => x.k !== "info").length;
    return `<article class="ak-fcard"><a class="ak-fcard-head" href="${href(f)}"><span class="ak-fcard-kind">${kindGlyph("flow", 13)} FLOW${f.parent ? ` · IN ${esc((S.byId.get(f.parent)?.title ?? f.parent).toUpperCase())}` : ""}</span><h3>${esc(f.title)}</h3>${f.subtitle ? `<p>${esc(f.subtitle)}</p>` : ""}</a>
<div class="ak-fcard-ends"><div><span>Trigger</span>${esc(f.trigger || "—")}</div><div><span>Outcome</span>${esc(f.outcome || "—")}</div></div>
<div class="ak-fcard-route">${(f.steps ?? []).map((s, i) => { const a = S.byId.get(s.fromId), b = S.byId.get(s.toId); return `${i === 0 ? (a ? elChip(a) : esc(s.from)) : ""}<span class="ak-fcard-hop m-${s.async ? "async" : "sync"}" title="${esc(s.label)}">${s.branches?.length ? "◇" : ""}${s.async ? "⇢" : "→"}</span>${b ? elChip(b) : esc(s.to)}`; }).join("")}</div>
<div class="ak-ecard-foot"><span>${f.steps?.length ?? 0} steps</span><span>${parts.length} participants</span>${br ? `<span>◇ ${br} branches</span>` : ""}${oq ? `<span class="warn">? ${oq} open</span>` : ""}${g ? `<span class="err">! ${g}</span>` : ""}<button class="ak-btn ak-btn--ghost" type="button" data-play-flow="${esc(f.id)}">▶ on map</button></div></article>`;
  }).join("")}</div>`;
}

// ── questions board ───────────────────────────────────────
export function questionsPage() {
  const qs = byKind("question");
  const open = qs.filter((x) => x.state !== "answered"), done = qs.filter((x) => x.state === "answered");
  const adrQs = S.site.adrs.filter((a) => ["draft", "open", "review", "proposed"].includes(a.statusKey) && a.facts?.questions?.length);
  const col = (title, cls, items) => `<section class="ak-qcol ${cls}"><h2>${title} <b>${items.length}</b></h2>${items.join("") || `<div class="ak-empty">None.</div>`}</section>`;
  return `<div class="ak-page-head"><div><h1>Questions</h1><p>${open.length} open · ${done.length} answered · ${adrQs.reduce((n, a) => n + a.facts.questions.length, 0)} inside open decisions</p></div></div>
<div class="ak-qboard">${col("Open", "is-open", open.map(questionCard))}${col("In decisions", "is-adr", adrQs.flatMap((a) => a.facts.questions.map((t) => `<a class="ak-qcard" href="${href(a)}"><div class="ak-qcard-top"><span class="mono">${esc(label(a))}</span>${pill(a)}</div><strong>${esc(t)}</strong><div class="ak-qcard-foot"><span class="ak-qfrom">${esc(a.title)}</span></div></a>`)))}${col("Answered", "is-answered", done.map(questionCard))}</div>`;
}

// ── sessions timeline ─────────────────────────────────────
export function sessionsPage() {
  const ss = byKind("session").sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!ss.length) return `<div class="ak-page-head"><div><h1>Sessions</h1><p>No sessions recorded.</p></div></div><div class="ak-empty">Agents write a <code>crux: session</code> file at the end of an adopt, design, model or build session.</div>`;
  const PH = ["adopt", "design", "model", "build"];
  return `<div class="ak-page-head"><div><h1>Sessions</h1><p>${ss.length} sessions · what each one decided, built and left open</p></div></div>
<div class="ak-phases">${PH.map((p) => `<span class="ak-phase ph-${p}"><b>${ss.filter((s) => s.phase === p).length}</b>${p}</span>`).join('<i>›</i>')}</div>
<ol class="ak-sessions">${ss.map((s) => {
    const produced = linksOut(s.id, "produced").map((l) => S.byId.get(l.to)).filter(Boolean);
    const qs = linksOut(s.id, "mentions").map((l) => S.byId.get(l.to)).filter((x) => x?.kind === "question");
    return `<li class="ak-session ph-${esc(s.phase || "other")}"><div class="ak-session-when"><b>${esc(s.date || "undated")}</b><span class="ak-phase ph-${esc(s.phase || "other")}">${esc(s.phase || "session")}</span></div><div class="ak-session-body"><a href="${href(s)}"><h3>${esc(s.title)}</h3></a>${s.subtitle ? `<p>${esc(s.subtitle)}</p>` : ""}${produced.length ? `<div class="ak-chips">${produced.map((x) => elChip(x)).join("")}</div>` : ""}${qs.length ? `<div class="ak-chips" style="margin-top:6px">${qs.map((x) => elChip(x)).join("")}</div>` : ""}</div></li>`;
  }).join("")}</ol>`;
}

// ── overview panels ───────────────────────────────────────
export function systemSummary() {
  const els = elements();
  if (!els.length) return "";
  const k = (...ks) => els.filter((e) => ks.includes(e.kind)).length;
  const inferred = els.filter((e) => e.origin === "inferred");
  const oq = byKind("question").filter((x) => x.state !== "answered");
  const tiles = [["Services", k("service", "app", "job"), "#/system?kind=service"], ["Infra", k("store", "cache", "broker", "gateway", "infra"), "#/system"], ["Contracts", k("contract"), "#/system?kind=contract"], ["Entities", k("entity"), "#/system?kind=entity"], ["Flows", k("flow"), "#/flows"], ["Open questions", oq.length, "#/questions"]];
  return `<div class="ak-systiles">${tiles.map(([l, v, h]) => `<a class="ak-systile" href="${h}"><b>${v}</b><span>${l}</span></a>`).join("")}</div>${inferred.length ? `<p class="ak-sysnote"><span class="ak-origin">inferred</span> ${inferred.length} element${inferred.length > 1 ? "s" : ""} proposed from code, waiting for you to confirm: ${inferred.slice(0, 6).map((e) => elChip(e)).join("")}</p>` : ""}`;
}

// Completeness across the system: gaps grouped by kind of gap.
export function completeness() {
  const els = elements().filter((e) => !e.implied || e.kind === "contract");
  const by = new Map();
  for (const e of els) for (const g of gaps(e)) {
    const key = g.t.replace(/^\d+ open questions?$/, "Open questions").replace(/\(.*\)/, "").trim();
    if (!by.has(key)) by.set(key, { k: g.k, items: [] });
    by.get(key).items.push(e);
  }
  if (!by.size) return `<div class="ak-gap ak-gap--ok">✓ Every element is complete</div>`;
  const order = { err: 0, warn: 1, info: 2 };
  return `<ul class="ak-gaps ak-gaps--sys">${[...by].sort((a, b) => order[a[1].k] - order[b[1].k] || b[1].items.length - a[1].items.length).slice(0, 7).map(([t, x]) => `<li class="ak-gap ak-gap--${x.k}"><span>${esc(t)} <b>${x.items.length}</b></span><span class="ak-chips">${x.items.slice(0, 4).map((e) => elChip(e)).join("")}${x.items.length > 4 ? `<span class="muted">+${x.items.length - 4}</span>` : ""}</span></li>`).join("")}</ul>`;
}

// Hover card for any element chip.
export function elementPopover(e) {
  const t = mainTech(e);
  const where = elAncestors(e.id).map((x) => x.title).join(" / ");
  const outs = linksOut(e.id).filter((l) => ["calls", "publishes", "writes", "reads"].includes(l.type) && !l.implied).map((l) => S.byId.get(l.to)).filter(Boolean);
  const fl = flowsThrough(e.id);
  return `<div class="ak-npop-tag">${esc((e.kind === "contract" ? `${e.transport} contract` : [kindName(e.kind), t && techOf(t).label].filter(Boolean).join(" · ")).toUpperCase())}${where ? `<span>in ${esc(where)}</span>` : ""}</div>
<strong>${esc(elName(e))}</strong>${e.subtitle ? `<div class="ak-npop-sub">${esc(e.subtitle)}</div>` : ""}
${e.tech?.length ? `<div class="ak-chips" style="margin:6px 0">${e.tech.map(techChip).join("")}</div>` : ""}
${outs.length ? `<div class="ak-npop-h">Talks to · ${outs.length}</div><div class="ak-npop-kids">${esc([...new Set(outs.map((o) => elName(o)))].slice(0, 6).join(" · "))}</div>` : ""}
${fl.length ? `<div class="ak-npop-h">Flows · ${fl.length}</div><div class="ak-npop-kids">${esc(fl.map((f) => f.title).join(" · "))}</div>` : ""}
<div class="ak-npop-foot">Click to open</div>`;
}
