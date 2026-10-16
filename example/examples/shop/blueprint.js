// Blueprint drawing parts built from the answer-me-with-html classes: a sheet frame with
// rulers, lettered panels, a title block, status cells, a horizontal timeline, an org tree
// and limit-style bars. Views compose these from ADR data, so pages need no extra writing.
import { S, esc, href, label, statusLabel } from "./util.js";

const ICON = { accepted: "✓", rejected: "✗", open: "?", proposed: "○", superseded: "↷", deprecated: "–", doc: "▤" };

// Sheet frame: double border with numbered columns and lettered rows, like a drawing sheet.
export function sheet(inner, { cols = 8, rows = 4 } = {}) {
  const nums = Array.from({ length: cols }, (_, i) => i + 1);
  const letters = Array.from({ length: rows }, (_, i) => String.fromCharCode(65 + i));
  const ruler = (side, labels) => `<div class="am-ruler am-ruler--${side}" aria-hidden="true">${labels.map((l) => `<span>${l}</span>`).join("")}</div>`;
  return `<div class="am-frame ak-frame">${ruler("top", nums)}${ruler("bottom", nums)}${ruler("left", letters)}${ruler("right", letters)}${inner}</div>`;
}

// Lettered panel. span/rows are grid spans inside .ak-sheet-grid.
export function panel(id, title, body, { meta = "", span = 1, rows = 1, flush = false, cls = "" } = {}) {
  const style = [span > 1 ? `grid-column: span ${span}` : "", rows > 1 ? `grid-row: span ${rows}` : ""].filter(Boolean).join(";");
  return `<section class="am-panel ak-sp${span > 1 ? ` ak-sp-${span}` : ""} ${cls}"${style ? ` style="${style}"` : ""}>
<header class="am-panel-head"><span class="am-panel-id">${esc(id)}</span><h2>${esc(title)}</h2>${meta ? `<span class="am-panel-meta">${meta}</span>` : ""}</header>
<div class="am-panel-body${flush ? " ak-flush" : ""}">${body}</div></section>`;
}

// Title block: one wide cell, then label/value cells in a grid.
export function titleBlock(cells, cols = 2) {
  return `<dl class="am-kv ak-kv" style="--kv-cols: ${cols}">${cells
    .filter((c) => c && c.value !== "" && c.value != null)
    .map((c) => `<div class="am-kv-cell${c.wide ? " am-kv-cell--wide" : ""}"${c.span ? ` style="grid-column: span ${c.span}"` : ""}><dt>${esc(c.label)}</dt><dd>${c.html ?? esc(c.value)}</dd></div>`)
    .join("")}</dl>`;
}

export function statusCell(a) {
  const k = a.statusKey;
  return `<span class="ak-stc ak-st-${esc(k)}"><i aria-hidden="true">${ICON[k] ?? "•"}</i>${esc(a.status || statusLabel(k))}</span>`;
}

// Register: the decisions as a ruled table, like a specification's approved/not-approved list.
export function register(items, { limit } = {}) {
  const rows = (limit ? items.slice(0, limit) : items)
    .map((a) => {
      const f = a.facts ?? {};
      const what = f.decision ?? f.recommendation ?? f.question ?? a.subtitle ?? "";
      const kind = f.decision ? "" : f.recommendation ? "leaning" : f.question ? "question" : "";
      return `<tr><td class="mono"><a href="${href(a)}" data-ref="${esc(a.id)}">${esc(label(a))}</a></td><td><a class="ak-reg-title" href="${href(a)}">${esc(a.title)}</a></td><td class="ak-reg-what">${kind ? `<em>${kind}</em> ` : ""}${esc(clip(what, 120))}</td><td>${statusCell(a)}</td></tr>`;
    })
    .join("");
  return `<div class="am-md"><div class="am-table-wrap"><table class="ak-reg"><thead><tr><th>Record</th><th>Title</th><th>Decision</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + "…" : String(s));

// Horizontal history: decisions grouped by date (newest last), at most `max` stops.
export function history(items, max = 5) {
  const by = new Map();
  for (const a of items) {
    const d = a.date || "undated";
    if (!by.has(d)) by.set(d, []);
    by.get(d).push(a);
  }
  const stops = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-max);
  if (!stops.length) return `<div class="ak-empty">No dated decisions.</div>`;
  const li = stops
    .map(([d, list], i) => {
      const acc = list.filter((a) => a.statusKey === "accepted").length;
      const title = `${list.length} record${list.length > 1 ? "s" : ""}${acc ? ` · ${acc} accepted` : ""}`;
      const names = list.slice(0, 3).map((a) => `<a href="${href(a)}" data-ref="${esc(a.id)}">${esc(a.id)}</a> ${esc(clip(a.title, 28))}`).join("<br>") + (list.length > 3 ? `<br>+${list.length - 3} more` : "");
      return `<li class="am-tl-item${i === stops.length - 1 ? " am-tl-item--hi" : ""}"><span class="am-tl-when">${esc(d)}</span><span class="am-tl-dot"></span><span class="am-tl-title">${title}</span><span class="am-tl-text">${names}</span></li>`;
    })
    .join("");
  return `<ol class="am-timeline am-timeline--h" style="--n: ${stops.length}">${li}</ol>`;
}

// Architecture as an org tree: root, then top-level areas as columns with their children.
export function archTree(max = 4) {
  const arch = S.site.architecture;
  if (!arch) return `<div class="ak-empty">No architecture map. Add <code>architecture.yaml</code>.</div>`;
  const roots = arch.roots.map((id) => arch.nodes[id]);
  const big = roots.filter((n) => n.children.length).sort((a, b) => b.deep.length - a.deep.length);
  const cols = big.slice(0, max);
  const rest = roots.filter((n) => !cols.includes(n));
  const li = (n) => `<li><a class="am-tree-label" href="#/map/${encodeURIComponent(n.parent ?? "")}?sel=${encodeURIComponent(n.id)}"><span class="am-tree-tag">${n.deep.length}</span> ${esc(n.label)}</a>${n.sub ? `<span class="am-tree-sub">${esc(clip(n.sub, 40))}</span>` : ""}</li>`;
  const col = (title, sub, list, href0) => `<div class="am-tree-col"><a class="am-tree-box" href="${href0}">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</a><ul class="am-tree-list">${list.map(li).join("")}</ul></div>`;
  const columns = cols.map((n) => col(n.label, `${n.deep.length} decisions`, n.children.map((c) => arch.nodes[c]), `#/map/${encodeURIComponent(n.id)}`));
  if (rest.length) columns.push(col("Other areas", `${rest.length} components`, rest, "#/map"));
  const total = new Set(Object.values(arch.nodes).flatMap((x) => x.adrs)).size;
  return `<div class="am-tree ak-tree"><div class="am-tree-root"><a class="am-tree-box am-tree-box--root" href="#/map">${esc(arch.title)}<small>${Object.keys(arch.nodes).length} components · ${total} decisions</small></a></div><div class="am-tree-cols" style="--n: ${columns.length}">${columns.join("")}</div></div>`;
}

// Status mix per area: one ruled bar per top-level area, segments by status.
export function areaBars(order) {
  const arch = S.site.architecture;
  if (!arch) return "";
  const areas = arch.roots.map((id) => arch.nodes[id]).filter((n) => n.deep.length).sort((a, b) => b.deep.length - a.deep.length);
  const max = Math.max(1, ...areas.map((n) => n.deep.length));
  const scale = Math.max(4, Math.ceil(max / 4) * 4);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${Math.round(f * scale)}</span>`).join("");
  return `<div class="am-limits">${areas
    .map((n) => {
      const list = n.deep.map((id) => S.byId.get(id)).filter(Boolean);
      const segs = order
        .map((k) => [k, list.filter((a) => a.statusKey === k).length])
        .filter(([, c]) => c)
        .map(([k, c]) => `<span class="ak-st-${k}" style="width:${(c / scale) * 100}%" title="${esc(statusLabel(k))}: ${c}"></span>`)
        .join("");
      const open = list.filter((a) => a.statusKey === "open").length;
      return `<div class="am-lim"><div class="am-lim-head"><a href="#/map/${encodeURIComponent(n.id)}">${esc(n.label)}</a><span class="am-lim-val">${list.length} decisions${open ? ` · ${open} open` : ""}</span></div><div class="am-lim-track ak-segs">${segs}</div><div class="am-lim-ticks" aria-hidden="true">${ticks}</div></div>`;
    })
    .join("")}</div>`;
}
