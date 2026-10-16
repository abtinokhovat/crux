// The domain model: every entity in a frame of the service that owns it, with the relations
// crux calculates from the entity fields (fk, list types, _id names). Lines are square and run
// in lanes between columns; crow's-foot ends show how many. Also used, smaller, on entity pages.
import { S, esc, href } from "./util.js";
import { elChip } from "./system.js";
import { bindIde, panZoom } from "./ide.js";

const BW = 236, HEAD = 44, ROW = 20, FOOT = 10, GAP_Y = 18, LANE = 120, PAD = 16, FRAME_HEAD = 34, INSET = 18, RIGHT = 64; // RIGHT: lanes for lines inside a frame

const entities = () => (S.site.elements ?? []).filter((e) => e.kind === "entity");
const serviceOf = (id) => {
  for (let e = S.byId.get(id); e; e = S.byId.get(e.parent)) if (["service", "app", "job"].includes(e.kind)) return e;
  return null;
};
const ownerPath = (svc) => {
  const out = [];
  for (let e = svc && S.byId.get(svc.parent); e && e.kind !== "system"; e = S.byId.get(e.parent)) out.unshift(e.title);
  return out;
};

// A cardinality is how many of the target one source has. Each end of a relation is
// { min: 0 | 1, many: bool }.
function range(card = "1..1") {
  const [a = "1", b = a] = String(card).split("..");
  const many = (x) => /^[nm*]$/.test(x) || Number(x) > 1;
  return { min: a === "0" ? 0 : 1, many: many(b) || many(a) };
}

// One relation per pair of entities: "order has order-line 1..n" and "order-line references
// order" are the same line seen from both sides. The end at entity E says how many E one
// entity on the other side has: from a link pointing at E (references first, it is the more
// exact), else from the link E starts (a list's parent is one; a referrer can be many).
export function relations(ids) {
  const keep = ids ? new Set(ids) : null;
  const byPair = new Map();
  for (const l of S.site.links ?? []) {
    if (l.type !== "references" && l.type !== "has") continue;
    if (keep && !(keep.has(l.from) && keep.has(l.to))) continue;
    const [a, b] = [l.from, l.to].sort();
    const k = `${a}|${b}`;
    if (!byPair.has(k)) byPair.set(k, { a, b, ends: {}, labels: [], implied: true, links: [] });
    const r = byPair.get(k);
    r.links.push(l);
    if (l.label) r.labels.push({ on: l.from, name: l.label });
    r.implied &&= !!l.implied;
  }
  for (const r of byPair.values()) {
    for (const id of [r.a, r.b]) {
      const into = r.links.filter((l) => l.to === id).sort((x, y) => (x.type === "references" ? -1 : 1) - (y.type === "references" ? -1 : 1))[0];
      const out = r.links.find((l) => l.from === id);
      r.ends[id] = into ? range(into.card) : out?.type === "has" ? { min: 1, many: /m/.test(out.card ?? "") } : { min: 0, many: true };
    }
    const sa = serviceOf(r.a), sb = serviceOf(r.b);
    r.cross = !!(sa && sb && sa.id !== sb.id);
  }
  return [...byPair.values()];
}

const say = (end) => (end.many ? (end.min ? "one or more" : "zero or more") : end.min ? "exactly one" : "zero or one");
export const relationText = (r, from = r.a) => {
  const to = from === r.a ? r.b : r.a;
  const name = (id) => S.byId.get(id)?.title ?? id;
  return `each ${name(from)} has ${say(r.ends[to])} ${name(to)}; each ${name(to)} has ${say(r.ends[from])} ${name(from)}`;
};

// ── layout ───────────────────────────────────────────────
function layout(list, rels, { fields }) {
  const groups = new Map();
  for (const e of list) {
    const svc = serviceOf(e.id);
    const k = svc?.id ?? "";
    if (!groups.has(k)) groups.set(k, { svc, items: [] });
    groups.get(k).items.push(e);
  }
  // frames with the most relations between them sit next to each other: order by degree
  const degree = (id) => rels.filter((r) => r.a === id || r.b === id).length;
  const frames = [...groups.values()].sort((x, y) => (x.svc ? 0 : 1) - (y.svc ? 0 : 1) || y.items.reduce((n, e) => n + degree(e.id), 0) - x.items.reduce((n, e) => n + degree(e.id), 0) || String(x.svc?.title).localeCompare(String(y.svc?.title)));
  const boxH = (e) => HEAD + (fields ? (e.fields?.length ?? 0) * ROW : 0) + FOOT;
  const pos = new Map();
  let x = PAD, maxY = 0;
  const frameBoxes = [];
  for (const f of frames) {
    // parents above children inside a frame
    f.items.sort((p, c) => (rels.some((r) => r.links.some((l) => l.type === "has" && l.from === p.id && l.to === c.id)) ? -1 : 0) || degree(c.id) - degree(p.id) || p.title.localeCompare(c.title));
    const cols = Math.max(1, Math.ceil(f.items.length / 4));
    const fx = x;
    const colY = Array(cols).fill(PAD + FRAME_HEAD + 12);
    f.items.forEach((e, i) => {
      const c = i % cols;
      const bx = fx + INSET + c * (BW + RIGHT);
      pos.set(e.id, { x: bx, y: colY[c], w: BW, h: boxH(e), col: Math.round(bx) });
      colY[c] += boxH(e) + GAP_Y;
    });
    const fw = INSET + cols * (BW + RIGHT);
    const fh = Math.max(...colY) - PAD - GAP_Y + 14;
    frameBoxes.push({ f, x: fx, y: PAD, w: fw, h: fh });
    maxY = Math.max(maxY, PAD + fh);
    x = fx + fw + LANE;
  }
  return { pos, frames: frameBoxes, W: x - LANE + PAD, H: maxY + PAD };
}

// Square route between two boxes: out of a side, along a lane, into the other side.
function route(p, q, lanes, sy, ty) {
  let sx, tx, mid;
  if (q.x > p.x + p.w) { sx = p.x + p.w; tx = q.x; mid = sx + 18 + (lanes.next(sx) % 6) * 9; }
  else if (q.x + q.w < p.x) { sx = p.x; tx = q.x + q.w; mid = sx - 18 - (lanes.next(sx) % 6) * 9; }
  else { sx = p.x + p.w; tx = q.x + q.w; mid = Math.max(sx, tx) + 16 + (lanes.next(-sx) % 6) * 9; }
  return { d: `M${sx},${sy} H${mid} V${ty} H${tx}`, sx, tx, sy, ty, sDir: Math.sign(mid - sx), tDir: Math.sign(mid - tx) };
}
const counter = () => { const m = new Map(); return { next: (k) => { const v = m.get(k) ?? 0; m.set(k, v + 1); return v; } }; };

// Crow's-foot end at (x, y), pointing away from the box along dir (±1). Straight lines only.
function crowEnd(x, y, dir, end) {
  const out = [];
  const at = (d) => x + dir * d;
  if (end.many) out.push(`M${at(12)},${y} L${x},${y - 6} M${at(12)},${y} L${x},${y + 6} M${at(12)},${y} L${x},${y}`);
  else out.push(`M${at(7)},${y - 6} V${y + 6}`);
  if (end.min) out.push(`M${at(16)},${y - 6} V${y + 6}`);
  const o = !end.min ? `<rect class="er-opt" x="${at(19) - 3.5}" y="${y - 3.5}" width="7" height="7"/>` : "";
  return `<path class="er-end" d="${out.join(" ")}"/>${o}`;
}

// ── drawing ──────────────────────────────────────────────
export function modelSvg({ focus = "", fields = true, crossOnly = false } = {}) {
  let list = entities();
  if (focus) {
    const near = new Set([focus]);
    for (const r of relations()) if (r.a === focus || r.b === focus) { near.add(r.a); near.add(r.b); }
    list = list.filter((e) => near.has(e.id));
  }
  if (!list.length) return { svg: `<div class="ak-empty">No entities yet. Write a <code>crux: entity</code> file with an <code>\`\`\`entity</code> block.</div>`, rels: [] };
  let rels = relations(list.map((e) => e.id));
  if (crossOnly) rels = rels.filter((r) => r.cross);
  const { pos, frames, W, H } = layout(list, rels, { fields });
  const lanes = counter();
  const rowY = (e, name) => {
    const p = pos.get(e.id);
    const i = fields && name ? (e.fields ?? []).findIndex((f) => f.name === name) : -1;
    return i >= 0 ? p.y + HEAD + i * ROW + ROW / 2 : p.y + HEAD / 2;
  };
  const frameSvg = frames.map(({ f, x, y, w, h }) => {
    const svc = f.svc;
    const path = ownerPath(svc);
    const stores = [...new Set(f.items.map((e) => e.store).filter(Boolean))].map((id) => S.byId.get(id)?.title ?? id);
    const label = svc ? `${path.length ? `${path.join(" / ")} / ` : ""}${svc.title}` : "No owner";
    return `<g class="er-frame${svc ? "" : " is-orphan"}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><rect class="er-frame-head" x="${x}" y="${y}" width="${w}" height="${FRAME_HEAD}"/>${svc ? `<a href="${href(svc)}" data-el="${esc(svc.id)}">` : ""}<text class="er-frame-t" x="${x + 12}" y="${y + 21}">${esc(label.toUpperCase())}</text>${svc ? "</a>" : ""}<text class="er-frame-s" x="${x + w - 12}" y="${y + 21}" text-anchor="end">${esc(stores.join(" · "))}</text></g>`;
  }).join("");
  const edgeSvg = rels.map((r) => {
    // draw from the side that names the field (the fk side) so the line starts at that row
    const lab = r.labels.find((l) => l.on === r.a) ?? r.labels.find((l) => l.on === r.b);
    const from = lab?.on === r.b ? r.b : r.a, to = from === r.a ? r.b : r.a;
    const ef = S.byId.get(from), et = S.byId.get(to);
    const backLabel = r.labels.find((l) => l.on === to);
    const rt = route(pos.get(from), pos.get(to), lanes, rowY(ef, lab?.name), rowY(et, backLabel?.name));
    const cls = `er-rel${r.cross ? " is-cross" : ""}${r.implied ? " is-implied" : ""}`;
    return `<g class="${cls}" data-a="${esc(r.a)}" data-b="${esc(r.b)}"><title>${esc(relationText(r, from))}${r.cross ? " — across services" : ""}${r.implied ? " — calculated from a field name" : ""}</title><path class="er-line" d="${rt.d}"/>${crowEnd(rt.sx, rt.sy, rt.sDir, r.ends[from])}${crowEnd(rt.tx, rt.ty, rt.tDir, r.ends[to])}</g>`;
  }).join("");
  const boxSvg = list.map((e) => {
    const p = pos.get(e.id);
    const st = e.store ? S.byId.get(e.store) : null;
    const where = st ? `${st.title}${e.table ? `.${e.table}` : ""}` : "no store";
    const rows = fields ? (e.fields ?? []).map((f, i) => {
      const y = p.y + HEAD + i * ROW;
      const key = f.pk ? "PK" : f.fk || /\[\]$/.test(f.type ?? "") || relationsFor(rels, e.id, f.name) ? "FK" : "";
      return `<g class="er-field${key ? ` is-${key.toLowerCase()}` : ""}"><rect class="er-row" x="${p.x}" y="${y}" width="${p.w}" height="${ROW}"/><text class="er-key" x="${p.x + 8}" y="${y + 14}">${key}</text><text class="er-fname" x="${p.x + 32}" y="${y + 14}">${esc(clip(f.name, 16))}</text><text class="er-ftype" x="${p.x + p.w - 8}" y="${y + 14}" text-anchor="end">${esc(clip(f.type ?? "", 14))}</text></g>`;
    }).join("") : "";
    const more = !fields && e.fields?.length ? `<text class="er-more" x="${p.x + p.w - 8}" y="${p.y + HEAD - 2}" text-anchor="end">${e.fields.length} fields</text>` : "";
    return `<a href="${href(e)}" data-el="${esc(e.id)}"><g class="er-box${e.id === focus ? " is-focus" : ""}${st ? "" : " is-homeless"}" data-id="${esc(e.id)}"><rect class="er-body" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"/><rect class="er-head" x="${p.x}" y="${p.y}" width="${p.w}" height="${HEAD}"/><text class="er-tag" x="${p.x + 8}" y="${p.y + 14}">ENTITY · ${esc(where.toUpperCase())}</text><text class="er-name" x="${p.x + 8}" y="${p.y + 33}">${esc(clip(e.title, 26))}</text>${more}${rows}</g></a>`;
  }).join("");
  const svg = `<svg class="er-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Domain model: ${list.length} entities">${frameSvg}<g class="er-rels">${edgeSvg}</g>${boxSvg}</svg>`;
  return { svg, rels, list };
}
const relationsFor = (rels, id, field) => rels.some((r) => r.labels.some((l) => l.on === id && l.name === field));
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

const legend = `<div class="ak-legend er-legend"><span><svg viewBox="0 0 34 14" width="34" height="14"><path class="er-line" d="M0,7 H34"/><path class="er-end" d="M7,1 V13 M11,1 V13"/></svg>exactly one</span><span><svg viewBox="0 0 34 14" width="34" height="14"><path class="er-line" d="M0,7 H34"/><path class="er-end" d="M12,7 L0,1 M12,7 L0,13 M12,7 L0,7 M16,1 V13"/></svg>one or many</span><span><svg viewBox="0 0 34 14" width="34" height="14"><path class="er-line" d="M0,7 H34"/><path class="er-end" d="M7,1 V13"/><rect class="er-opt" x="15.5" y="3.5" width="7" height="7"/></svg>zero or one</span><span><svg viewBox="0 0 34 14" width="34" height="14"><path class="er-line is-cross-key" d="M0,7 H34"/></svg>across services</span><span class="muted">frames = owner service · ENTITY · store</span></div>`;

// ── page ─────────────────────────────────────────────────
// IDE layout: entities by owner on the left, the diagram as a pan/zoom canvas, details of the
// selected entity on the right. Relations and "where each entity lives" are tabs, not a long page.
export function renderModel(root, q) {
  const fields = q.get("fields") !== "0";
  const crossOnly = q.get("cross") === "1";
  const link = (patch) => { const p = new URLSearchParams({ fields: fields ? "" : "0", cross: crossOnly ? "1" : "", ...patch }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `#/model${p.toString() ? `?${p}` : ""}`; };
  const { svg, rels, list = [] } = modelSvg({ fields, crossOnly });
  const all = relations();
  const cross = all.filter((r) => r.cross).length;
  const svcs = new Set(list.map((e) => serviceOf(e.id)?.id ?? ""));
  const homeless = list.filter((e) => !e.store).length;
  const name = (id) => S.byId.get(id)?.title ?? id;
  const relRows = all.map((r) => {
    const lab = r.labels.map((l) => `${esc(name(l.on))}.<b>${esc(l.name)}</b>`).join(", ");
    return `<tr class="${r.cross ? "is-cross" : ""}"><td>${elChip(S.byId.get(r.a))}</td><td class="er-card">${esc(relationText(r))}</td><td>${elChip(S.byId.get(r.b))}</td><td class="mono er-via">${lab || "—"}</td><td>${r.cross ? `<span class="er-flag">across services</span>` : `<span class="muted">same service</span>`}${r.implied ? ` <span class="ak-origin ak-origin--implied" title="calculated from a field name">from name</span>` : ""}</td></tr>`;
  }).join("");
  const homes = entities().map((e) => {
    const svc = serviceOf(e.id), st = e.store ? S.byId.get(e.store) : null;
    return `<tr><td>${elChip(e)}</td><td>${svc ? elChip(svc) : `<span class="ak-miss">no owner</span>`}</td><td>${st ? `${elChip(st)}${e.table ? ` <code>${esc(e.table)}</code>` : ""}${e.storeInferred ? ` <span class="muted" title="the one store its owner writes">calculated</span>` : ""}` : `<span class="ak-miss">no store</span>`}</td><td class="mono er-code">${esc(e.code?.length ? e.code.join(", ") : e.file ?? "")}</td><td class="mono">${e.fields?.length ?? 0}</td></tr>`;
  }).join("");

  // explorer: entities grouped by owner
  const groups = new Map();
  for (const e of list) {
    const svc = serviceOf(e.id);
    const k = svc?.id ?? "";
    if (!groups.has(k)) groups.set(k, { svc, items: [] });
    groups.get(k).items.push(e);
  }
  const tree = [...groups.values()].map(({ svc, items }) => `<li class="tree-grp" data-text="${esc(`${svc?.title ?? "no owner"} ${items.map((e) => e.title).join(" ")}`.toLowerCase())}"><div class="tree-gh">${esc(svc ? svc.title : "No owner")} <b>${items.length}</b></div><ul>${items.map((e) => `<li data-text="${esc(e.title.toLowerCase())}"><button type="button" class="tree-row" data-id="${esc(e.id)}"><span class="tn">${esc(e.title)}</span><span class="tk">${e.fields?.length ?? 0} fields</span></button></li>`).join("")}</ul></li>`).join("");

  root.innerHTML = `<div class="ide" data-ide="model">
<aside class="ide-pane ide-left" aria-label="Entities"><header class="ide-head"><h2>Entities</h2><button type="button" class="m-ov-x" data-ide-toggle="l" aria-label="Hide entities">×</button></header>
  <input class="ide-search" id="er-find" type="search" placeholder="Find an entity…" aria-label="Find an entity"><div class="ide-body"><ul class="tree" id="er-tree">${tree || `<li class="tree-more">No entities yet</li>`}</ul></div></aside>
<div class="ide-split" data-side="l" role="separator" aria-orientation="vertical"></div>
<section class="ide-center">
  <header class="ide-bar">
    <div class="ide-title"><h1><span class="m-lvl">M</span>Domain model</h1><p>${list.length} entities · ${all.length} relations · ${cross} across services · in ${svcs.size} service${svcs.size === 1 ? "" : "s"}${homeless ? ` · ${homeless} without a store` : ""}</p></div>
    <div class="ide-tabs" role="tablist"><button type="button" role="tab" data-tab="canvas" aria-selected="true">Canvas</button><button type="button" role="tab" data-tab="rels" aria-selected="false">Relations <b>${all.length}</b></button><button type="button" role="tab" data-tab="homes" aria-selected="false">Where they live</button></div>
    <div class="ide-tools"><a class="ak-btn${fields ? " on" : ""}" href="${link({ fields: fields ? "0" : "" })}" aria-pressed="${fields}">Fields</a><a class="ak-btn${crossOnly ? " on" : ""}" href="${link({ cross: crossOnly ? "" : "1" })}" aria-pressed="${crossOnly}">Only across services <b>${cross}</b></a>
      <button class="ak-btn" type="button" data-ide-toggle="l" aria-pressed="true">Entities</button><button class="ak-btn" type="button" data-ide-toggle="r" aria-pressed="true">Details</button></div>
  </header>
  <div class="ide-stage">
    <div class="pz-host er-pz" id="er-canvas">${svg}</div>
    <div class="ide-body pad" id="er-rels" hidden><div class="am-md"><div class="am-table-wrap"><table class="er-table"><thead><tr><th>Entity</th><th>How many</th><th>Entity</th><th>Through</th><th>Boundary</th></tr></thead><tbody>${relRows || `<tr><td colspan="5" class="muted">No relations. Use <code>fk other</code>, a list type <code>other[]</code>, or an <code>other_id</code> field.</td></tr>`}</tbody></table></div></div></div>
    <div class="ide-body pad" id="er-homes" hidden><div class="am-md"><div class="am-table-wrap"><table class="er-table"><thead><tr><th>Entity</th><th>Owner</th><th>Store</th><th>Code</th><th>Fields</th></tr></thead><tbody>${homes}</tbody></table></div></div></div>
  </div>
  <div class="ide-foot er-foot">${legend}</div>
</section>
<div class="ide-split" data-side="r" role="separator" aria-orientation="vertical"></div>
<aside class="ide-pane ide-right" aria-live="polite"><header class="ide-head"><h2>Details</h2><button type="button" class="m-ov-x" data-ide-toggle="r" aria-label="Hide details">×</button></header><div class="ide-body m-detail-body" id="er-detail"></div></aside>
</div>`;
  root.style.setProperty("--m-top", `${document.querySelector(".ak-top")?.offsetHeight ?? 49}px`);
  const unbindIde = bindIde(root);
  const host = root.querySelector("#er-canvas");
  const svgEl = host.querySelector("svg.er-svg");
  const pz = svgEl ? panZoom(host, svgEl) : null;
  const unhover = bindHover(root);

  // ── selection ──
  const detail = root.querySelector("#er-detail");
  const summary = () => `<div class="ak-mini-label">Whole model</div><p class="muted">Select an entity on the canvas or in the list. Drag to pan, ctrl/⌘ + wheel or pinch to zoom.</p><div class="ak-chips"><span class="ak-chip">${list.length} entities</span><span class="ak-chip">${all.length} relations</span><span class="ak-chip">${cross} across services</span></div>`;
  const show = (id) => {
    const e = id && S.byId.get(id);
    for (const b of root.querySelectorAll(".er-box")) b.classList.toggle("is-focus", !!e && b.dataset.id === id);
    for (const r of root.querySelectorAll("#er-tree .tree-row")) r.classList.toggle("is-sel", !!e && r.dataset.id === id);
    if (!e) return void (detail.innerHTML = summary());
    const mine = all.filter((r) => r.a === id || r.b === id);
    const fieldRows = (e.fields ?? []).map((f) => `<tr><td class="mono">${f.pk ? "PK " : f.fk ? "FK " : ""}</td><td class="mono"><b>${esc(f.name)}</b></td><td class="mono muted">${esc(f.type ?? "")}</td></tr>`).join("");
    detail.innerHTML = `<div class="kind">ENTITY</div><h3>${esc(e.title)}</h3>${e.subtitle ? `<p class="muted">${esc(e.subtitle)}</p>` : ""}
<p><a class="ak-btn" href="${href(e)}">Open page →</a></p><div class="ak-mini-label">Lives in</div>${homeHtml(e)}
${mine.length ? `<div class="ak-mini-label" style="margin-top:12px">Relations · ${mine.length}</div><ul class="er-says">${mine.map((r) => `<li>${esc(relationText(r, id === r.b ? r.b : r.a))}${r.cross ? ` <span class="er-flag">across services</span>` : ""}</li>`).join("")}</ul>` : `<p class="muted">No relations calculated.</p>`}
${fieldRows ? `<div class="ak-mini-label" style="margin-top:12px">Fields · ${e.fields.length}</div><div class="am-md"><div class="am-table-wrap"><table class="er-table er-fields"><tbody>${fieldRows}</tbody></table></div></div>` : ""}`;
    const p = root.querySelector(`.er-box[data-id="${CSS.escape(id)}"] .er-body`);
    if (p && pz) pz.reveal(Number(p.getAttribute("x")), Number(p.getAttribute("y")), Number(p.getAttribute("width")), Number(p.getAttribute("height")));
  };
  show(null);
  host.addEventListener("click", (ev) => {
    const box = ev.target.closest(".er-box");
    if (!box) return show(null);
    ev.preventDefault();
    show(box.dataset.id);
  });
  host.addEventListener("dblclick", (ev) => {
    const a = ev.target.closest("a[data-el]");
    if (a) location.hash = a.getAttribute("href");
  });
  root.querySelector("#er-tree").addEventListener("click", (ev) => {
    const r = ev.target.closest(".tree-row");
    if (!r) return;
    tab("canvas");
    show(r.dataset.id);
  });
  root.querySelector("#er-find").addEventListener("input", (ev) => {
    const text = ev.target.value.trim().toLowerCase();
    for (const li of root.querySelectorAll("#er-tree li")) {
      if (li.classList.contains("tree-grp")) continue;
      li.classList.toggle("is-hidden", !!text && !li.dataset.text.includes(text));
    }
    for (const g of root.querySelectorAll("#er-tree .tree-grp")) g.classList.toggle("is-hidden", !!text && ![...g.querySelectorAll("li")].some((li) => !li.classList.contains("is-hidden")));
  });
  const tab = (t) => {
    for (const b of root.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === t));
    host.hidden = t !== "canvas";
    root.querySelector("#er-rels").hidden = t !== "rels";
    root.querySelector("#er-homes").hidden = t !== "homes";
    if (t === "canvas") window.dispatchEvent(new Event("resize"));
  };
  root.querySelector(".ide-tabs").addEventListener("click", (ev) => { const b = ev.target.closest("[data-tab]"); if (b) tab(b.dataset.tab); });
  return () => { unbindIde(); unhover(); pz?.destroy(); };
}

// Hovering an entity lights its relations and dims the rest.
export function bindHover(root) {
  const on = (ev) => {
    const box = ev.target.closest?.(".er-box");
    const svg = ev.target.closest?.(".er-svg");
    if (!svg) return;
    const id = box?.dataset.id ?? "";
    svg.classList.toggle("is-hovering", !!id);
    for (const g of svg.querySelectorAll(".er-rel")) g.classList.toggle("is-lit", !!id && (g.dataset.a === id || g.dataset.b === id));
    for (const b of svg.querySelectorAll(".er-box")) b.classList.toggle("is-lit", !!id && (b.dataset.id === id || [...svg.querySelectorAll(".er-rel.is-lit")].some((g) => g.dataset.a === b.dataset.id || g.dataset.b === b.dataset.id)));
  };
  root.addEventListener("mouseover", on);
  return () => root.removeEventListener("mouseover", on);
}

// Entity page parts: where it lives, and its relations as a small map.
export function homeHtml(e) {
  const svc = serviceOf(e.id), st = e.store ? S.byId.get(e.store) : null;
  return `<span class="ak-chips">${svc ? elChip(svc) : `<span class="ak-miss">no owner</span>`}${st ? `${elChip(st)}${e.table ? `<code>${esc(e.table)}</code>` : ""}` : `<span class="ak-miss">no store</span>`}</span>`;
}
export function entityRelations(e) {
  const { svg, rels } = modelSvg({ focus: e.id });
  if (!rels.length) return `<div class="ak-empty">No relations calculated. Add <code>fk other</code>, a list type <code>other[]</code>, or an <code>other_id</code> field.</div>`;
  return `<div class="er-canvas er-canvas--small">${svg}</div>${legend}<ul class="er-says">${rels.map((r) => `<li>${esc(relationText(r, e.id === r.b ? r.b : r.a))}${r.cross ? ` <span class="er-flag">across services</span>` : ""}</li>`).join("")}</ul>`;
}
