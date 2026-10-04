// Zoomable architecture map from architecture.yaml, drawn like a hand-made blueprint:
// boxes with a mono tag line, straight arrows clipped at the box border, labels on the line,
// dashed group frames, and a zoom that grows out of the box you open.
// Each level shows the children of one node; a leaf (or a node's own band) shows its ADRs.
import { $, S, esc, gist, href, label, pill, statusLabel, svgEl, tagChip, wrapText } from "./util.js";
import { md } from "./vendor/crux-render.js";

const NW = 200, NH = 70, GX = 170, GY = 56;
const AW = 250, AH = 92, AGX = 120;
const CHAR_W = 6.7;

// Set by a zoom click so the next level can finish the animation.
let entering = null;

export function renderMap(root, nodeId, q) {
  const arch = S.site.architecture;
  if (!arch) {
    root.innerHTML = `<div class="ak-page-head"><div><h1>Architecture</h1><p>No architecture map yet.</p></div></div>
<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">?</span><h2>Create architecture.yaml</h2></header><div class="am-panel-body am-md"><p>Path is set by <code>architecture</code> in crux.config.yaml:</p>
<pre class="am-code"><code>title: Platform
nodes:
  - id: messaging
    label: Message broker
    kind: infra
    children:
      - id: kafka
        label: Kafka
        kind: tech
        adrs: [4]          # or "components: [kafka]" in the ADR frontmatter
edges:
  - api -> kafka: domain events</code></pre></div></section>`;
    return null;
  }
  const node = nodeId ? arch.nodes[nodeId] : null;
  if (nodeId && !node) {
    root.innerHTML = `<div class="ak-empty">Unknown component “${esc(nodeId)}”. <a href="#/map">Back to the top level</a></div>`;
    return null;
  }

  const path = [];
  for (let n = node; n; n = arch.nodes[n.parent]) path.unshift(n);
  const isAdrLevel = node && !node.children.length;
  const title = node ? node.label : arch.title;
  const hint = isAdrLevel
    ? "Each box is a decision. Select it to preview; double-click or Enter opens it."
    : "Select a box to see its decisions. Boxes marked “zoom in ›” open the next level. Zoom out with the button, the breadcrumb, Esc, or a pinch.";

  root.innerHTML = `<div class="ak-page-head"><div><h1>${esc(title)}</h1><p>${esc(node ? node.sub || node.desc?.split("\n")[0] || "" : arch.desc || "")}</p></div></div>
<div class="ak-mapbar"><nav class="ak-crumbs" aria-label="Level"><button type="button" data-go=""${!node ? " aria-current" : ""}>${esc(arch.title)}</button>${path.map((n, i) => `<i>/</i><button type="button" data-go="${esc(n.id)}"${i === path.length - 1 ? " aria-current" : ""}>${esc(n.label)}</button>`).join("")}</nav>
<button class="ak-btn" id="m-out" type="button"${node ? "" : " disabled"}>− Zoom out</button><button class="ak-btn" id="m-in" type="button" disabled>+ Zoom in</button></div>
<div class="ak-map-layout">
  <section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">L${path.length}</span><h2>${isAdrLevel ? `${esc(node.label)} — decisions` : esc(title)}</h2><span class="am-panel-meta" id="m-meta"></span></header>
    <div class="m-canvas"><svg class="ak-canvas" id="m-svg" role="img" aria-label="${esc(title)}"><defs>
      <marker id="m-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="m-arrow"/></marker>
      <marker id="m-arr-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="m-arrow m-arrow--hot"/></marker>
    </defs><g id="m-stage"></g></svg></div>
    <div class="m-foot">${legend(isAdrLevel)}<div class="ak-maphint">${esc(hint)}</div></div>
  </section>
  <aside class="am-panel m-detail" aria-live="polite"><header class="am-panel-head"><span class="am-panel-id">i</span><h2>Details</h2></header><div class="am-panel-body" id="m-detail"></div></aside>
</div>`;

  const svg = $("#m-svg");
  const stage = $("#m-stage");

  // ── items, edges, layout ──
  let items = isAdrLevel ? adrItems(node.deep) : nodeItems(node ? node.children : arch.roots);
  const edges = isAdrLevel ? adrEdges(items) : liftedEdges(items);
  // Inner levels: neighbours outside this node appear as ghost boxes, so the flow stays readable.
  // A fully pinned level is hand-drawn; leave it alone.
  if (!isAdrLevel && node && !items.every((n) => n.fx != null && n.fy != null)) {
    const g = ghostEdges(node, items);
    items = items.concat(g.items);
    edges.push(...g.edges);
  }
  layout(items, edges);
  let band = null;
  if (!isAdrLevel && node?.adrs.length) {
    // A node with children and its own decisions: decisions sit in a band under the components.
    const own = adrItems(node.adrs);
    const ownEdges = adrEdges(own);
    grid(own, 0, 4);
    const top = Math.max(...items.map((n) => n.y + n.h)) + 76;
    for (const n of own) n.y += top;
    band = { y: top - 40, label: `Decisions about ${node.label}` };
    items = items.concat(own);
    edges.push(...ownEdges);
  }

  const pad = 24;
  const minX = Math.min(...items.map((n) => n.x)) - pad, minY = Math.min(...items.map((n) => n.y)) - pad - (groupsFor(node).length ? 14 : 0);
  const maxX = Math.max(...items.map((n) => n.x + n.w)) + pad, maxY = Math.max(...items.map((n) => n.y + n.h)) + pad;
  const vw = Math.max(maxX - minX, 600), vh = maxY - minY;
  svg.setAttribute("viewBox", `${minX} ${minY} ${vw} ${vh}`);
  svg.style.minWidth = `${Math.max(Math.min(vw, 760), Math.round(vw * 0.85))}px`;
  const cx = minX + vw / 2, cy = minY + vh / 2;

  const byId = new Map(items.map((n) => [n.id, n]));
  for (const g of groupsFor(node)) drawGroup(stage, g, byId);
  if (band) {
    svgEl("line", { class: "m-band-line", x1: minX + 8, x2: minX + vw - 8, y1: band.y, y2: band.y }, stage);
    svgEl("text", { class: "m-band", x: minX + pad, y: band.y + 20 }, stage).textContent = band.label.toUpperCase();
  }
  const edgeLayer = svgEl("g", {}, stage);
  // Decision cards in the band under the components route among themselves only.
  const straight = (node ? node.lines : S.site.architecture.lines) === "straight";
  const inBand = (n) => !!n.adr && !isAdrLevel;
  const ends = assignPorts(edges, byId, items);
  for (const band of [true, false]) {
    const own = ends.filter((end) => inBand(end.a) === band);
    routeEdges(own, items.filter((n) => inBand(n) === band), straight);
  }
  const pending = ends.map((end) => drawEdge(edgeLayer, end)).filter(Boolean);
  for (const n of items) (n.adr ? drawAdr : n.ghost ? drawGhost : drawNode)(stage, n);
  // Labels go last, on top of boxes, placed where they hit no box and no other label.
  placeLabels(svgEl("g", { class: "m-labels" }, stage), pending, items);
  $("#m-meta").textContent = isAdrLevel ? `${items.length} decisions` : `${items.filter((n) => !n.adr).length} components · ${node ? node.deep.length : new Set(Object.values(arch.nodes).flatMap((x) => x.adrs)).size} decisions`;

  // ── entrance: finish the zoom started on the previous level ──
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (entering && !reduce) {
    stage.style.transition = "none";
    stage.style.transformOrigin = `${cx}px ${cy}px`;
    stage.style.transform = entering === "in" ? "scale(0.6)" : "scale(1.6)";
    stage.style.opacity = "0";
    stage.getBoundingClientRect();
    stage.style.transition = "";
    stage.style.transform = "scale(1)";
    stage.style.opacity = "1";
  }
  entering = null;

  // ── selection ──
  let selected = null;
  const select = (id) => {
    selected = id && byId.has(id) ? id : null;
    const near = new Set(selected ? [selected] : []);
    for (const e of edges) if (e.from === selected || e.to === selected) { near.add(e.from); near.add(e.to); }
    for (const el of stage.querySelectorAll(".m-node")) {
      el.classList.toggle("sel", el.dataset.id === selected);
      el.classList.toggle("dim", !!selected && !near.has(el.dataset.id));
    }
    for (const el of stage.querySelectorAll(".m-edge")) {
      const on = !!selected && (el.dataset.from === selected || el.dataset.to === selected);
      el.classList.toggle("hot", on);
      el.classList.toggle("dim", !!selected && !on);
      el.classList.toggle("show", on);
      const p = el.querySelector("path");
      if (!p) continue; // label-only group in the top layer
      if (p.hasAttribute("marker-end")) p.setAttribute("marker-end", on ? "url(#m-arr-hot)" : "url(#m-arr)");
      if (p.hasAttribute("marker-start")) p.setAttribute("marker-start", on ? "url(#m-arr-hot)" : "url(#m-arr)");
    }
    const it = selected && byId.get(selected);
    $("#m-detail").innerHTML = it?.ghost ? ghostDetail(it.ghost) : it?.adr ? adrDetail(it.adr) : isAdrLevel ? nodeDetail(node, false) : nodeDetail(selected ? arch.nodes[selected] : node, !!selected);
    $("#m-in").disabled = !(it && (it.adr || it.ghost || drillable(it.node)));
  };

  const go = (target, dir, from) => {
    if (target == null) return;
    const hash = target ? `#/map/${encodeURIComponent(target)}` : "#/map";
    if (reduce) return void (location.hash = hash);
    const origin = from ? [from.x + from.w / 2, from.y + from.h / 2] : [cx, cy];
    stage.style.transformOrigin = `${origin[0]}px ${origin[1]}px`;
    stage.style.transform = dir === "in" ? "scale(2.4)" : "scale(0.5)";
    stage.style.opacity = "0";
    entering = dir;
    setTimeout(() => (location.hash = hash), 280);
  };
  const zoomIn = (id) => {
    const it = byId.get(id ?? selected);
    if (it?.adr) return void (location.hash = href(it.adr).slice(1));
    if (it?.ghost) return go(it.ghost.parent ?? "", "out");
    if (it && drillable(it.node)) go(it.id, "in", it);
  };
  const zoomOut = () => node && go(node.parent ?? "", "out");

  // Click selects; clicking the selected box again zooms into it (or opens the decision).
  svg.addEventListener("click", (ev) => {
    const id = ev.target.closest(".m-node")?.dataset.id ?? null;
    if (id && id === selected) zoomIn(id);
    else select(id);
  });
  svg.addEventListener("dblclick", (ev) => {
    const g = ev.target.closest(".m-node");
    if (g) zoomIn(g.dataset.id);
  });
  svg.addEventListener("keydown", (ev) => {
    const g = ev.target.closest(".m-node");
    if (!g || (ev.key !== "Enter" && ev.key !== " ")) return;
    ev.preventDefault();
    if (selected === g.dataset.id) zoomIn(g.dataset.id);
    else select(g.dataset.id);
  });
  // Pinch on a trackpad (ctrl + wheel): out goes up a level, in opens the box under the pointer.
  let wheelLock = 0;
  svg.addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    const now = Date.now();
    if (now < wheelLock || Math.abs(ev.deltaY) < 4) return;
    wheelLock = now + 700;
    if (ev.deltaY > 0) return zoomOut();
    const g = ev.target.closest(".m-node");
    if (g) zoomIn(g.dataset.id);
  }, { passive: false });
  root.querySelector(".ak-crumbs").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-go]");
    if (b && !b.hasAttribute("aria-current")) go(b.dataset.go, "out");
  });
  $("#m-out").addEventListener("click", zoomOut);
  $("#m-in").addEventListener("click", () => zoomIn());
  $("#m-detail").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-zoom]");
    if (b) zoomIn(b.dataset.zoom);
    const j = ev.target.closest("[data-goto]");
    if (j) location.hash = `#/map/${encodeURIComponent(j.dataset.goto)}?sel=${encodeURIComponent(j.dataset.sel)}`;
  });
  const onKey = (ev) => {
    if (document.querySelector(".ak-palette") || /input|textarea/i.test(document.activeElement?.tagName)) return;
    if (ev.key === "Escape") selected ? select(null) : zoomOut();
    else if (ev.key === "-" || ev.key === "_") zoomOut();
    else if (ev.key === "+" || ev.key === "=") zoomIn();
  };
  addEventListener("keydown", onKey);
  select(q.get("sel"));
  return () => removeEventListener("keydown", onKey);
}

const drillable = (n) => n && (n.children.length || n.deep.length);

function legend(isAdrLevel) {
  if (isAdrLevel) {
    return `<div class="ak-legend m-legend">${["open", "proposed", "accepted", "rejected", "superseded"].filter((k) => S.site.statuses[k]).map((k) => `<span><i class="m-key m-key--adr ak-st-${k}"></i>${esc(statusLabel(k))}</span>`).join("")}<span><i class="m-key m-key--line"></i>depends on / supersedes</span><span><i class="m-key m-key--dash"></i>relates / mentions</span></div>`;
  }
  const techs = [...new Set(Object.values(S.site.architecture.nodes ?? {}).map((n) => n.tech).filter(Boolean))].sort();
  const tech = techs.map((t) => `<span><i class="m-key m-key--tech tech-${esc(t.replace(/[^a-z0-9-]/g, ""))}"></i>${esc(t)}</span>`).join("");
  return `<div class="ak-legend m-legend"><span><i class="m-key m-key--ctx"></i>Context (bounded context)</span><span><i class="m-key m-key--svc"></i>Service (deployable)</span><span><i class="m-key m-key--mod"></i>Module (code inside services)</span><span><i class="m-key m-key--ext"></i>External, store or topic</span><span><i class="m-key m-key--plan"></i>Planned</span>${tech}<span><b class="m-key m-key--cnt">3</b>Decisions inside</span></div>`;
}

// ── items ────────────────────────────────────────────────
function nodeItems(ids) {
  const arch = S.site.architecture;
  return ids.map((id) => arch.nodes[id]).filter(Boolean).map((n) => {
    const w = n.w ?? NW;
    const lines = n.sub ? wrapText(n.sub, Math.floor((w - 16) / CHAR_W)) : [];
    const labelLines = wrapText(n.label, Math.floor((w - 50) / 7.6)).slice(0, 2);
    const h = Math.max(n.h ?? NH, 34 + labelLines.length * 17 + lines.length * 14 + (drillable(n) || n.deep.length ? 20 : 4));
    return { id: n.id, node: n, w, h, lines, labelLines, fx: n.x, fy: n.y, at: n.at };
  });
}

function adrItems(ids) {
  return ids.map((id) => S.byId.get(id)).filter(Boolean).map((a) => {
    const labelLines = wrapText(a.title, 30).slice(0, 2);
    const g = gist(a).text ?? "";
    const lines = wrapText(g, 38).slice(0, 2);
    if (lines.length && g.length > lines.join(" ").length) lines[lines.length - 1] += "…";
    return { id: a.id, adr: a, w: AW, h: Math.max(AH, 34 + labelLines.length * 17 + lines.length * 14 + 6), labelLines, lines };
  });
}

function groupsFor(node) {
  return node ? node.groups ?? [] : S.site.architecture.groups ?? [];
}

// Edges that leave this node: the outside end becomes a ghost box (the real node, labelled with
// where it lives). The most connected ghosts win when there are many.
function ghostEdges(parent, items, max = 8) {
  const arch = S.site.architecture;
  const visible = new Set(items.map((n) => n.id));
  const inside = (id) => {
    for (let n = arch.nodes[id]; n; n = arch.nodes[n.parent]) if (n.id === parent.id) return true;
    return false;
  };
  const lift = (id) => {
    for (let n = arch.nodes[id]; n; n = arch.nodes[n.parent]) if (visible.has(n.id)) return n.id;
    return null;
  };
  const found = new Map();
  for (const e of arch.edges) {
    const fi = inside(e.from), ti = inside(e.to);
    if (fi === ti) continue;
    const local = lift(fi ? e.from : e.to);
    const ext = fi ? e.to : e.from;
    if (!local || !arch.nodes[ext]) continue;
    const gid = `ghost:${ext}`;
    if (!found.has(gid)) found.set(gid, { ext, edges: new Map() });
    const [from, to] = fi ? [local, gid] : [gid, local];
    const k = `${from}>${to}`, rk = `${to}>${from}`;
    const es = found.get(gid).edges;
    if (es.has(rk)) { es.get(rk).both = true; continue; }
    if (es.has(k)) { const x = es.get(k); if (e.label && !x.labels.includes(e.label)) x.labels.push(e.label); continue; }
    es.set(k, { from, to, labels: e.label ? [e.label] : [], dashed: e.dashed, both: e.both, ghost: true });
  }
  const picked = [...found.entries()].sort((a, b) => b[1].edges.size - a[1].edges.size).slice(0, max);
  const out = { items: [], edges: [] };
  for (const [gid, { ext, edges }] of picked) {
    const n = arch.nodes[ext];
    const where = [];
    for (let p = arch.nodes[n.parent]; p; p = arch.nodes[p.parent]) where.unshift(p.label);
    const w = NW - 30;
    const labelLines = wrapText(n.label, Math.floor((w - 16) / 7.6)).slice(0, 2);
    const lines = where.length ? wrapText(`in ${where.join(" / ")}`, Math.floor((w - 16) / CHAR_W)).slice(0, 2) : [];
    out.items.push({ id: gid, ghost: n, w, h: 30 + labelLines.length * 17 + lines.length * 14 + 6, labelLines, lines });
    for (const e of edges.values()) out.edges.push({ ...e, label: e.labels.join(", ") });
  }
  return out;
}

// Edges between any two nodes, lifted to the boxes visible at this level.
function liftedEdges(items) {
  const arch = S.site.architecture;
  const visible = new Set(items.map((n) => n.id));
  const lift = (id) => {
    for (let n = arch.nodes[id]; n; n = arch.nodes[n.parent]) if (visible.has(n.id)) return n.id;
    return null;
  };
  const out = new Map();
  for (const e of arch.edges) {
    const from = lift(e.from), to = lift(e.to);
    if (!from || !to || from === to) continue;
    const exact = from === e.from && to === e.to;
    const rev = out.get(`${to}>${from}`);
    if (rev) { rev.both = true; if (e.label && !rev.labels.includes(e.label)) rev.labels.push(e.label); continue; }
    const k = `${from}>${to}`;
    const prev = out.get(k);
    if (prev) {
      prev.both ||= e.both;
      prev.sel &&= !!e.sel;
      if (e.label && !prev.labels.includes(e.label)) prev.labels.push(e.label);
      continue;
    }
    // Layout hints (lp, lo) only make sense on the level the edge was written for.
    out.set(k, { from, to, labels: e.label ? [e.label] : [], dashed: e.dashed, both: e.both, sel: !!e.sel, lp: exact ? e.lp : null, lo: exact ? e.lo : null });
  }
  return [...out.values()].map((e) => ({ ...e, label: e.labels.length > 2 ? `${e.labels.slice(0, 2).join(", ")} +${e.labels.length - 2}` : e.labels.join(", ") }));
}

function adrEdges(items) {
  const ids = new Set(items.map((n) => n.id));
  return S.site.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, type: e.type, label: e.type === "mentions" ? "" : S.site.relations[e.type]?.label ?? e.type, dashed: e.type === "mentions" || e.type === "relates", plain: e.type === "relates" || e.type === "mentions" }));
}

// ── layout ───────────────────────────────────────────────
// Manual x/y wins (hand-drawn maps). Otherwise a layered layout: break cycles, rank boxes into
// columns along the arrows, order each column by its neighbours, then align every box with the
// boxes it connects to so most arrows run straight. Boxes without links go to a bottom row.
function layout(items, edges) {
  if (items.length && items.every((n) => n.fx != null && n.fy != null)) {
    for (const n of items) { n.x = n.fx; n.y = n.fy; }
    return;
  }
  const byId = new Map(items.map((n) => [n.id, n]));
  const links = edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to);
  const linked = new Set(links.flatMap((e) => [e.from, e.to]));
  const free = items.filter((n) => !linked.has(n.id));
  const placed = items.filter((n) => linked.has(n.id));
  if (!placed.length) return grid(items, 0);

  // Directed edges for ranking; two-way and plain links only pull ordering.
  const dir = links.filter((e) => !e.both && !e.plain);
  const out = new Map(placed.map((n) => [n.id, []]));
  for (const e of dir) out.get(e.from).push(e.to);
  // Cycle breaking: DFS from the most "source-like" boxes; edges back into the stack are reversed.
  const indeg = new Map(placed.map((n) => [n.id, 0]));
  for (const e of dir) indeg.set(e.to, indeg.get(e.to) + 1);
  const order0 = [...placed].sort((a, b) => indeg.get(a.id) - out.get(a.id).length - (indeg.get(b.id) - out.get(b.id).length));
  const state = new Map(), back = new Set();
  const dfs = (id) => {
    state.set(id, 1);
    for (const t of out.get(id)) {
      if (state.get(t) === 1) back.add(`${id}>${t}`);
      else if (!state.get(t)) dfs(t);
    }
    state.set(id, 2);
  };
  for (const n of order0) if (!state.get(n.id)) dfs(n.id);
  const dag = dir.map((e) => (back.has(`${e.from}>${e.to}`) ? { from: e.to, to: e.from } : e));

  // Longest-path ranks over this level's own boxes; ghosts (outside neighbours) do not stretch it.
  const isGhost = (id) => !!byId.get(id).ghost;
  const rank = new Map(placed.map((n) => [n.id, 0]));
  const core = dag.filter((e) => !isGhost(e.from) && !isGhost(e.to));
  for (let k = 0; k < placed.length; k++) {
    let changed = false;
    for (const e of core) if (rank.get(e.to) < rank.get(e.from) + 1) { rank.set(e.to, rank.get(e.from) + 1); changed = true; }
    if (!changed) break;
  }
  // A ghost sits one column before the boxes it feeds, or one after the boxes that feed it.
  for (const g of placed.filter((n) => n.ghost)) {
    const ins = links.filter((e) => e.to === g.id && !isGhost(e.from)).map((e) => rank.get(e.from));
    const outs = links.filter((e) => e.from === g.id && !isGhost(e.to)).map((e) => rank.get(e.to));
    rank.set(g.id, ins.length && !(outs.length && links.some((e) => e.both && (e.from === g.id || e.to === g.id))) ? Math.max(...ins) + 1 : outs.length ? Math.min(...outs) - 1 : 0);
  }
  // Two-way links with no direction keep the pair in neighbouring columns.
  for (const e of links.filter((e) => (e.both || e.plain) && !isGhost(e.from) && !isGhost(e.to))) {
    const a = rank.get(e.from), b = rank.get(e.to);
    if (a === b) {
      const lone = dag.some((d) => d.from === e.to || d.to === e.to) ? e.from : e.to;
      rank.set(lone, Math.max(0, rank.get(lone) - 1));
    }
  }
  for (const n of placed) if (n.at) rank.set(n.id, Number(n.at[0]));
  const min = Math.min(...rank.values());
  for (const [k, v] of rank) rank.set(k, v - min);

  // Columns and barycentric ordering (a few sweeps both ways).
  const keys = [...new Set(rank.values())].sort((a, b) => a - b);
  const cols = keys.map((k) => placed.filter((n) => rank.get(n.id) === k));
  const nb = new Map(placed.map((n) => [n.id, []]));
  for (const e of links) { nb.get(e.from).push(e.to); nb.get(e.to).push(e.from); }
  const pos = new Map();
  cols.forEach((c) => c.forEach((n, i) => pos.set(n.id, i)));
  const colOf = new Map(placed.map((n) => [n.id, keys.indexOf(rank.get(n.id))]));
  const crossings = () => {
    let x = 0;
    const segs = links.map((e) => [e.from, e.to]).filter(([u, v]) => colOf.get(u) !== colOf.get(v))
      .map(([u, v]) => (colOf.get(u) < colOf.get(v) ? [u, v] : [v, u]));
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = segs[i], [c, d] = segs[j];
      if (colOf.get(a) !== colOf.get(c) || colOf.get(b) !== colOf.get(d)) continue;
      if ((pos.get(a) - pos.get(c)) * (pos.get(b) - pos.get(d)) < 0) x++;
    }
    return x;
  };
  let best = { n: crossings(), order: cols.map((c) => [...c]) };
  for (let sweep = 0; sweep < 24; sweep++) {
    const seq = sweep % 2 ? [...cols].reverse() : cols;
    for (const c of seq) {
      for (const n of c) {
        const ps = nb.get(n.id).filter((m) => rank.get(m) !== rank.get(n.id)).map((m) => pos.get(m));
        n.bary = n.at ? Number(n.at[1]) : ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(n.id);
      }
      c.sort((a, b) => a.bary - b.bary);
      c.forEach((n, i) => pos.set(n.id, i));
    }
    const n = crossings();
    if (n < best.n) best = { n, order: cols.map((c) => [...c]) };
  }
  best.order.forEach((o, k) => { cols[k].splice(0, cols[k].length, ...o); o.forEach((n, i) => pos.set(n.id, i)); });

  // Clean grid: one box height per level, uniform gaps, every column centered on the same axis.
  // Real boxes share one height; outside (ghost) boxes share their own, smaller height and sit
  // centered in the same row slot, so rows stay aligned without empty dashed boxes.
  const H = Math.max(...placed.map((n) => n.h));
  const ghosts = placed.filter((n) => n.ghost);
  const Hg = ghosts.length ? Math.max(...ghosts.map((n) => n.h)) : H;
  for (const n of placed) n.h = n.ghost ? Hg : H;
  const colH = (c) => c.length * H + (c.length - 1) * GY;
  const tallest = Math.max(...cols.map(colH));
  // A gap grows with the number of edges crossing it, so their labels have room.
  const crossingGap = cols.map((_, k) => links.filter((e) => {
    const a = colOf.get(e.from), b = colOf.get(e.to);
    return Math.min(a, b) <= k && Math.max(a, b) > k;
  }).length);
  let x = 0;
  for (const [k, c] of cols.entries()) {
    const w = Math.max(...c.map((n) => n.w));
    let y = (tallest - colH(c)) / 2;
    for (const n of c) { n.x = x + (w - n.w) / 2; n.y = y + (H - n.h) / 2; y += H + GY; }
    x += w + Math.min(380, Math.max(GX, 110 + crossingGap[k] * 14));
  }
  const top = Math.min(...placed.map((n) => n.y));
  for (const n of placed) n.y -= top;
  if (free.length) grid(free, Math.max(...placed.map((n) => n.y + n.h)) + GY * 1.6);
}

function grid(items, y0, perRow) {
  const cols = perRow ?? Math.max(1, Math.min(4, Math.ceil(Math.sqrt(items.length * 1.4))));
  const colW = Math.max(...items.map((m) => m.w));
  const rowH = [];
  items.forEach((n, i) => (rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)] ?? 0, n.h)));
  items.forEach((n, i) => {
    const r = Math.floor(i / cols);
    n.x = (i % cols) * (colW + AGX);
    n.y = y0 + rowH.slice(0, r).reduce((a, b) => a + b + GY, 0);
  });
}

// ── drawing ──────────────────────────────────────────────
const center = (n) => [n.x + n.w / 2, n.y + n.h / 2];

// Each edge leaves and enters through a box side that faces the other box. Ends on one side are
// spread evenly along it (sorted by where the other box is).
function assignPorts(edges, byId, boxes) {
  const sides = new Map();
  const ends = [];
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const [ax, ay] = center(a), [bx, by] = center(b);
    let sa, sb;
    if (Math.abs(bx - ax) > (a.w + b.w) / 4) {
      sa = bx > ax ? "R" : "L";
      sb = sa === "R" ? "L" : "R";
    } else {
      // Same column: straight down/up, unless a box sits between them; then go around on the right.
      const lo = Math.min(a.y + a.h, b.y + b.h), hi = Math.max(a.y, b.y);
      const blocked = boxes.some((o) => o !== a && o !== b && o.x < Math.max(a.x + a.w, b.x + b.w) && o.x + o.w > Math.min(a.x, b.x) && o.y < hi && o.y + o.h > lo);
      if (blocked) sa = sb = "R";
      else { sa = by > ay ? "B" : "T"; sb = sa === "B" ? "T" : "B"; }
    }
    const end = { e, a, b, sa, sb };
    ends.push(end);
    for (const [n, side, other, key] of [[a, sa, b, "pa"], [b, sb, a, "pb"]]) {
      const k = `${n.id}:${side}`;
      if (!sides.has(k)) sides.set(k, { n, side, list: [] });
      sides.get(k).list.push({ end, other, key });
    }
  }
  for (const { n, side, list } of sides.values()) {
    const vert = side === "L" || side === "R";
    list.sort((u, v) => (vert ? center(u.other)[1] - center(v.other)[1] : center(u.other)[0] - center(v.other)[0]));
    list.forEach(({ end, key }, i) => {
      const f = (i + 1) / (list.length + 1);
      end[key] = vert ? [side === "R" ? n.x + n.w + 3 : n.x - 3, n.y + n.h * f] : [n.x + n.w * f, side === "B" ? n.y + n.h + 3 : n.y - 3];
    });
  }
  return ends;
}

// Elbow routing. Vertical runs live in the gaps between columns, each on its own track; an edge
// that spans several columns crosses them on a free horizontal corridor, never through a box.
function routeEdges(ends, boxes, straight) {
  if (straight) {
    for (const end of ends) end.pts = [end.pa, end.pb];
    return;
  }
  const tracks = new Map(); // gap key → requests
  const want = (key, lo, hi, y1, y2) => {
    if (!tracks.has(key)) tracks.set(key, { lo, hi, reqs: [] });
    const r = { y1, y2, v: null };
    tracks.get(key).reqs.push(r);
    return r;
  };
  // Free x-gap to the right (dir 1) or left (dir -1) of a box edge at x.
  const gapFrom = (x, dir) => {
    if (dir > 0) {
      const next = boxes.filter((o) => o.x > x + 1).map((o) => o.x);
      return [x, next.length ? Math.min(...next) : x + 60];
    }
    const prev = boxes.filter((o) => o.x + o.w < x - 1).map((o) => o.x + o.w);
    return [prev.length ? Math.max(...prev) : x - 60, x];
  };
  const hits = (y, x1, x2) => boxes.some((o) => y > o.y - 8 && y < o.y + o.h + 8 && o.x < Math.max(x1, x2) && o.x + o.w > Math.min(x1, x2));
  const plans = [];
  for (const end of ends) {
    const { pa, pb, sa, sb, a, b } = end;
    if (sa === "B" || sa === "T") {
      // Same column, nothing between: one horizontal jog in the row gap.
      if (Math.abs(pa[0] - pb[0]) < 1) { plans.push(() => [pa, pb]); continue; }
      const lo = sa === "B" ? a.y + a.h : b.y + b.h, hi = sa === "B" ? b.y : a.y;
      const r = want(`h:${Math.round(lo)}:${Math.round(hi)}:${Math.round(Math.min(pa[0], pb[0]))}`, lo, hi, pa[0], pb[0]);
      plans.push(() => [pa, [pa[0], r.v], [pb[0], r.v], pb]);
      continue;
    }
    const d1 = sa === "R" ? 1 : -1;
    const g1 = gapFrom(sa === "R" ? a.x + a.w : a.x, d1);
    if (sa === sb) {
      // Both ends on the right side (same column, blocked): out, along the gap, back in.
      const r = want(`v:${Math.round(g1[0])}:${Math.round(g1[1])}`, g1[0], g1[1], pa[1], pb[1]);
      plans.push(() => [pa, [r.v, pa[1]], [r.v, pb[1]], pb]);
      continue;
    }
    const g2 = gapFrom(sb === "L" ? b.x : b.x + b.w, sb === "L" ? -1 : 1);
    if (Math.round(g1[0]) === Math.round(g2[0]) && Math.round(g1[1]) === Math.round(g2[1])) {
      // Neighbouring columns: one vertical run in the shared gap.
      if (Math.abs(pa[1] - pb[1]) < 1) { plans.push(() => [pa, pb]); continue; }
      const r = want(`v:${Math.round(g1[0])}:${Math.round(g1[1])}`, g1[0], g1[1], pa[1], pb[1]);
      plans.push(() => [pa, [r.v, pa[1]], [r.v, pb[1]], pb]);
      continue;
    }
    // Several columns apart: pick a free corridor across the columns between them.
    const xa = d1 > 0 ? g1[1] : g1[0], xb = d1 > 0 ? g2[0] : g2[1];
    const span = boxes.filter((o) => o.x < Math.max(xa, xb) && o.x + o.w > Math.min(xa, xb));
    const cands = [pa[1], pb[1]];
    const ys = span.flatMap((o) => [o.y, o.y + o.h]).sort((u, v) => u - v);
    if (ys.length) cands.push(ys[0] - 22, ys.at(-1) + 22);
    const sorted = [...span].sort((u, v) => u.y - v.y);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].y - (sorted[i - 1].y + sorted[i - 1].h) > 16) cands.push((sorted[i - 1].y + sorted[i - 1].h + sorted[i].y) / 2);
    const free = cands.filter((y) => !hits(y, xa, xb));
    const cy = (free.length ? free : cands).sort((u, v) => Math.abs(u - pa[1]) + Math.abs(u - pb[1]) - (Math.abs(v - pa[1]) + Math.abs(v - pb[1])))[0];
    const r1 = Math.abs(cy - pa[1]) < 1 ? null : want(`v:${Math.round(g1[0])}:${Math.round(g1[1])}`, g1[0], g1[1], pa[1], cy);
    const r2 = Math.abs(cy - pb[1]) < 1 ? null : want(`v:${Math.round(g2[0])}:${Math.round(g2[1])}`, g2[0], g2[1], cy, pb[1]);
    plans.push(() => {
      const pts = [pa];
      if (r1) pts.push([r1.v, pa[1]], [r1.v, cy]);
      if (r2) pts.push([r2.v, cy], [r2.v, pb[1]]);
      pts.push(pb);
      return pts;
    });
  }
  // Tracks: spread the runs of one gap evenly across it, ordered to cross as little as possible.
  for (const { lo, hi, reqs } of tracks.values()) {
    reqs.sort((u, v) => Math.min(u.y1, u.y2) - Math.min(v.y1, v.y2) || Math.max(u.y1, u.y2) - Math.max(v.y1, v.y2));
    const pad = Math.min(18, (hi - lo) / 4);
    reqs.forEach((r, i) => (r.v = lo + pad + ((hi - lo - 2 * pad) * (i + 1)) / (reqs.length + 1)));
  }
  ends.forEach((end, i) => (end.pts = dedupe(plans[i]())));
}

const dedupe = (pts) => pts.filter((p, i) => !i || Math.abs(p[0] - pts[i - 1][0]) > 0.5 || Math.abs(p[1] - pts[i - 1][1]) > 0.5);

function drawEdge(layer, end) {
  const { e, pts } = end;
  const attrs = { class: `m-edge${e.dashed ? " dashed" : ""}${e.sel ? " onsel" : ""}${e.type ? ` t-${e.type}` : ""}`, "data-from": e.from, "data-to": e.to };
  const g = svgEl("g", attrs, layer);
  const path = svgEl("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") }, g);
  if (!e.plain) path.setAttribute("marker-end", "url(#m-arr)");
  if (e.both) path.setAttribute("marker-start", "url(#m-arr)");
  return e.label ? { e, pts, attrs } : null;
}

// Labels sit on a segment of their line: long horizontal runs first, then the rest. The first spot
// that overlaps no box and no placed label wins; otherwise the spot with the least overlap.
function placeLabels(layer, pending, items) {
  const boxes = items.map((n) => ({ x1: n.x - 3, y1: n.y - 3, x2: n.x + n.w + 3, y2: n.y + n.h + 3 }));
  const placed = [];
  const overlap = (r, o) => Math.max(0, Math.min(r.x2, o.x2) - Math.max(r.x1, o.x1)) * Math.max(0, Math.min(r.y2, o.y2) - Math.max(r.y1, o.y1));
  const length = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  pending.sort((u, v) => length(u.pts) - length(v.pts));
  for (const { e, pts, attrs } of pending) {
    const text = e.label.length > 34 ? e.label.slice(0, 33) + "…" : e.label;
    const w = text.length * 5.9 + 10, h = 17;
    const [ox, oy] = e.lo ?? [0, 0];
    const segs = pts.slice(1).map((p, i) => ({ p1: pts[i], p2: p, len: Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), flat: Math.abs(p[1] - pts[i][1]) < 0.5 }));
    const order = [...segs].sort((u, v) => (v.flat && v.len > w + 8) - (u.flat && u.len > w + 8) || v.len - u.len);
    const rect = (x, y) => ({ x, y, x1: x - w / 2, y1: y - h / 2 - 1, x2: x + w / 2, y2: y + h / 2 + 1 });
    const tries = [];
    if (e.lp != null) {
      const s0 = order[0];
      tries.push(rect(s0.p1[0] + (s0.p2[0] - s0.p1[0]) * e.lp + ox, s0.p1[1] + (s0.p2[1] - s0.p1[1]) * e.lp + oy));
    } else {
      for (const sg of order) for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) for (const off of sg.flat ? [0, -13, 13] : [0]) {
        tries.push({ ...rect(sg.p1[0] + (sg.p2[0] - sg.p1[0]) * t + ox, sg.p1[1] + (sg.p2[1] - sg.p1[1]) * t + off + oy), off });
      }
    }
    let best = null;
    for (const r of tries) {
      const cost = boxes.reduce((c, o) => c + overlap(r, o), 0) * 2 + placed.reduce((c, o) => c + overlap(r, o), 0) * 3 + Math.abs(r.off ?? 0) * 0.5;
      if (!best || cost < best.cost) best = { r, cost };
      if (cost === 0) break;
    }
    const { r } = best;
    placed.push(r);
    const g = svgEl("g", attrs, layer);
    const lb = svgEl("g", { class: "lbl" }, g);
    svgEl("rect", { x: r.x - w / 2, y: r.y - 9, width: w, height: h }, lb);
    svgEl("text", { x: r.x, y: r.y + 4, "text-anchor": "middle" }, lb).textContent = text;
  }
}

function drawGroup(stage, grp, byId) {
  const ns = grp.nodes.map((id) => byId.get(id)).filter(Boolean);
  if (!ns.length) return;
  const p = 14;
  const x = Math.min(...ns.map((n) => n.x)) - p, y = Math.min(...ns.map((n) => n.y)) - p;
  const w = Math.max(...ns.map((n) => n.x + n.w)) + p - x, h = Math.max(...ns.map((n) => n.y + n.h)) + p - y;
  const g = svgEl("g", { class: "m-group" }, stage);
  svgEl("rect", { x, y, width: w, height: h }, g);
  svgEl("text", { x: x + 8, y: y - 6 }, g).textContent = grp.label;
}

// Infra boxes carry their technology: a color (by tech, then by kind) and the name in the tag line.
const techCls = (n) => (n.tech ? ` tech tech-${n.tech.replace(/[^a-z0-9-]/g, "")}` : "");
const tagText = (n) => (n.tag ?? (n.tech ? `${n.kind} · ${n.tech}` : String(n.kind))).toUpperCase();

function drawNode(stage, it) {
  const n = it.node;
  const drill = drillable(n);
  const g = svgEl("g", { class: `m-node k-${n.kind}${techCls(n)}${drill ? " drill" : ""}`, tabindex: 0, role: "button", "data-id": n.id, "aria-label": `${n.label}${drill ? ", zoomable" : ""}` }, stage);
  svgEl("rect", { class: "box", x: it.x, y: it.y, width: it.w, height: it.h }, g);
  if (/^(module|package|component)$/.test(n.kind)) svgEl("rect", { class: "modbar", x: it.x, y: it.y, width: 4, height: it.h }, g);
  svgEl("text", { class: "tag", x: it.x + 8, y: it.y + 14 }, g).textContent = tagText(n);
  it.labelLines.forEach((l, i) => (svgEl("text", { class: "label", x: it.x + 8, y: it.y + 32 + i * 17 }, g).textContent = l));
  const top = it.y + 32 + it.labelLines.length * 17 - 1;
  it.lines.forEach((l, i) => (svgEl("text", { class: "sub", x: it.x + 8, y: top + i * 14 }, g).textContent = l));
  if (n.deep.length) {
    const s = String(n.deep.length);
    const cw = 12 + s.length * 7;
    svgEl("rect", { class: "cntbg", x: it.x + it.w - cw, y: it.y, width: cw, height: 18 }, g);
    svgEl("text", { class: "cnt", x: it.x + it.w - cw / 2, y: it.y + 13, "text-anchor": "middle" }, g).textContent = s;
    n.deep.slice(0, Math.floor((it.w - 90) / 10)).forEach((id, i) => {
      const a = S.byId.get(id);
      if (a) svgEl("rect", { class: `adot ak-st-${a.statusKey}`, x: it.x + 8 + i * 10, y: it.y + it.h - 13, width: 7, height: 7 }, g);
    });
  }
  if (drill) svgEl("text", { class: "zoom", x: it.x + it.w - 8, y: it.y + it.h - 7, "text-anchor": "end" }, g).textContent = n.children.length ? "zoom in ›" : "decisions ›";
}

function drawGhost(stage, it) {
  const n = it.ghost;
  const g = svgEl("g", { class: `m-node m-ghost k-${n.kind}${techCls(n)}`, tabindex: 0, role: "button", "data-id": it.id, "aria-label": `${n.label}, outside this level` }, stage);
  svgEl("rect", { class: "box", x: it.x, y: it.y, width: it.w, height: it.h }, g);
  // Fit the tag line: drop "OUTSIDE" first (the dashed border already says it), then cut.
  const max = Math.floor((it.w - 16) / 6.4);
  let tag = `${tagText(n)} · OUTSIDE`;
  if (tag.length > max) tag = tagText(n);
  if (tag.length > max) tag = tag.slice(0, max - 1) + "…";
  svgEl("text", { class: "tag", x: it.x + 8, y: it.y + 14 }, g).textContent = tag;
  it.labelLines.forEach((l, i) => (svgEl("text", { class: "label", x: it.x + 8, y: it.y + 31 + i * 17 }, g).textContent = l));
  const top = it.y + 31 + it.labelLines.length * 17 - 1;
  it.lines.forEach((l, i) => (svgEl("text", { class: "sub", x: it.x + 8, y: top + i * 14 }, g).textContent = l));
}

function drawAdr(stage, it) {
  const a = it.adr;
  const g = svgEl("g", { class: `m-node k-adr ak-st-${a.statusKey}`, tabindex: 0, role: "button", "data-id": a.id, "aria-label": `${label(a)} ${a.title}` }, stage);
  svgEl("rect", { class: "box", x: it.x, y: it.y, width: it.w, height: it.h }, g);
  svgEl("rect", { class: "bar", x: it.x, y: it.y, width: 5, height: it.h }, g);
  svgEl("text", { class: "tag", x: it.x + 13, y: it.y + 14 }, g).textContent = label(a);
  svgEl("text", { class: "st", x: it.x + it.w - 8, y: it.y + 14, "text-anchor": "end" }, g).textContent = String(statusLabel(a.statusKey)).toUpperCase();
  it.labelLines.forEach((l, i) => (svgEl("text", { class: "label", x: it.x + 13, y: it.y + 32 + i * 17 }, g).textContent = l));
  const top = it.y + 32 + it.labelLines.length * 17 - 1;
  it.lines.forEach((l, i) => (svgEl("text", { class: "sub", x: it.x + 13, y: top + i * 14 }, g).textContent = l));
}

// ── detail panel ─────────────────────────────────────────
// One line per decision: id, status dot, title. Long lists show the first few and a count.
function cardsFor(ids, max = 6) {
  const list = ids.map((id) => S.byId.get(id)).filter(Boolean);
  const row = (a) => `<a class="m-row ak-st-${a.statusKey}" href="${href(a)}" data-ref="${a.id}"><i class="ak-dot"></i><span class="mono">${esc(a.id)}</span><span class="m-row-t">${esc(a.title)}</span><span class="m-row-s">${esc(statusLabel(a.statusKey))}</span></a>`;
  const head = list.slice(0, max).map(row).join("");
  const rest = list.slice(max);
  return `<div class="m-rows">${head}${rest.length ? `<details class="m-more"><summary>+${rest.length} more</summary>${rest.map(row).join("")}</details>` : ""}</div>`;
}

function nodeDetail(n, isSelection) {
  const arch = S.site.architecture;
  if (!n) {
    const total = new Set(Object.values(arch.nodes).flatMap((x) => x.adrs)).size;
    return `<div class="kind">Top level</div><h3>${esc(arch.title)}</h3><p class="muted">${Object.keys(arch.nodes).length} components · ${total} linked decisions.</p><p class="muted" style="font-size:13px">Select a box to see its decisions here.</p>`;
  }
  const direct = n.adrs;
  const inside = n.deep.filter((id) => !direct.includes(id));
  const kids = n.children.map((c) => arch.nodes[c]).filter(Boolean);
  return `<div class="kind">${esc(n.tag ?? n.kind)}${n.parent ? ` · in ${esc(arch.nodes[n.parent]?.label ?? n.parent)}` : ""}</div><h3>${esc(n.label)}</h3>
${n.sub ? `<p class="muted" style="margin:0 0 8px">${esc(n.sub)}</p>` : ""}
${n.desc ? `<div class="am-md">${md(n.desc)}</div>` : ""}
${n.tags.length ? `<div class="ak-chips" style="margin-top:10px">${n.tags.map((t) => tagChip(t)).join("")}</div>` : ""}
${kids.length ? `<p class="m-contains"><b>Contains</b> ${kids.length}: ${kids.slice(0, 5).map((k) => esc(k.label)).join(", ")}${kids.length > 5 ? ` +${kids.length - 5}` : ""}</p>` : ""}
${isSelection && drillable(n) ? `<p style="margin:12px 0 0"><button class="ak-btn" type="button" data-zoom="${esc(n.id)}">${n.children.length ? "Zoom in ›" : "Show decisions ›"}</button> <span class="muted" style="font-size:12px">or click the box again</span></p>` : ""}
${direct.length ? `<div class="ak-mini-label" style="margin-top:16px">Decisions about ${esc(n.label)} · ${direct.length}</div>${cardsFor(direct)}` : ""}
${inside.length ? `<div class="ak-mini-label" style="margin-top:16px">Inside · ${inside.length}</div>${cardsFor(inside, 4)}` : ""}
${!n.deep.length ? `<p class="muted" style="font-size:13px;margin-top:14px">No decisions linked. Add <code>components: [${esc(n.id)}]</code> to an ADR.</p>` : ""}`;
}

function ghostDetail(n) {
  const arch = S.site.architecture;
  const where = [];
  for (let p = arch.nodes[n.parent]; p; p = arch.nodes[p.parent]) where.unshift(p.label);
  return `<div class="kind">${esc(n.tag ?? n.kind)} · outside this level</div><h3>${esc(n.label)}</h3>
<p class="muted" style="margin:0 0 8px">${where.length ? `In ${esc(where.join(" / "))}` : "Top level"}${n.sub ? ` · ${esc(n.sub)}` : ""}</p>
${n.desc ? `<div class="am-md">${md(n.desc)}</div>` : ""}
<p style="margin:12px 0 0"><button class="ak-btn" type="button" data-goto="${esc(n.parent ?? "")}" data-sel="${esc(n.id)}">Go to ${esc(n.label)} ›</button></p>
${n.deep.length ? `<div class="ak-mini-label" style="margin-top:16px">Decisions · ${n.deep.length}</div>${cardsFor(n.deep)}` : ""}`;
}

function adrDetail(a) {
  const g = gist(a);
  return `<div class="kind">${esc(label(a))}</div><h3>${esc(a.title)}</h3><div style="margin-bottom:10px">${pill(a)}</div>
${g.text ? `<div class="ak-hero ak-hero--${g.kind === "decision" ? "decision" : g.kind === "question" ? "question" : "rec"} ak-st-${a.statusKey}" style="padding:10px 12px"><div class="ak-hero-label">${esc(g.kind)}</div><div class="ak-hero-text" style="font-size:14px">${esc(g.text)}</div></div>` : ""}
${a.tags.length ? `<div class="ak-chips" style="margin-top:10px">${a.tags.map((t) => tagChip(t)).join("")}</div>` : ""}
<p style="margin:14px 0 0"><a class="ak-btn" href="${href(a)}">Open ${esc(label(a))} →</a></p>`;
}
