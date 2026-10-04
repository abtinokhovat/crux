// Shared state and small helpers for the views.
export const S = { site: null, byId: new Map(), adj: new Map(), docCache: new Map() };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function index(site) {
  S.site = site;
  S.byId = new Map([...site.adrs, ...site.docs].map((a) => [a.id, a]));
  S.adj = new Map();
  for (const x of S.byId.keys()) S.adj.set(x, []);
  for (const e of site.edges) {
    S.adj.get(e.from)?.push({ id: e.to, type: e.type, dir: "out" });
    S.adj.get(e.to)?.push({ id: e.from, type: e.type, dir: "in" });
  }
}

export const label = (a) => (a.kind === "adr" ? `${S.site.prefix}-${a.id}` : "DOC");
export const href = (a) => (a.kind === "adr" ? `#/adr/${a.id}` : `#/doc/${encodeURIComponent(a.id)}`);
export const statusLabel = (k) => S.site.statuses[k]?.label ?? k;
export const pill = (a, lg = false) => (a.status ? `<span class="ak-pill${lg ? " ak-pill--lg" : ""} ak-st-${esc(a.statusKey)}">${esc(a.status)}</span>` : `<span class="ak-pill ak-st-doc">Doc</span>`);
export const tagChip = (t, on = false, count) => `<a class="ak-chip ak-chip--tag${on ? " on" : ""}" href="#/tag/${encodeURIComponent(t)}">${esc(t)}${count != null ? ` <b>${count}</b>` : ""}</a>`;
export const nodeChip = (id) => {
  const n = S.site.architecture?.nodes[id];
  return `<a class="ak-chip ak-chip--node" href="#/map/${encodeURIComponent(n?.parent ?? "")}?sel=${encodeURIComponent(id)}">${esc(n?.label ?? id)}</a>`;
};
export const refChip = (a) => `<a class="ak-chip ak-st ak-st-${esc(a.statusKey)}" href="${href(a)}" data-ref="${esc(a.id)}">${esc(label(a))}</a>`;

// The one-line gist of a decision, in priority order.
export function gist(a) {
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
