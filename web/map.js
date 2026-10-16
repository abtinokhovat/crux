// Zoomable architecture map from architecture.yaml, drawn like a hand-made blueprint:
// boxes with a mono tag line, straight arrows clipped at the box border, labels on the line,
// dashed group frames, and a zoom that grows out of the box you open.
// Each level shows the children of one node; a leaf (or a node's own band) shows its ADRs.
// The level is a canvas: pan by dragging the background or scrolling, zoom with a pinch,
// ctrl/⌘ + wheel, the buttons or + and −. Boxes are sticky: drag one and the level keeps the
// layout you see (in .crux/layout.json when served, in this browser for a static site).
import { $, S, esc, gist, href, label, pill, statusLabel, svgEl, tagChip, toast, wrapText } from "./util.js";
import { md } from "./vendor/crux-render.js";
import { bindIde } from "./ide.js";
import { decisionsFor, elChip, flowsThrough, kindGlyph, kindName, openQuestionsFor, techChip, techOf, techPath } from "./system.js";

const NW = 200, NH = 70, GX = 170, GY = 56;
const AW = 250, AH = 92, AGX = 120;
const CHAR_W = 6.7;

// Set by a zoom click so the next level can finish the animation.
let entering = null;
// The pan and zoom of each level, so a live reload (or coming back) keeps where you were.
const viewports = new Map();
const KMIN = 0.15, KMAX = 3;
const clampK = (k) => Math.min(KMAX, Math.max(KMIN, k));

// Saved positions of a level: from the repo, with this browser's moves on top for a static site.
function savedLayout(level) {
  const repo = S.site.layout?.[level] ?? null;
  if (S.site.local) return repo;
  try {
    const mine = JSON.parse(localStorage.getItem(`crux-layout:${S.site.title}`) ?? "{}")[level];
    return mine ?? repo;
  } catch { return repo; }
}

async function storeLayout(level, positions) {
  S.site.layout ??= {};
  if (positions) S.site.layout[level] = positions;
  else delete S.site.layout[level];
  if (!S.site.local) {
    try {
      const key = `crux-layout:${S.site.title}`;
      const all = JSON.parse(localStorage.getItem(key) ?? "{}");
      if (positions) all[level] = positions;
      else delete all[level];
      localStorage.setItem(key, JSON.stringify(all));
    } catch { /* storage off: the layout lasts until the page reloads */ }
    return;
  }
  try {
    const r = await fetch("api/layout", { method: "POST", headers: { "content-type": "application/json", "x-crux": "1" }, body: JSON.stringify({ level, positions }) });
    if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
  } catch (err) {
    toast(`Layout not saved: ${err.message}`);
  }
}

const bounds = (items, pad = 0) => {
  const x1 = Math.min(...items.map((n) => n.x)) - pad, y1 = Math.min(...items.map((n) => n.y)) - pad;
  const x2 = Math.max(...items.map((n) => n.x + n.w)) + pad, y2 = Math.max(...items.map((n) => n.y + n.h)) + pad;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, x2, y2 };
};

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
    ? "Each box is a decision. Select it to preview; double-click or Enter opens it. Drag boxes to arrange them; drag the background to pan; pinch or ctrl + wheel to zoom."
    : "Select a box to see its decisions; double-click opens the next level. Drag boxes to arrange them — they stay. Drag the background or scroll to pan; pinch, ctrl + wheel or + / − to zoom; 0 fits.";

  // IDE layout under the app header: explorer on the left, the canvas in the middle, details on the right.
  const chosen = mapUI(); // only what the user toggled is remembered
  const ui = { legendClosed: innerWidth < 900, ...chosen };
  const sub = node ? node.sub || node.desc?.split("\n")[0] || "" : arch.desc || "";
  const flat = !node && !isAdrLevel && canFlatten(arch) && flatPref(q);
  root.innerHTML = `<div class="ide" data-ide="map">
<aside class="ide-pane ide-left" aria-label="Explorer"><header class="ide-head"><h2>Explorer</h2><button type="button" class="m-ov-x" data-ide-toggle="l" aria-label="Hide explorer">×</button></header>
  <input class="ide-search" id="m-find" type="search" placeholder="Find a component…" aria-label="Find a component"><div class="ide-body" id="m-tree"></div></aside>
<div class="ide-split" data-side="l" role="separator" aria-orientation="vertical"></div>
<section class="ide-center">
  <header class="ide-bar">
    <div class="ide-title">
      <nav class="ak-crumbs" aria-label="Level"${node ? "" : " hidden"}><button type="button" data-go=""${!node ? " aria-current" : ""}>${esc(arch.title)}</button>${path.map((n, i) => `<i>/</i><button type="button" data-go="${esc(n.id)}"${i === path.length - 1 ? " aria-current" : ""}>${esc(n.label)}</button>`).join("")}</nav>
      <h1><span class="m-lvl">L${path.length}</span>${isAdrLevel ? `${esc(node.label)} — decisions` : esc(title)}</h1>
      ${sub ? `<p title="${esc(sub)}">${esc(sub)}</p>` : ""}<div class="m-meta" id="m-meta"></div>
    </div>
    <div class="ide-tools" role="toolbar" aria-label="Map">
      <button class="ak-btn" id="m-flat" type="button"${!node && !isAdrLevel && canFlatten(arch) ? "" : " hidden"} aria-pressed="${flat}" title="Show the services inside every context, or the contexts as boxes">Expand contexts</button>
      <button class="ak-btn" id="m-out" type="button"${node ? "" : " disabled"} title="Up a level (Esc)">↑ Up</button><button class="ak-btn" id="m-in" type="button" disabled title="Open the selected box (Enter)">Open ›</button>
      <span class="m-zoom" role="group" aria-label="Canvas zoom"><button class="ak-btn" id="m-zout" type="button" title="Zoom out (−)" aria-label="Zoom out">−</button><button class="ak-btn m-zlvl" id="m-zlvl" type="button" title="Fit (0)">100%</button><button class="ak-btn" id="m-zin" type="button" title="Zoom in (+)" aria-label="Zoom in">+</button></span>
      <button class="ak-btn" id="m-reset" type="button" title="Forget the arranged layout of this level"${savedLayout(levelKey(node, isAdrLevel, flat)) ? "" : " hidden"}>Reset layout</button>
      <button class="ak-btn" type="button" data-ide-toggle="l" aria-pressed="true" title="Show or hide the explorer">Explorer</button>
      <button class="ak-btn" type="button" data-ide-toggle="r" aria-pressed="true" title="Show or hide the details">Details</button>
    </div>
  </header>
  <div class="ide-stage"><div class="m-canvas"><svg class="ak-canvas" id="m-svg" role="img" aria-label="${esc(title)}"><defs>
    <marker id="m-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="m-arrow"/></marker>
    <marker id="m-arr-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="m-arrow m-arrow--hot"/></marker>
  </defs><g id="m-view"><g id="m-stage"></g></g></svg></div></div>
  <details class="ide-foot m-legend-bar"${ui.legendClosed ? "" : " open"}><summary>Legend and help</summary>${legend(isAdrLevel)}<div class="ak-maphint">${esc(hint)}</div></details>
</section>
<div class="ide-split" data-side="r" role="separator" aria-orientation="vertical"></div>
<aside class="ide-pane ide-right m-detail" id="m-dpanel" aria-live="polite"><header class="ide-head"><h2>Details</h2><button type="button" class="m-ov-x" data-ide-toggle="r" aria-label="Hide details">×</button></header><div class="ide-body m-detail-body" id="m-detail"></div></aside>
</div>`;
  const setUI = (k, v) => {
    if (ui[k] === v) return; // the initial toggle event of <details open> is not a choice
    ui[k] = chosen[k] = v;
    try { localStorage.setItem("crux-map-ui", JSON.stringify(chosen)); } catch { /* per visit only */ }
  };
  root.querySelector(".ide-foot").addEventListener("toggle", (ev) => setUI("legendClosed", !ev.target.open));
  root.style.setProperty("--m-top", `${document.querySelector(".ak-top")?.offsetHeight ?? 49}px`);
  const unbindIde = bindIde(root);

  const svg = $("#m-svg");
  const stage = $("#m-stage");

  // ── items, edges, layout ──
  let items = isAdrLevel ? adrItems(node.deep) : nodeItems(node ? node.children : flat ? flatten(arch, arch.roots) : arch.roots, flat);
  const edges = isAdrLevel ? adrEdges(items) : liftedEdges(items);
  // Inner levels: neighbours outside this node appear as ghost boxes, so the flow stays readable.
  // A fully pinned level is hand-drawn; leave it alone.
  if (!isAdrLevel && node && !items.every((n) => n.fx != null && n.fy != null)) {
    const g = ghostEdges(node, items);
    items = items.concat(g.items);
    edges.push(...g.edges);
  }
  // Shared infra (consul, prometheus, …) that most boxes talk to would bury everything else:
  // its lines show only while it is selected.
  const quiet = new Set();
  if (!isAdrLevel) {
    const deg = new Map();
    for (const e of edges) for (const id of [e.from, e.to]) deg.set(id, (deg.get(id) ?? 0) + 1);
    for (const it of items) if (["infra", "cache"].includes(it.node?.kind) && deg.get(it.id) >= 4) quiet.add(it.id);
  }
  for (const e of edges) e.quiet = quiet.has(e.from) || quiet.has(e.to);
  let lay = layout(items, edges.filter((e) => !e.quiet));
  let band = null;
  if (!isAdrLevel && node?.adrs.length) {
    // A node with children and its own decisions: decisions sit in a band under the components.
    const own = adrItems(node.adrs);
    const ownEdges = adrEdges(own);
    grid(own, 0, 4);
    const top = Math.max(...items.map((n) => n.y + n.h)) + 76;
    for (const n of own) n.y += top;
    band = { y: top - 40, label: `Decisions about ${node.label}`, items: own };
    items = items.concat(own);
    edges.push(...ownEdges);
  }

  // ── sticky layout: boxes stay where people dropped them ──
  const level = levelKey(node, isAdrLevel, flat);
  const saved = savedLayout(level);
  if (saved) {
    const pinned = items.filter((n) => saved[n.id]);
    if (pinned.length) lay = null; // dragged boxes no longer sit in their rows
    for (const n of pinned) [n.x, n.y] = saved[n.id];
    // boxes that are new since the layout was saved line up under it
    if (pinned.length) {
      const b = bounds(pinned);
      let x = b.x;
      for (const n of items) if (!saved[n.id]) { n.x = x; n.y = b.y2 + GY * 1.6; x += n.w + 40; }
    }
  }

  const byId = new Map(items.map((n) => [n.id, n]));
  let selected = null;
  // Decision cards in the band under the components route among themselves only.
  const straight = (node ? node.lines : S.site.architecture.lines) === "straight";
  const inBand = (n) => !!n.adr && !isAdrLevel;
  const draw = () => {
    const keep = stage.querySelector(".m-replay-layer");
    stage.replaceChildren();
    const b = bounds(items, 24);
    for (const g of groupsFor(node)) drawGroup(stage, g, byId);
    if (lay) {
      const byGrp = new Map();
      for (const n of items) if (n.ctx) byGrp.set(n.ctx.label, [...(byGrp.get(n.ctx.label) ?? []), n]);
      for (const [name, ns] of byGrp) {
        const x = Math.min(...ns.map((n) => n.x)) - 16, y = Math.min(...ns.map((n) => n.y)) - 34;
        const w = Math.max(...ns.map((n) => n.x + n.w)) + 16 - x, h = Math.max(...ns.map((n) => n.y + n.h)) + 16 - y;
        const g = svgEl("g", { class: "m-ctxframe" }, stage);
        svgEl("rect", { x, y, width: w, height: h, style: `--c:${ns[0].ctx.color}` }, g);
        svgEl("text", { x: x + 12, y: y + 20, style: `fill:${ns[0].ctx.color}` }, g).textContent = name.toUpperCase();
      }
    }
    if (lay?.tiers.length) {
      // each tier is a framed block; context frames sit inside Process
      const frames = TIERS.map((t, i) => ({ t, ns: items.filter((n) => tierOf(n) === i) })).filter((f) => f.ns.length);
      const tf = [];
      for (const { t, ns } of frames) {
        const x = Math.min(...ns.map((n) => n.x)) - 40, y = Math.min(...ns.map((n) => n.y)) - 74;
        const w = Math.max(...ns.map((n) => n.x + n.w)) + 40 - x, h = Math.max(...ns.map((n) => n.y + n.h)) + 28 - y;
        tf.push({ t, x, y, w, h });
      }
      const top = Math.min(...tf.map((f) => f.y)), bot = Math.max(...tf.map((f) => f.y + f.h));
      for (const f of tf) { // one height per tier, so the four blocks read as a row
        const g = svgEl("g", { class: "m-tierframe" }, stage);
        svgEl("rect", { x: f.x, y: top, width: f.w, height: bot - top }, g);
        svgEl("text", { x: f.x + 14, y: top + 22 }, g).textContent = f.t.label.toUpperCase();
      }
      stage.prepend(...[...stage.querySelectorAll(".m-tierframe")]);
    }
    if (band) {
      const y = Math.min(...band.items.map((n) => n.y)) - 36;
      svgEl("line", { class: "m-band-line", x1: b.x + 8, x2: b.x2 - 8, y1: y, y2: y }, stage);
      svgEl("text", { class: "m-band", x: b.x + 24, y: y + 20 }, stage).textContent = band.label.toUpperCase();
    }
    const edgeLayer = svgEl("g", {}, stage);
    const rowed = (n) => lay && n.band != null; // boxes in the tier rows; decision cards route among themselves
    const act = edges.filter((e) => !e.quiet || e.from === selected || e.to === selected);
    const ends = assignPorts(act, byId, items, !!lay);
    routeTiered(ends.filter((end) => rowed(end.a) && rowed(end.b)), lay);
    const rest = ends.filter((end) => !(rowed(end.a) && rowed(end.b)));
    for (const inside of [true, false]) {
      const own = rest.filter((end) => inBand(end.a) === inside);
      routeEdges(own, items.filter((n) => inBand(n) === inside), straight);
    }
    stage.classList.toggle("m-dense", act.length > 24);
    const pending = ends.map((end) => drawEdge(edgeLayer, end)).filter(Boolean);
    for (const n of items) (n.adr ? drawAdr : n.ghost ? drawGhost : drawNode)(stage, n);
    // Labels go last, on top of boxes, placed where they hit no box and no other label.
    placeLabels(svgEl("g", { class: "m-labels" }, stage), pending, items);
    if (keep) stage.append(keep);
    paint();
  };
  $("#m-meta").textContent = isAdrLevel ? `${items.length} decisions` : `${items.filter((n) => !n.adr).length} components · ${node ? node.deep.length : new Set(Object.values(arch.nodes).flatMap((x) => x.adrs)).size} decisions${quiet.size ? ` · lines to ${[...quiet].map((id) => byId.get(id).node.label).join(", ")} show when selected` : ""}`;

  // ── viewport: pan and zoom ──
  const canvas = root.querySelector(".m-canvas");
  const view = $("#m-view");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let vp = { k: 1, tx: 0, ty: 0 };
  let leaving = false; // the exit zoom must not overwrite where this level was
  const apply = () => {
    view.setAttribute("transform", `translate(${vp.tx.toFixed(1)} ${vp.ty.toFixed(1)}) scale(${vp.k.toFixed(4)})`);
    $("#m-zlvl").textContent = `${Math.round(vp.k * 100)}%`;
    if (!leaving) viewports.set(level, vp);
  };
  // Fit the whole level into the canvas.
  const fitted = () => {
    const b = bounds(items, 32);
    const c = canvas.getBoundingClientRect();
    const W = c.width || 800, H = c.height || 520;
    const m = 16;
    const fw = Math.max(200, W - 2 * m), fh = Math.max(160, H - 2 * m);
    const k = clampK(Math.min(fw / b.w, fh / b.h, 1.15));
    return { k, tx: m + (fw - b.w * k) / 2 - b.x * k, ty: m + (fh - b.h * k) / 2 - b.y * k };
  };
  let anim = 0;
  const animate = (to, ms, done) => {
    cancelAnimationFrame(anim);
    if (reduce || !ms) { vp = to; apply(); return done?.(); }
    const from = vp, t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
      vp = { k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e };
      apply();
      if (t < 1) anim = requestAnimationFrame(step);
      else done?.();
    };
    anim = requestAnimationFrame(step);
  };
  // scale the view by f around a point on the canvas (in canvas pixels)
  const scaled = (f, px, py, from = vp) => {
    const k = clampK(from.k * f), r = k / from.k;
    return { k, tx: px - (px - from.tx) * r, ty: py - (py - from.ty) * r };
  };
  const zoomBy = (f, px = canvas.clientWidth / 2, py = canvas.clientHeight / 2, ms = 160) => animate(scaled(f, px, py), ms);
  const fit = (ms = 220) => animate(fitted(), ms);
  const toScreen = (x, y) => [x * vp.k + vp.tx, y * vp.k + vp.ty];

  draw();
  // ── entrance: finish the zoom started on the previous level ──
  const target = viewports.get(level) ?? fitted();
  if (entering && !reduce) {
    const W = canvas.clientWidth / 2, H = canvas.clientHeight / 2;
    vp = scaled(entering === "in" ? 0.6 : 1.6, W, H, target);
    apply();
    stage.style.opacity = "0";
    stage.getBoundingClientRect();
    stage.style.opacity = "1";
    animate(target, 300);
  } else {
    vp = target;
    apply();
  }
  entering = null;

  // ── selection ──
  // paint: selection classes on the drawn boxes and lines (again after every redraw)
  function paint() {
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
  }
  let select = (id) => {
    selected = id && byId.has(id) ? id : null;
    quiet.size ? draw() : paint();
    const it = selected && byId.get(selected);
    $("#m-detail").innerHTML = it?.ghost ? ghostDetail(it.ghost) : it?.adr ? adrDetail(it.adr) : isAdrLevel ? nodeDetail(node, false) : nodeDetail(selected ? arch.nodes[selected] : node, !!selected);
    $("#m-in").disabled = !(it && (it.adr || it.ghost || drillable(it.node) || it.node?.doc));
  };

  const go = (target, dir, from) => {
    if (target == null) return;
    const hash = target ? `#/map/${encodeURIComponent(target)}` : "#/map";
    if (reduce) return void (location.hash = hash);
    const [px, py] = from ? toScreen(from.x + from.w / 2, from.y + from.h / 2) : [canvas.clientWidth / 2, canvas.clientHeight / 2];
    leaving = true; // coming back finds the level as it was
    animate(scaled(dir === "in" ? 2.4 : 0.5, px, py), 280);
    stage.style.opacity = "0";
    entering = dir;
    setTimeout(() => (location.hash = hash), 280);
  };
  const zoomIn = (id) => {
    const it = byId.get(id ?? selected);
    if (it?.adr) return void (location.hash = href(it.adr).slice(1));
    if (it?.ghost) return go(it.ghost.parent ?? "", "out");
    if (it && drillable(it.node)) go(it.id, "in", it);
    else if (it?.node?.doc) location.hash = `#/el/${encodeURIComponent(it.node.doc)}`;
  };
  const zoomOut = () => node && go(node.parent ?? "", "out");

  // Click selects; clicking the selected box again zooms into it (or opens the decision).
  let dragged = false;
  svg.addEventListener("click", (ev) => {
    if (dragged) return void (dragged = false);
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
  // ── canvas gestures ──
  // Wheel or two-finger scroll pans; a pinch (ctrl + wheel on a trackpad) or ctrl/⌘ + wheel zooms
  // around the pointer.
  const at = (ev) => { const r = svg.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? canvas.clientHeight : 1;
    if (ev.ctrlKey || ev.metaKey) {
      const [px, py] = at(ev);
      cancelAnimationFrame(anim);
      vp = scaled(Math.exp(-ev.deltaY * unit * 0.0025), px, py);
    } else {
      vp = { ...vp, tx: vp.tx - ev.deltaX * unit, ty: vp.ty - ev.deltaY * unit };
    }
    apply();
  }, { passive: false });
  // Pointer: drag a box to move it (it stays there), drag the background to pan, two fingers to
  // pinch. A press that does not move stays a click.
  const pointers = new Map();
  let drag = null, frame = 0;
  const redraw = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); };
  svg.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    dragged = false;
    pointers.set(ev.pointerId, at(ev));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = { pinch: true, d0: Math.hypot(a[0] - b[0], a[1] - b[1]), vp0: vp, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], moved: true };
      return;
    }
    const g = ev.target.closest(".m-node");
    const it = g ? byId.get(g.dataset.id) : null;
    const [px, py] = at(ev);
    drag = { it, px, py, x0: it?.x, y0: it?.y, vp0: vp, moved: false, id: ev.pointerId };
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!pointers.has(ev.pointerId) || !drag) return;
    pointers.set(ev.pointerId, at(ev));
    if (drag.pinch) {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      vp = scaled(d / drag.d0, drag.mid[0], drag.mid[1], drag.vp0);
      return apply();
    }
    const [px, py] = at(ev);
    const dx = px - drag.px, dy = py - drag.py;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      svg.setPointerCapture(ev.pointerId);
      canvas.classList.add(drag.it ? "is-moving" : "is-panning");
    }
    if (drag.it) {
      drag.it.x = drag.x0 + dx / vp.k;
      drag.it.y = drag.y0 + dy / vp.k;
      redraw();
    } else {
      vp = { ...drag.vp0, tx: drag.vp0.tx + dx, ty: drag.vp0.ty + dy };
      apply();
    }
  });
  const release = (ev) => {
    pointers.delete(ev.pointerId);
    if (!drag || (drag.pinch && pointers.size)) return;
    if (drag.moved) {
      dragged = ev.type === "pointerup";
      if (drag.it) {
        settle(drag.it, items);
        draw();
        storeLayout(level, Object.fromEntries(items.map((n) => [n.id, [Math.round(n.x), Math.round(n.y)]])));
        $("#m-reset").hidden = false;
      }
    }
    canvas.classList.remove("is-moving", "is-panning");
    drag = null;
  };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);
  $("#m-zin").addEventListener("click", () => zoomBy(1.25));
  $("#m-zout").addEventListener("click", () => zoomBy(0.8));
  $("#m-zlvl").addEventListener("click", () => fit());
  $("#m-reset").addEventListener("click", async () => {
    await storeLayout(level, null);
    viewports.delete(level);
    dispatchEvent(new HashChangeEvent("hashchange"));
  });
  const onResize = () => { if (!viewports.has(level)) fit(0); };
  addEventListener("resize", onResize);
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
    else if (ev.key === "-" || ev.key === "_") zoomBy(0.8);
    else if (ev.key === "+" || ev.key === "=") zoomBy(1.25);
    else if (ev.key === "0") fit();
  };
  addEventListener("keydown", onKey);
  // Decision impact: hovering a decision (band card, detail row, any reference) lights the boxes
  // whose subtree it touches and the lines between them; ?impact=<id> keeps one lit.
  const impact = (adrId) => {
    stage.classList.toggle("is-impact", !!adrId);
    const hit = new Set();
    if (adrId) for (const it of items) {
      const n = it.node ?? it.ghost;
      // its own subtree has the decision, or a parent does (a decision about the broker covers its topics)
      let up = false;
      for (let p = n && S.site.architecture.nodes[n.parent]; p && !up; p = S.site.architecture.nodes[p.parent]) up = p.adrs?.includes(adrId);
      if (it.adr ? it.adr.id === adrId : n && (n.deep?.includes(adrId) || up)) hit.add(it.id);
    }
    for (const el of stage.querySelectorAll(".m-node")) el.classList.toggle("is-hit", hit.has(el.dataset.id));
    for (const el of stage.querySelectorAll(".m-edge")) el.classList.toggle("is-hit", hit.has(el.dataset.from) && hit.has(el.dataset.to));
  };
  const pinned = q.get("impact");
  const adrOf = (el) => el?.closest?.("[data-ref]")?.dataset.ref ?? el?.closest?.(".m-node.k-adr")?.dataset.id ?? null;
  root.addEventListener("mouseover", (ev) => { const id = adrOf(ev.target); if (id) impact(id); });
  root.addEventListener("mouseout", (ev) => { if (adrOf(ev.target) && !adrOf(ev.relatedTarget)) impact(pinned); });
  if (pinned) {
    const a = S.byId.get(pinned);
    const bar = document.createElement("div");
    bar.className = "m-impact";
    bar.innerHTML = `<span>Impact of</span><a href="${href(a ?? { id: pinned, kind: "adr" })}" data-ref="${esc(pinned)}">${esc(a ? `${label(a)} · ${a.title}` : pinned)}</a><a class="x" href="#/map/${encodeURIComponent(node?.id ?? "")}" aria-label="Clear">×</a>`;
    root.querySelector(".m-canvas")?.before(bar);
    impact(pinned);
  }
  // ── explorer: every component as a tree; a click finds it on the canvas or opens the level it lives on ──
  const tree = $("#m-tree");
  const kids = (n) => n.children.map((id) => arch.nodes[id]).filter(Boolean);
  const startOpen = new Set(path.map((n) => n.id));
  if (flat) for (const id of arch.roots) if (CONTAINER.has(arch.nodes[id]?.kind)) startOpen.add(id);
  const row = (n) => {
    const ks = kids(n);
    return `<li data-id="${esc(n.id)}" data-text="${esc(`${n.label} ${n.kind} ${n.tech ?? ""} ${n.sub ?? ""}`.toLowerCase())}"><div class="tree-row${n.id === node?.id ? " is-here" : ""}" role="treeitem" data-id="${esc(n.id)}" title="${esc(n.sub || n.label)}"><button type="button" class="tw${ks.length ? "" : " leaf"}" aria-label="Expand">${startOpen.has(n.id) ? "▾" : "▸"}</button>${kindGlyph(n.kind, 12)}<span class="tn">${esc(n.label)}</span><span class="tk">${esc(n.kind)}</span></div>${ks.length ? `<ul${startOpen.has(n.id) ? "" : " hidden"}>${ks.map(row).join("")}</ul>` : ""}</li>`;
  };
  tree.innerHTML = `<ul class="tree" role="tree">${arch.roots.map((id) => arch.nodes[id]).filter(Boolean).map(row).join("")}</ul>`;
  const setOpen = (li, on) => {
    const ul = li.querySelector(":scope > ul"), tw = li.querySelector(":scope > .tree-row > .tw");
    if (!ul) return;
    ul.hidden = !on;
    tw.textContent = on ? "▾" : "▸";
  };
  const focusNode = (id) => {
    if (byId.has(id)) {
      select(id);
      const it = byId.get(id);
      const c = canvas.getBoundingClientRect();
      animate({ k: vp.k, tx: c.width / 2 - (it.x + it.w / 2) * vp.k, ty: c.height / 2 - (it.y + it.h / 2) * vp.k }, 240);
      return;
    }
    const n = arch.nodes[id];
    if (n) location.hash = `#/map/${encodeURIComponent(n.parent ?? "")}?sel=${encodeURIComponent(id)}`;
  };
  tree.addEventListener("click", (ev) => {
    const tw = ev.target.closest(".tw");
    if (tw) return void (tw.classList.contains("leaf") || setOpen(tw.closest("li"), tw.closest("li").querySelector(":scope > ul").hidden));
    const r = ev.target.closest(".tree-row");
    if (r) focusNode(r.dataset.id);
  });
  tree.addEventListener("dblclick", (ev) => {
    const r = ev.target.closest(".tree-row");
    const n = r && arch.nodes[r.dataset.id];
    if (n && drillable(n)) location.hash = `#/map/${encodeURIComponent(n.id)}`;
  });
  $("#m-find").addEventListener("input", (ev) => {
    const text = ev.target.value.trim().toLowerCase();
    const lis = [...tree.querySelectorAll("li")].reverse(); // children before parents
    for (const li of lis) {
      const own = !text || li.dataset.text.includes(text);
      const sub = [...li.querySelectorAll(":scope > ul > li")].some((c) => !c.classList.contains("is-hidden"));
      li.classList.toggle("is-hidden", !(own || sub));
      if (text && sub) setOpen(li, true);
    }
  });
  const markTree = () => {
    for (const r of tree.querySelectorAll(".tree-row")) r.classList.toggle("is-sel", r.dataset.id === selected);
    const r = selected && tree.querySelector(`.tree-row[data-id="${CSS.escape(selected)}"]`);
    if (r) {
      for (let li = r.closest("li").parentElement.closest("li"); li; li = li.parentElement.closest("li")) setOpen(li, true);
      r.scrollIntoView({ block: "nearest" });
    }
  };
  const selectBase = select;
  select = (id) => { selectBase(id); markTree(); };
  $("#m-flat").addEventListener("click", () => {
    try { localStorage.setItem("crux-map-flat", flat ? "0" : "1"); } catch { /* per visit only */ }
    location.hash = `#/map?flat=${flat ? "0" : "1"}`;
  });
  select(q.get("sel"));
  const stopReplay = q.get("replay") && S.replay ? replayOnMap(root, stage, items, S.replay) : null;
  return () => { unbindIde(); removeEventListener("keydown", onKey); removeEventListener("resize", onResize); cancelAnimationFrame(anim); stopReplay?.(); };
}

// settle a dropped box so the lines keep routing cleanly: the router runs lines in the gaps
// between columns, so a box joins the column it was dropped near (centers aligned), or stands
// clear of every column; then it snaps to a 10 px grid and moves off any box it would cover.
function settle(it, items) {
  const others = items.filter((n) => n !== it);
  if (!others.length) return;
  const cx = it.x + it.w / 2;
  const near = others.map((n) => ({ n, d: Math.abs(n.x + n.w / 2 - cx) })).sort((a, b) => a.d - b.d)[0];
  if (near.d < Math.max(it.w, near.n.w) * 0.6) {
    it.x = near.n.x + (near.n.w - it.w) / 2; // into that column
  } else {
    // a column of its own: no box may overlap it sideways; move to the closer clear side
    const gap = 70;
    for (let k = 0; k < others.length; k++) {
      const hit = others.find((n) => it.x < n.x + n.w + gap && it.x + it.w > n.x - gap && Math.abs(n.x + n.w / 2 - (it.x + it.w / 2)) > 1);
      if (!hit) break;
      const left = hit.x - gap - it.w, right = hit.x + hit.w + gap;
      it.x = Math.abs(left - it.x) < Math.abs(right - it.x) ? left : right;
    }
  }
  it.y = Math.round(it.y / 10) * 10;
  // inside a column: step down (or up, if closer) until it covers no box
  const pad = GY / 2;
  const covers = (y) => others.find((n) => it.x < n.x + n.w && it.x + it.w > n.x && y < n.y + n.h + pad && y + it.h + pad > n.y);
  if (covers(it.y)) {
    let down = it.y, up = it.y;
    for (let b; (b = covers(down)); ) down = b.y + b.h + pad;
    for (let b; (b = covers(up)); ) up = b.y - it.h - pad;
    it.y = Math.abs(down - it.y) <= Math.abs(up - it.y) ? down : up;
  }
}

// The key a level's layout and viewport are kept under: "" for the top, the node id, or
// "adrs:<id>" for a leaf's decisions.
// Open or closed overlays, kept for the next visit.
function mapUI() {
  try { return JSON.parse(localStorage.getItem("crux-map-ui") ?? "{}"); } catch { return {}; }
}

const levelKey = (node, isAdrLevel, flat = false) => (isAdrLevel ? `adrs:${node.id}` : node?.id ?? (flat ? "~flat" : ""));

const drillable = (n) => n && (n.children.length || n.deep.length);

function legend(isAdrLevel) {
  if (isAdrLevel) {
    return `<div class="ak-legend m-legend">${["open", "proposed", "accepted", "rejected", "superseded"].filter((k) => S.site.statuses[k]).map((k) => `<span><i class="m-key m-key--adr ak-st-${k}"></i>${esc(statusLabel(k))}</span>`).join("")}<span><i class="m-key m-key--line"></i>depends on / supersedes</span><span><i class="m-key m-key--dash"></i>relates / mentions</span></div>`;
  }
  const nodes = Object.values(S.site.architecture.nodes ?? {});
  const techs = [...new Set(nodes.map((n) => n.tech).filter(Boolean))].sort();
  const modes = new Set((S.site.architecture.edges ?? []).map((e) => e.mode).filter(Boolean));
  const kinds = new Set(nodes.map((n) => n.kind));
  const k = (cls, text, on = true) => (on ? `<span><i class="m-key ${cls}"></i>${text}</span>` : "");
  return `<div class="ak-legend m-legend">${k("m-key--ctx", "Context", kinds.has("context") || kinds.has("domain"))}${k("m-key--svc", "Service", kinds.has("service") || kinds.has("binary"))}${k("m-key--mod", "Module", kinds.has("module") || kinds.has("package"))}${k("m-key--ext", "External, store, topic or entity")}${k("m-key--plan", "Planned or inferred")}${k("m-key--sync", "sync call", modes.has("sync"))}${k("m-key--async", "async event", modes.has("async"))}${k("m-key--data", "data access", modes.has("data"))}${techs.map((t) => techChip(t)).join("")}<span><b class="m-key m-key--cnt">3</b>Decisions inside</span></div>`;
}

// ── items ────────────────────────────────────────────────
// A context only groups services: with "expand contexts" the boxes are the services (and the
// brokers, stores, … beside them) and each one is marked with the context it lives in.
const CONTAINER = new Set(["context", "domain"]);
const canFlatten = (arch) => Object.values(arch.nodes).some((n) => CONTAINER.has(n.kind) && n.children.length && arch.roots.includes(n.id));
const flatPref = (q) => {
  if (q?.has("flat")) return q.get("flat") !== "0";
  try { return localStorage.getItem("crux-map-flat") !== "0"; } catch { return true; }
};
function flatten(arch, ids) {
  return ids.flatMap((id) => {
    const n = arch.nodes[id];
    return n && CONTAINER.has(n.kind) && n.children.length ? flatten(arch, n.children) : n ? [id] : [];
  });
}
const CTX_COLORS = ["#2f6fdb", "#c2410c", "#0f8a5f", "#8b3fd1", "#b8860b", "#d6336c", "#0e7490", "#65734b"];

function nodeItems(ids, flat = false) {
  const arch = S.site.architecture;
  const ctxIndex = new Map();
  return ids.map((id) => arch.nodes[id]).filter(Boolean).map((n) => {
    const w = n.w ?? NW;
    // With many boxes on one canvas, services lose their description line (it is in the details pane).
    const compact = flat && ids.length > 14 && !n.children.length;
    const lines = n.sub && !compact ? wrapText(n.sub, Math.floor((w - 16) / CHAR_W)) : [];
    const labelLines = wrapText(n.label, Math.floor((w - 50) / 7.6)).slice(0, 2);
    const h = compact ? Math.max(n.h ?? 0, 32 + labelLines.length * 17 + (n.deep.length ? 14 : 2)) : Math.max(n.h ?? NH, 34 + labelLines.length * 17 + lines.length * 14 + (drillable(n) || n.deep.length ? 20 : 4));
    const ctx = flat && CONTAINER.has(arch.nodes[n.parent]?.kind) ? arch.nodes[n.parent] : null;
    if (ctx && !ctxIndex.has(ctx.id)) ctxIndex.set(ctx.id, ctxIndex.size);
    return { id: n.id, node: n, w, h, lines, labelLines, fx: n.x, fy: n.y, at: n.at, ctx: ctx ? { label: ctx.label, color: CTX_COLORS[ctxIndex.get(ctx.id) % CTX_COLORS.length] } : null };
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
    es.set(k, { from, to, labels: e.label ? [e.label] : [], dashed: e.dashed, both: e.both, ghost: true, mode: e.mode, transport: e.transport });
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
      if (e.mode === "async") prev.mode = "async";
      if (prev.transport !== e.transport) prev.transport = prev.mode === "data" ? prev.transport : "";
      prev.sel &&= !!e.sel;
      if (e.label && !prev.labels.includes(e.label)) prev.labels.push(e.label);
      continue;
    }
    // Layout hints (lp, lo) only make sense on the level the edge was written for.
    out.set(k, { from, to, labels: e.label ? [e.label] : [], dashed: e.dashed, both: e.both, sel: !!e.sel, lp: exact ? e.lp : null, lo: exact ? e.lo : null, mode: e.mode, transport: e.transport });
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
    return null;
  }
  // Component levels are tiered; decision levels (and boxes with hand-set column hints) flow left to right.
  if (!items.some((n) => n.adr || n.at)) return tiered(items, edges);
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

// ── tiered layout ────────────────────────────────────────
// Rows, top to bottom: who calls in (clients), the services they reach, the infrastructure those
// run on, and the outside world. A tier that grows wraps into columns. Returns the tier captions.
const TIERS = [
  { label: "Entry", kinds: ["actor", "app", "gateway"] },
  { label: "Process", kinds: [] },
  { label: "Infrastructure", kinds: ["store", "broker", "cache", "infra", "queue", "topic"] },
  { label: "Outside", kinds: ["external"] },
];
const tierOf = (n) => {
  const kind = (n.node ?? n.ghost)?.kind;
  const i = TIERS.findIndex((t) => t.kinds.includes(kind));
  return i < 0 ? 1 : i;
};
const TGX = 56, TGY = 80, TIER_GAP = 190, LANE = 8;

// Rows (bands) are laid out first, then every gap between two rows grows to give each line that
// runs through it its own lane. Returns the tier captions, the bands and the gaps for routing.
function tiered(items, edges) {
  // Laid out as rows, then flipped: a tier becomes a column, flow runs left to right.
  const flip = () => { for (const n of items) [n.w, n.h] = [n.h, n.w]; };
  flip();
  const lay = tieredRows(items, edges);
  flip();
  for (const n of items) [n.x, n.y] = [n.y, n.x];
  return lay;
}

function tieredRows(items, edges) {
  const byId = new Map(items.map((n) => [n.id, n]));
  const links = edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to);
  const rows = TIERS.map((_, i) => items.filter((n) => tierOf(n) === i));

  // Flow order inside a tier: callers before callees (back edges ignored), else the given order.
  const flow = (xs) => {
    const ids = new Set(xs.map((n) => n.id));
    const out = new Map(xs.map((n) => [n.id, []]));
    for (const e of links) if (ids.has(e.from) && ids.has(e.to) && !e.both && !e.plain) out.get(e.from).push(e.to);
    const seen = new Set(), order = [];
    const visit = (id) => { if (seen.has(id)) return; seen.add(id); out.get(id).forEach(visit); order.unshift(id); };
    xs.forEach((n) => visit(n.id));
    return order.map((id) => byId.get(id));
  };

  // 1. bands: x inside the row, and the order of rows
  const bands = [];
  const placed = new Set();
  let used = 0;
  rows.forEach((row, ti) => {
    if (!row.length) return;
    used++;
    const real = flow(row.filter((n) => !n.ghost)), ghosts = row.filter((n) => n.ghost);
    // Single-row tiers sit under the boxes they talk to; wrapped tiers keep the flow order.
    const bary = (n) => {
      const xs = links.filter((e) => e.from === n.id || e.to === n.id).map((e) => byId.get(e.from === n.id ? e.to : e.from)).filter((m) => placed.has(m.id) && m.x != null).map((m) => m.x + m.w / 2);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    let first = true;
    // each context is its own block, so it can be framed; outside neighbours come first
    const byCtx = new Map();
    for (const n of real) byCtx.set(n.ctx?.label ?? "", [...(byCtx.get(n.ctx?.label ?? "") ?? []), n]);
    for (const group of [ghosts, ...byCtx.values()]) {
      if (!group.length) continue;
      const cols = group.length <= 5 ? group.length : Math.min(13, Math.ceil(Math.sqrt(group.length * 4.5)));
      let seq = group;
      if (group.length <= cols && ti > 0) {
        const b = new Map(group.map((n) => [n.id, bary(n) ?? Infinity]));
        if ([...b.values()].some((v) => v !== Infinity)) seq = [...group].sort((p, q) => b.get(p.id) - b.get(q.id) || group.indexOf(p) - group.indexOf(q));
      }
      const colW = Math.max(...seq.map((n) => n.w)) + TGX;
      for (let r = 0; r * cols < seq.length; r++) {
        const its = seq.slice(r * cols, (r + 1) * cols);
        const h = Math.max(...its.map((n) => n.h));
        const width = its.length * colW - TGX;
        its.forEach((n, i) => { n.x = -width / 2 + i * colW + (colW - TGX - n.w) / 2; n.band = bands.length; });
        bands.push({ items: its, h, tier: ti, tierStart: first && r === 0, grpStart: r === 0 && !first });
      }
      first = false;
    }
    row.forEach((n) => placed.add(n.id));
  });

  // 2. how many lines run through each gap (gap k lies under band k)
  const need = bands.map(() => 0);
  for (const e of links) {
    const ba = byId.get(e.from).band, bb = byId.get(e.to).band;
    const u = Math.min(ba, bb), l = Math.max(ba, bb);
    need[u]++;
    if (l > u + 1) need[l - 1]++;
  }

  // 3. y positions: each gap holds its lanes, plus a strip for the next tier's caption
  const CAP = 34;
  let y = 0;
  const gaps = [], tiers = [];
  bands.forEach((band, k) => {
    band.y = y;
    for (const n of band.items) n.y = y + (band.h - n.h) / 2;
    y += band.h;
    const next = bands[k + 1];
    const base = !next ? 0 : next.tier !== band.tier ? TIER_GAP : next.grpStart ? TGY + 40 : TGY;
    const lanes = Math.min(320, Math.max(base, need[k] ? 24 + need[k] * LANE : 0));
    const cap = next?.tierStart ? CAP : 0;
    gaps.push({ y1: y, y2: y + lanes, lanes: [y + 6, y + lanes - 6] });
    y += lanes + cap;
    if (band.tierStart) tiers.push({ label: TIERS[band.tier].label, y1: band.y });
  });
  return { tiers: used > 1 ? tiers : [], bands, gaps };
}

// Lines between rows: down out of the upper box into a lane of the gap, across, down into the
// lower box. A line that skips rows drops through a clear column between them. Every line owns its lane.
function routeTiered(ends, lay) {
  if (!ends.length) return;
  const reqs = lay.gaps.map(() => []);
  const lanesUsed = new Map();
  for (const end of ends) {
    const { a, b } = end;
    const pa = [end.pa[1], end.pa[0]], pb = [end.pb[1], end.pb[0]]; // the rows frame: x along a row
    const [lo, hi] = a.band <= b.band ? [end.a, end.b] : [end.b, end.a];
    const [plo, phi] = a.band <= b.band ? [pa, pb] : [pb, pa];
    const u = lo.band, l = hi.band;
    const r1 = { x1: plo[0], x2: phi[0], y: 0 };
    reqs[u].push(r1);
    let r2 = null, lane = null;
    if (l > u + 1) {
      // a clear column across the rows in between
      const mid = lay.bands.slice(u + 1, l).flatMap((bd) => bd.items);
      const cx = [...mid.flatMap((n) => [n.y - 14, n.y + n.h + 14]), Math.min(...mid.map((n) => n.y)) - 30, Math.max(...mid.map((n) => n.y + n.h)) + 30];
      const clear = cx.filter((x) => !mid.some((n) => x > n.y - 8 && x < n.y + n.h + 8));
      const x0 = clear.sort((p, q) => Math.abs(p - phi[0]) - Math.abs(q - phi[0]))[0];
      const k = Math.round(x0);
      const c = lanesUsed.get(k) ?? 0;
      lanesUsed.set(k, c + 1);
      lane = x0 + (c % 2 ? 1 : -1) * Math.ceil(c / 2) * 5;
      r2 = { x1: lane, x2: phi[0], y: 0 };
      reqs[l - 1].push(r2);
    }
    end.plan = { r1, r2, lane, plo, phi, flip: a.band > b.band };
  }
  // Lanes in a gap: runs that go right stack so the one starting furthest right is on top; left-going mirror that.
  reqs.forEach((rs, k) => {
    const g = lay.gaps[k];
    const dirOf = (r) => Math.sign(r.x2 - r.x1);
    rs.sort((p, q) => dirOf(p) - dirOf(q) || (dirOf(p) >= 0 ? q.x1 - p.x1 : p.x1 - q.x1));
    const step = rs.length > 1 ? (g.lanes[1] - g.lanes[0]) / (rs.length - 1) : 0;
    rs.forEach((r, i) => (r.y = rs.length > 1 ? g.lanes[0] + i * step : (g.y1 + g.y2) / 2));
  });
  for (const end of ends) {
    const { r1, r2, lane, plo, phi, flip } = end.plan;
    const pts = r2
      ? [plo, [plo[0], r1.y], [lane, r1.y], [lane, r2.y], [phi[0], r2.y], phi]
      : [plo, [plo[0], r1.y], [phi[0], r1.y], phi];
    end.pts = dedupe((flip ? pts.reverse() : pts).map((q) => [q[1], q[0]]));
  }
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
function assignPorts(edges, byId, boxes, tiered = false) {
  const sides = new Map();
  const ends = [];
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const [ax, ay] = center(a), [bx, by] = center(b);
    let sa, sb;
    if (tiered && a.band != null && b.band != null) {
      // Columns: leave the earlier tier on its right and enter the later one on its left.
      if (a.band === b.band) sa = sb = "R";
      else { sa = a.band < b.band ? "R" : "L"; sb = sa === "R" ? "L" : "R"; }
    } else if (Math.abs(bx - ax) > (a.w + b.w) / 4) {
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
  const attrs = { class: `m-edge${e.dashed ? " dashed" : ""}${e.sel ? " onsel" : ""}${e.type ? ` t-${e.type}` : ""}${e.mode ? ` m-${e.mode}` : ""}`, "data-from": e.from, "data-to": e.to };
  const g = svgEl("g", attrs, layer);
  const path = svgEl("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") }, g);
  if (!e.plain) path.setAttribute("marker-end", "url(#m-arr)");
  if (e.both) path.setAttribute("marker-start", "url(#m-arr)");
  if (!e.label && e.transport && e.mode !== "data" && !e.ghost) e.label = e.transport;
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
    const full = e.transport && e.mode !== "data" && !e.label.toLowerCase().startsWith(e.transport) ? `${e.transport} · ${e.label}` : e.label;
    const text = full.length > 38 ? full.slice(0, 37) + "…" : full;
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
const tagText = (n) => { const t = n.tech || n.techs?.[0]; return (n.tag ?? (t ? `${n.kind} · ${techOf(t).label ?? t}` : String(n.kind))).toUpperCase(); };

function drawNode(stage, it) {
  const n = it.node;
  const drill = drillable(n);
  const g = svgEl("g", { class: `m-node k-${n.kind}${techCls(n)}${drill ? " drill" : ""}${n.origin === "inferred" ? " is-inferred" : ""}`, tabindex: 0, role: "button", "data-id": n.id, "aria-label": `${n.label}${drill ? ", zoomable" : ""}` }, stage);
  svgEl("rect", { class: "box", x: it.x, y: it.y, width: it.w, height: it.h }, g);
  if (/^(module|package|component)$/.test(n.kind)) svgEl("rect", { class: "modbar", x: it.x, y: it.y, width: 4, height: it.h }, g);
  if (it.ctx) svgEl("rect", { class: "ctxbar", x: it.x, y: it.y, width: 5, height: it.h, fill: it.ctx.color }, g);
  const icon = n.tech ? techPath(n.tech) : n.techs?.length ? techPath(n.techs[0]) : null;
  if (icon) {
    const sv = svgEl("svg", { x: it.x + 7, y: it.y + 5, width: 11, height: 11, viewBox: "0 0 24 24" }, g);
    svgEl("path", { class: "ticon", d: icon }, sv);
  }
  svgEl("text", { class: "tag", x: it.x + (icon ? 22 : 8), y: it.y + 14 }, g).textContent = tagText(n) + (it.ctx ? ` · ${it.ctx.label.replace(/\s*context$/i, "").toUpperCase()}` : "");
  const oq = n.doc ? openQuestionsFor(n.doc).length : 0;
  if (oq) {
    const b = svgEl("g", { class: "qbadge" }, g);
    svgEl("rect", { x: it.x + it.w - (n.deep.length ? 30 : 9) - 7, y: it.y + 2, width: 14, height: 14 }, b);
    svgEl("text", { x: it.x + it.w - (n.deep.length ? 30 : 9), y: it.y + 12.5, "text-anchor": "middle" }, b).textContent = "?";
  }
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
  const el = n.doc ? S.byId.get(n.doc) : null;
  const elHtml = el ? elementDetail(el) : "";
  return `<div class="kind">${esc(n.tag ?? (el ? kindName(el.kind) : n.kind))}${n.parent ? ` · in ${esc(arch.nodes[n.parent]?.label ?? n.parent)}` : ""}</div><h3>${esc(n.label)}</h3>${elHtml}
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

// ── replay a sequence on the map ─────────────────────────
// Each message lights its two boxes (the visible box that is, or contains, the participant's
// component) and sends a rectangle along the real map line; with no line, a temporary dashed one.
// Two passes, then it rests; the bar has play/pause and a way back to the decision.
function replayOnMap(root, stage, items, rp) {
  const NS = "http://www.w3.org/2000/svg";
  const nodes = S.site.architecture.nodes;
  const idOf = (x) => (x.node ?? x.ghost)?.id;
  const under = (x, id) => { for (let n = nodes[idOf(x)]; n; n = nodes[n.parent]) if (n.id === id) return true; return false; };
  const linked = (x, y) => !!y && [...stage.querySelectorAll(".m-edge")].some((e) => (e.dataset.from === x.id && e.dataset.to === y.id) || (e.dataset.from === y.id && e.dataset.to === x.id));
  // The visible box for a component: itself, else its nearest visible parent, else a visible child
  // (a topic for its broker), preferring one with a line to the other participant.
  const boxFor = (id, other) => {
    for (let n = nodes[id]; n; n = nodes[n.parent]) {
      const it = items.find((x) => idOf(x) === n.id);
      if (it) return it;
    }
    const kids = items.filter((x) => !x.adr && under(x, id));
    return kids.find((x) => linked(x, other)) ?? kids[0] ?? null;
  };
  const steps = rp.steps.map((x) => {
    const a0 = boxFor(x.fromNode), b0 = boxFor(x.toNode);
    return { ...x, a: boxFor(x.fromNode, b0) ?? a0, b: boxFor(x.toNode, a0) ?? b0 };
  }).filter((x) => x.a || x.b);
  if (!steps.length) return null;
  const STEP = 1500 / (rp.speed || 1.5);
  const bar = document.createElement("div");
  bar.className = "m-replay ak-seq is-paused";
  root.querySelector(".m-canvas")?.before(bar);
  const layer = svgEl("g", { class: "m-replay-layer" }, stage);
  let k = 0, passes = 0, playing = true, timer = 0, raf = 0;
  const chip = (it, name) => {
    const n = it?.node ?? it?.ghost;
    const tech = n?.tech ? ` tech tech-${n.tech.replace(/[^a-z0-9-]/g, "")}` : "";
    return `<span class="ak-sq-chip${n ? ` k-${esc(n.kind)}${tech}` : ""}">${esc(name)}</span>`;
  };
  const show = () => {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    layer.replaceChildren();
    const x = steps[k];
    stage.classList.add("is-impact");
    for (const el of stage.querySelectorAll(".m-node")) el.classList.toggle("is-hit", el.dataset.id === x.a?.id || el.dataset.id === x.b?.id);
    let path = null;
    for (const el of stage.querySelectorAll(".m-edge")) {
      const on = !!(x.a && x.b) && ((el.dataset.from === x.a.id && el.dataset.to === x.b.id) || (el.dataset.from === x.b.id && el.dataset.to === x.a.id));
      el.classList.toggle("is-hit", on);
      if (on && el.querySelector("path")) path = { el: el.querySelector("path"), reverse: el.dataset.from !== x.a.id };
    }
    bar.innerHTML = `<button type="button" class="ak-sq-btn" data-rp="play" aria-label="${playing ? "Pause" : "Play"}"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="i-pause" d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z"/><path class="i-play" d="M5 3l8 5-8 5z"/></svg></button><span class="ak-sq-count">${k + 1}/${steps.length}</span>${chip(x.a, x.from)}<span class="ak-sq-to">→</span>${chip(x.b, x.to)}${x.label ? `<span class="ak-sq-what">${esc(x.label)}</span>` : ""}<a class="m-replay-x" href="${rp.back}" title="Back to the decision">×</a>`;
    bar.classList.toggle("is-paused", !playing);
    if (x.a && x.b && x.a !== x.b) {
      const color = getComputedStyle(stage.querySelector(`.m-node[data-id="${CSS.escape(x.a.id)}"] rect.box`) ?? stage).stroke || "currentColor";
      let line = path?.el;
      if (!line) {
        line = svgEl("path", { class: "m-replay-tmp", d: `M${x.a.x + x.a.w / 2},${x.a.y + x.a.h / 2} L${x.b.x + x.b.w / 2},${x.b.y + x.b.h / 2}` }, layer);
      }
      const len = line.getTotalLength();
      const sq = svgEl("rect", { class: "ak-sq-dot", width: 18, height: 8, stroke: color }, layer);
      const t0 = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - t0) / (STEP * 0.6));
        const e = 1 - Math.pow(1 - t, 2);
        const pt = line.getPointAtLength(len * (path?.reverse ? 1 - e : e));
        sq.setAttribute("x", pt.x - 9);
        sq.setAttribute("y", pt.y - 4);
        if (t < 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    if (playing) timer = setTimeout(next, STEP);
  };
  const next = () => {
    if (k === steps.length - 1) {
      passes++;
      if (passes >= 2) { playing = false; return show(); }
      k = 0;
    } else k++;
    show();
  };
  bar.addEventListener("click", (ev) => {
    if (!ev.target.closest('[data-rp="play"]')) return;
    playing = !playing;
    if (playing && passes >= 2) { passes = 0; k = 0; }
    show();
  });
  show();
  return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
}

// The element behind a map box: tech, interfaces at a glance, flows, questions, and a way in.
function elementDetail(e) {
  const fl = flowsThrough(e.id);
  const oq = openQuestionsFor(e.id);
  const dec = decisionsFor(e.id).length;
  return `${e.tech?.length ? `<div class="ak-chips" style="margin:2px 0 8px">${e.tech.map(techChip).join("")}</div>` : ""}
${fl.length ? `<div class="ak-mini-label" style="margin-top:10px">Flows · ${fl.length}</div><div class="ak-chips">${fl.map((f) => elChip(f)).join("")}</div>` : ""}
${oq.length ? `<div class="ak-mini-label" style="margin-top:10px">Open questions · ${oq.length}</div><div class="ak-chips">${oq.map((q) => elChip(q)).join("")}</div>` : ""}
<p style="margin:12px 0 0"><a class="ak-btn" href="#/el/${encodeURIComponent(e.id)}">Open ${esc(kindName(e.kind).toLowerCase())} page →</a>${dec ? ` <span class="muted" style="font-size:12px">${dec} decision${dec > 1 ? "s" : ""}</span>` : ""}</p>`;
}
