// Zoomable architecture map from architecture.yaml, drawn like a hand-made blueprint:
// boxes with a mono tag line, straight arrows clipped at the box border, labels on the line,
// dashed group frames, and a zoom that grows out of the box you open.
// Each level shows the children of one node; a leaf (or a node's own band) shows its ADRs.
import { $, S, esc, gist, href, label, pill, statusLabel, svgEl, tagChip, wrapText } from "./util.js";
import { md } from "./vendor/crux-render.js";

const NW = 200, NH = 70, GX = 120, GY = 46;
const AW = 250, AH = 92;
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
    <div class="ak-maphint">${esc(hint)}</div>
  </section>
  <aside class="am-panel m-detail" aria-live="polite"><header class="am-panel-head"><span class="am-panel-id">i</span><h2>Details</h2></header><div class="am-panel-body" id="m-detail"></div></aside>
</div>
${legend(isAdrLevel)}`;

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
  svg.style.minWidth = `${Math.min(vw, 760)}px`;
  const cx = minX + vw / 2, cy = minY + vh / 2;

  const byId = new Map(items.map((n) => [n.id, n]));
  for (const g of groupsFor(node)) drawGroup(stage, g, byId);
  if (band) {
    svgEl("line", { class: "m-band-line", x1: minX + 8, x2: minX + vw - 8, y1: band.y, y2: band.y }, stage);
    svgEl("text", { class: "m-band", x: minX + pad, y: band.y + 20 }, stage).textContent = band.label.toUpperCase();
  }
  const edgeLayer = svgEl("g", {}, stage);
  labelBoxes = [];
  for (const e of edges) drawEdge(edgeLayer, e, byId.get(e.from), byId.get(e.to));
  for (const n of items) (n.adr ? drawAdr : n.ghost ? drawGhost : drawNode)(stage, n);
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
  return `<div class="ak-legend m-legend"><span><i class="m-key m-key--ctx"></i>Context / domain</span><span><i class="m-key m-key--plan"></i>Planned, not designed yet</span><span><i class="m-key m-key--ext"></i>External, infra, store or topic</span><span><i class="m-key"></i>Component, binary or package</span><span><b class="m-key m-key--cnt">3</b>Decisions inside</span></div>`;
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
  for (let sweep = 0; sweep < 6; sweep++) {
    const seq = sweep % 2 ? [...cols].reverse() : cols;
    for (const c of seq) {
      for (const n of c) {
        const ps = nb.get(n.id).filter((m) => rank.get(m) !== rank.get(n.id)).map((m) => pos.get(m));
        n.bary = n.at ? Number(n.at[1]) : ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(n.id);
      }
      c.sort((a, b) => a.bary - b.bary);
      c.forEach((n, i) => pos.set(n.id, i));
    }
  }

  // x by column; y: stack, then pull each box toward its neighbours' centers and resolve overlaps.
  let x = 0;
  for (const c of cols) {
    const w = Math.max(...c.map((n) => n.w));
    let y = 0;
    for (const n of c) { n.x = x + (w - n.w) / 2; n.y = y; y += n.h + GY; }
    x += w + GX;
  }
  const settle = (c) => {
    let floor = -Infinity;
    for (const n of c) { n.y = Math.max(n.y, floor); floor = n.y + n.h + GY; }
    // push back up if the column drifted below its wanted position
    let ceil = Infinity;
    for (let i = c.length - 1; i >= 0; i--) {
      const n = c[i];
      if (n.want != null && n.y > n.want && n.y + n.h + GY <= ceil) n.y = Math.max(n.want, i ? c[i - 1].y + c[i - 1].h + GY : -Infinity);
      ceil = n.y;
    }
  };
  for (let pass = 0; pass < 4; pass++) {
    const seq = pass % 2 ? [...cols].reverse() : cols;
    for (const c of seq) {
      for (const n of c) {
        const ms = nb.get(n.id).map((m) => byId.get(m)).filter((m) => m && rank.get(m.id) !== rank.get(n.id));
        n.want = ms.length ? ms.reduce((a, m) => a + m.y + m.h / 2, 0) / ms.length - n.h / 2 : null;
        if (n.want != null) n.y = n.want;
      }
      settle(c);
    }
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
    n.x = (i % cols) * (colW + GX * 0.45);
    n.y = y0 + rowH.slice(0, r).reduce((a, b) => a + b + GY, 0);
  });
}

// ── drawing ──────────────────────────────────────────────
const center = (n) => [n.x + n.w / 2, n.y + n.h / 2];

// Point where the segment from the box center towards (tx, ty) leaves the box.
function clip(n, tx, ty) {
  const [cx, cy] = center(n);
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const sx = dx ? (n.w / 2 + 4) / Math.abs(dx) : Infinity;
  const sy = dy ? (n.h / 2 + 4) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

let labelBoxes = [];
function drawEdge(layer, e, a, b) {
  if (!a || !b) return;
  const [bx, by] = center(b), [ax, ay] = center(a);
  const p1 = clip(a, bx, by), p2 = clip(b, ax, ay);
  const g = svgEl("g", { class: `m-edge${e.dashed ? " dashed" : ""}${e.sel ? " onsel" : ""}${e.type ? ` t-${e.type}` : ""}`, "data-from": e.from, "data-to": e.to }, layer);
  const path = svgEl("path", { d: `M${p1[0].toFixed(1)},${p1[1].toFixed(1)} L${p2[0].toFixed(1)},${p2[1].toFixed(1)}` }, g);
  if (!e.plain) path.setAttribute("marker-end", "url(#m-arr)");
  if (e.both) path.setAttribute("marker-start", "url(#m-arr)");
  if (e.label) {
    const [ox, oy] = e.lo ?? [0, 0];
    const text = e.label.length > 34 ? e.label.slice(0, 33) + "…" : e.label;
    const w = text.length * 5.9 + 10;
    // Slide along the line until the label clears earlier labels (unless the author placed it).
    const at = (f) => [p1[0] + (p2[0] - p1[0]) * f + ox, p1[1] + (p2[1] - p1[1]) * f + oy];
    const hits = ([x, y]) => labelBoxes.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 2 && Math.abs(b.y - y) < 19);
    let f = e.lp ?? 0.5;
    if (e.lp == null) for (const t of [0.5, 0.35, 0.65, 0.25, 0.75, 0.2, 0.8]) if (!hits(at(t))) { f = t; break; }
    const [mx, my] = at(f);
    labelBoxes.push({ x: mx, y: my, w });
    const lb = svgEl("g", { class: "lbl" }, g);
    svgEl("rect", { x: mx - w / 2, y: my - 9, width: w, height: 17 }, lb);
    svgEl("text", { x: mx, y: my + 4, "text-anchor": "middle" }, lb).textContent = text;
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

function drawNode(stage, it) {
  const n = it.node;
  const drill = drillable(n);
  const g = svgEl("g", { class: `m-node k-${n.kind}${drill ? " drill" : ""}`, tabindex: 0, role: "button", "data-id": n.id, "aria-label": `${n.label}${drill ? ", zoomable" : ""}` }, stage);
  svgEl("rect", { class: "box", x: it.x, y: it.y, width: it.w, height: it.h }, g);
  svgEl("text", { class: "tag", x: it.x + 8, y: it.y + 14 }, g).textContent = (n.tag ?? String(n.kind)).toUpperCase();
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
  const g = svgEl("g", { class: `m-node m-ghost k-${n.kind}`, tabindex: 0, role: "button", "data-id": it.id, "aria-label": `${n.label}, outside this level` }, stage);
  svgEl("rect", { class: "box", x: it.x, y: it.y, width: it.w, height: it.h }, g);
  svgEl("text", { class: "tag", x: it.x + 8, y: it.y + 14 }, g).textContent = `${(n.tag ?? n.kind).toUpperCase()} · OUTSIDE`;
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
