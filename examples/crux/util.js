// Shared state and small helpers for the views.
export const S = { site: null, byId: new Map(), adj: new Map(), docCache: new Map() };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function index(site) {
  site.elements ??= [];
  site.links ??= [];
  S.site = site;
  S.byId = new Map([...site.adrs, ...site.docs, ...site.elements].map((a) => [a.id, a]));
  S.adj = new Map();
  for (const x of S.byId.keys()) S.adj.set(x, []);
  for (const e of site.edges) {
    S.adj.get(e.from)?.push({ id: e.to, type: e.type, dir: "out" });
    S.adj.get(e.to)?.push({ id: e.from, type: e.type, dir: "in" });
  }
  // element links: decided_by, blocked_by, mentions… show on ADR and doc pages too
  for (const l of site.links) {
    if (!["decided_by", "blocked_by", "blocks", "raised_from", "produced", "mentions", "relates"].includes(l.type)) continue;
    S.adj.get(l.from)?.push({ id: l.to, type: l.type, dir: "out" });
    S.adj.get(l.to)?.push({ id: l.from, type: l.type, dir: "in" });
  }
  S.out = new Map();
  S.in = new Map();
  for (const l of site.links) {
    if (!S.out.has(l.from)) S.out.set(l.from, []);
    if (!S.in.has(l.to)) S.in.set(l.to, []);
    S.out.get(l.from).push(l);
    S.in.get(l.to).push(l);
  }
  S.kids = new Map();
  for (const e of site.elements) if (e.parent) {
    if (!S.kids.has(e.parent)) S.kids.set(e.parent, []);
    S.kids.get(e.parent).push(e);
  }
}

export const isElement = (a) => a && a.kind !== "adr" && a.kind !== "doc";
export const KIND_LABEL = { contract: "Contract", entity: "Entity", flow: "Flow", question: "Question", session: "Session", convention: "Convention" };
export const label = (a) => (a.kind === "adr" ? `${S.site.prefix}-${a.id}` : a.kind === "doc" ? "DOC" : a.kind === "contract" ? String(a.transport || "contract").toUpperCase() : String(a.kind).toUpperCase());
export const href = (a) => (a.kind === "adr" ? `#/adr/${a.id}` : a.kind === "doc" ? `#/doc/${encodeURIComponent(a.id)}` : `#/el/${encodeURIComponent(a.id)}`);
export const linksOut = (id, ...types) => (S.out.get(id) ?? []).filter((l) => !types.length || types.includes(l.type));
export const linksIn = (id, ...types) => (S.in.get(id) ?? []).filter((l) => !types.length || types.includes(l.type));
export const childrenOf = (id) => S.kids.get(id) ?? [];
export function elAncestors(id) {
  const out = [];
  const seen = new Set();
  for (let e = S.byId.get(S.byId.get(id)?.parent); e && !seen.has(e.id); e = S.byId.get(e.parent)) { seen.add(e.id); out.unshift(e); }
  return out;
}
export const statusLabel = (k) => S.site.statuses[k]?.label ?? k;
export const pill = (a, lg = false) => (a.status ? `<span class="ak-pill${lg ? " ak-pill--lg" : ""} ak-st-${esc(a.statusKey)}">${esc(a.status)}</span>` : isElement(a) ? "" : `<span class="ak-pill ak-st-doc">Doc</span>`);
export const tagChip = (t, on = false, count) => `<a class="ak-chip ak-chip--tag${on ? " on" : ""}" href="#/tag/${encodeURIComponent(t)}">${esc(t)}${count != null ? ` <b>${count}</b>` : ""}</a>`;
export const nodeChip = (id) => {
  const n = S.site.architecture?.nodes[id];
  return `<a class="ak-chip ak-chip--node" href="#/map/${encodeURIComponent(n?.parent ?? "")}?sel=${encodeURIComponent(id)}">${esc(n?.label ?? id)}</a>`;
};
export const refChip = (a) => `<a class="ak-chip ak-st ak-st-${esc(a.statusKey)}" href="${href(a)}" data-ref="${esc(a.id)}">${esc(label(a))}</a>`;

// The one-line gist of a decision, in priority order.
export function gist(a) {
  if (a.kind === "question") return a.answer ? { kind: "decision", text: a.answer } : { kind: "question", text: a.subtitle || a.title };
  const f = a.facts ?? {};
  if (f.decision) return { kind: "decision", text: f.decision };
  if (f.recommendation) return { kind: "recommendation", text: f.recommendation };
  if (f.question) return { kind: "question", text: f.question };
  return { kind: "summary", text: a.subtitle };
}

export function optionStats(a) {
  const items = (a.facts?.options ?? []).flatMap((o) => o.items);
  return { items, ok: items.filter((o) => o.verdict.kind === "ok"), no: items.filter((o) => o.verdict.kind === "no"), warn: items.filter((o) => o.verdict.kind === "warn") };
}

export function ancestors(nodeId) {
  const arch = S.site.architecture;
  const out = [];
  for (let n = arch?.nodes[nodeId]; n; n = arch.nodes[n.parent]) out.unshift(n);
  return out;
}

export function statusOrder() {
  return Object.entries(S.site.statuses).sort((a, b) => (a[1].order ?? 9) - (b[1].order ?? 9)).map(([k]) => k);
}

export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("on"), 1400);
}

export function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

export function wrapText(text, max) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}
