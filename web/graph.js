// Force-directed graph of every record and how they connect.
import { $, $$, S, esc, gist, href, label, optionStats, pill, refChip, statusLabel, statusOrder, svgEl, tagChip, wrapText } from "./util.js";

const EDGE_TYPES = ["supersedes", "depends_on", "amends", "relates", "mentions"];

export function renderGraph(root, q) {
  const state = {
    status: new Set(statusOrder()),
    types: new Set(EDGE_TYPES),
    tag: q.get("tag") ?? "",
    docs: false,
    labels: true,
    focus: q.get("focus") ?? "",
  };

  root.innerHTML = `<div class="ak-page-head"><div><h1>Decision graph</h1><p>Every record and how it connects. Drag nodes, scroll to zoom, drag the background to pan.</p></div></div>
<div class="ak-filters" id="g-filters"></div>
<div class="ak-map-layout">
  <section class="ak-box ak-canvas-wrap"><div class="g-hist" id="g-hist"></div><svg class="ak-canvas ak-canvas-tall" id="g-svg" role="img" aria-label="Decision graph"></svg>
    <div class="ak-gtools"><button class="ak-btn" id="g-fit" type="button">Fit</button><button class="ak-btn" id="g-shake" type="button">Re-layout</button></div>
    <div class="ak-glegend">${EDGE_TYPES.map((t) => `<span><svg viewBox="0 0 26 8"><line x1="0" y1="4" x2="26" y2="4" class="g-edge t-${t}" style="opacity:1"/></svg>${esc(S.site.relations[t]?.label ?? t)}</span>`).join("")}<span><svg viewBox="0 0 26 8"><circle cx="13" cy="4" r="3.5" class="ak-st-doc" style="fill:var(--paper);stroke:var(--ak-purple);stroke-width:1.5"/></svg>doc</span></div>
  </section>
  <aside class="ak-box m-detail" id="g-detail"><header class="am-panel-head"><span class="am-panel-id">i</span><h2>Details</h2></header><div class="ak-box-body" id="g-detail-body"></div></aside>
</div>`;

  const svg = $("#g-svg");
  // ── history: decisions appear in date order (then by number); the newest pulses. ──
  const hist = { order: [], i: null, timer: 0 };
  const histBar = $("#g-hist");
  const histOrder = () => [...S.site.adrs].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
  function paintHistory() {
    hist.order = histOrder();
    const shown = new Set(hist.i == null ? hist.order.map((a) => a.id) : hist.order.slice(0, hist.i + 1).map((a) => a.id));
    const newest = hist.i == null ? null : hist.order[hist.i]?.id;
    svg.classList.toggle("is-history", hist.i != null);
    for (const n of nodes) if (n.el) { n.el.classList.toggle("is-later", n.a.kind === "adr" && !shown.has(n.id)); n.el.classList.toggle("is-newest", n.id === newest); }
    for (const e of edges) e.el?.classList.toggle("is-later", !(shown.has(e.from) || e.s?.a.kind !== "adr") || !(shown.has(e.to) || e.t?.a.kind !== "adr"));
    const a = hist.i == null ? null : hist.order[hist.i];
    histBar.innerHTML = `<button type="button" class="ak-sq-btn" data-h="play" aria-label="${hist.timer ? "Pause" : "Play history"}"><svg viewBox="0 0 16 16" aria-hidden="true">${hist.timer ? '<path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z"/>' : '<path d="M5 3l8 5-8 5z"/>'}</svg></button><span class="g-hist-l">History</span><input type="range" min="0" max="${hist.order.length - 1}" value="${hist.i ?? hist.order.length - 1}" data-h="seek" aria-label="Decisions so far"><span class="g-hist-n">${hist.i == null ? `all ${hist.order.length}` : `${hist.i + 1} / ${hist.order.length}`}</span>${a ? `<span class="ak-sq-what">${esc(a.date ?? "")} · ${esc(a.id)} ${esc(a.title)}</span>` : ""}${hist.i != null ? '<button type="button" class="g-hist-x" data-h="all" aria-label="Show all">×</button>' : ""}`;
  }
  const histStop = () => { clearInterval(hist.timer); hist.timer = 0; };
  histBar.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-h]");
    if (!b) return;
    if (b.dataset.h === "all") { histStop(); hist.i = null; return paintHistory(); }
    if (b.dataset.h !== "play") return;
    if (hist.timer) { histStop(); return paintHistory(); }
    if (hist.i == null || hist.i >= hist.order.length - 1) hist.i = 0;
    hist.timer = setInterval(() => {
      if (hist.i >= hist.order.length - 1) { histStop(); return paintHistory(); }
      hist.i++;
      paintHistory();
    }, 650);
    paintHistory();
  });
  histBar.addEventListener("input", (ev) => {
    if (ev.target.dataset.h !== "seek") return;
    histStop();
    hist.i = Number(ev.target.value);
    paintHistory();
  });

  const W = 1200, H = 760;
  let view = { x: 0, y: 0, w: W, h: H };
  const setView = () => svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  setView();
  const defs = svgEl("defs", {}, svg);
  for (const t of EDGE_TYPES) {
    const m = svgEl("marker", { id: `ga-${t}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, defs);
    svgEl("path", { d: "M0,0 L10,5 L0,10 z", class: `g-edge t-${t}`, style: "fill:currentColor;stroke:none;opacity:1" }, m).style.color = "var(--ink-2)";
  }
  const gEdges = svgEl("g", {}, svg);
  const gNodes = svgEl("g", {}, svg);

  // keep positions across re-filtering
  const pos = new Map();
  let nodes = [], edges = [], raf = 0, alpha = 1, selected = state.focus || null;

  function filters() {
    const order = statusOrder().filter((k) => S.site.adrs.some((a) => a.statusKey === k));
    const tags = Object.entries(S.site.tags).filter(([, ids]) => ids.length).sort((a, b) => b[1].length - a[1].length);
    $("#g-filters").innerHTML = `<span class="ak-label">Status</span><div class="ak-chips">${order.map((k) => `<button class="ak-chip${state.status.has(k) ? " on" : ""}" data-status="${k}"><i class="ak-dot ak-st-${k}"></i>${esc(statusLabel(k))}</button>`).join("")}</div>
<span class="ak-label">Links</span><div class="ak-chips">${EDGE_TYPES.map((t) => `<button class="ak-chip${state.types.has(t) ? " on" : ""}" data-type="${t}">${esc(S.site.relations[t]?.label ?? t)}</button>`).join("")}</div>
${S.site.docs.length ? `<div class="ak-chips"><button class="ak-chip${state.docs ? " on" : ""}" data-docs>docs</button></div>` : ""}
${tags.length ? `<span class="ak-label">Tag</span><div class="ak-chips">${(state.allTags ? tags : tags.slice(0, 10).concat(tags.filter(([t]) => t === state.tag && tags.indexOf(tags.find((x) => x[0] === t)) >= 10))).map(([t]) => `<button class="ak-chip ak-chip--tag${state.tag === t ? " on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}${tags.length > 10 ? `<button class="ak-chip" data-more>${state.allTags ? "less" : `+${tags.length - 10} more`}</button>` : ""}</div>` : ""}`;
  }

  function build() {
    const items = [...S.site.adrs, ...(state.docs ? S.site.docs : [])].filter((a) => a.kind === "doc" || state.status.has(a.statusKey));
    const ids = new Set(items.map((a) => a.id));
    edges = S.site.edges.filter((e) => state.types.has(e.type) && ids.has(e.from) && ids.has(e.to));
    const deg = new Map();
    for (const e of edges) for (const k of [e.from, e.to]) deg.set(k, (deg.get(k) ?? 0) + 1);
    nodes = items.map((a, i) => {
      const p = pos.get(a.id) ?? { x: W / 2 + Math.cos(i * 2.4) * (60 + i * 9), y: H / 2 + Math.sin(i * 2.4) * (60 + i * 7), vx: 0, vy: 0 };
      pos.set(a.id, p);
      return Object.assign(p, { id: a.id, a, r: 8 + Math.min(14, Math.sqrt(deg.get(a.id) ?? 0) * 3.2) });
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    edges = edges.map((e) => ({ ...e, s: byId.get(e.from), t: byId.get(e.to) }));
    draw();
    heat(0.9);
  }

  function draw() {
    gEdges.replaceChildren();
    gNodes.replaceChildren();
    for (const e of edges) {
      e.el = svgEl("line", { class: `g-edge t-${e.type}`, "marker-end": e.type === "relates" || e.type === "mentions" ? null : `url(#ga-${e.type})` }, gEdges);
    }
    for (const n of nodes) {
      const g = svgEl("g", { class: `g-node ak-st-${n.a.statusKey}${n.a.kind === "doc" ? " doc" : ""}`, tabindex: 0, "data-id": n.id }, gNodes);
      svgEl("circle", { r: n.r }, g);
      const t1 = svgEl("text", { y: n.r + 13, "text-anchor": "middle" }, g);
      t1.textContent = n.a.kind === "adr" ? n.a.id : "doc";
      const t2 = svgEl("text", { y: n.r + 26, "text-anchor": "middle", class: "t" }, g);
      t2.textContent = wrapText(n.a.title, 26)[0] + (n.a.title.length > 26 ? "…" : "");
      n.el = g;
    }
    paintHighlight();
    paintHistory();
    tick(true);
  }

  function heat(a = 0.6) {
    alpha = Math.max(alpha, a);
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function loop() {
    raf = 0;
    for (let i = 0; i < 2; i++) step();
    tick();
    alpha *= 0.975;
    if (alpha > 0.02) raf = requestAnimationFrame(loop);
  }
  function step() {
    const k = alpha;
    // repulsion
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 360000) continue;
        const f = (9000 * k) / d2;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
      }
    }
    // springs
    for (const e of edges) {
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = e.type === "mentions" ? 210 : 150;
      const f = ((d - rest) / d) * (e.type === "mentions" ? 0.025 : 0.05) * k;
      e.s.vx += dx * f; e.s.vy += dy * f; e.t.vx -= dx * f; e.t.vy -= dy * f;
    }
    // gravity to center, plus tag clustering when a tag is chosen
    for (const n of nodes) {
      const tagged = state.tag && n.a.tags.includes(state.tag);
      const cx = tagged ? W * 0.5 : W / 2, cy = H / 2;
      n.vx += (cx - n.x) * (tagged ? 0.02 : 0.006) * k;
      n.vy += (cy - n.y) * (tagged ? 0.02 : 0.006) * k;
      if (n.fixed) { n.vx = n.vy = 0; continue; }
      n.x += n.vx *= 0.6;
      n.y += n.vy *= 0.6;
    }
  }
  function tick() {
    for (const e of edges) {
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      e.el.setAttribute("x1", e.s.x + (dx / d) * e.s.r);
      e.el.setAttribute("y1", e.s.y + (dy / d) * e.s.r);
      e.el.setAttribute("x2", e.t.x - (dx / d) * (e.t.r + 3));
      e.el.setAttribute("y2", e.t.y - (dy / d) * (e.t.r + 3));
    }
    for (const n of nodes) n.el.setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
  }

  function paintHighlight(hover) {
    const focus = hover ?? selected;
    const near = new Set(focus ? [focus] : []);
    if (focus) for (const e of edges) if (e.from === focus || e.to === focus) { near.add(e.from); near.add(e.to); }
    for (const n of nodes) {
      const tagMiss = state.tag && !n.a.tags.includes(state.tag);
      n.el.classList.toggle("dim", (focus && !near.has(n.id)) || (!focus && tagMiss));
      n.el.classList.toggle("hot", n.id === selected);
      n.el.classList.toggle("near", !!focus && near.has(n.id));
    }
    for (const e of edges) {
      const on = focus && (e.from === focus || e.to === focus);
      e.el.classList.toggle("hot", !!on);
      e.el.classList.toggle("dim", !!focus && !on);
    }
  }

  function detail() {
    const body = $("#g-detail-body");
    const a = selected && S.byId.get(selected);
    if (!a) {
      const counts = statusOrder().map((k) => [k, S.site.adrs.filter((x) => x.statusKey === k).length]).filter(([, n]) => n);
      body.innerHTML = `<p class="muted" style="margin-top:0">Select a node to see its decision and links. Node size = number of links.</p><dl class="ak-glance">${counts.map(([k, n]) => `<div><dt><i class="ak-dot ak-st-${k}"></i> ${esc(statusLabel(k))}</dt><dd>${n}</dd></div>`).join("")}</dl>`;
      return;
    }
    const g = gist(a);
    const os = optionStats(a);
    const nbrs = [...new Map((S.adj.get(a.id) ?? []).map((n) => [n.id, S.byId.get(n.id)])).values()].filter(Boolean);
    body.innerHTML = `<div class="kind">${esc(label(a))}</div><h3>${esc(a.title)}</h3><div style="margin-bottom:10px">${pill(a)}</div>
${g.text ? `<div class="ak-hero ak-hero--${g.kind === "decision" ? "decision" : g.kind === "question" ? "question" : "rec"} ak-st-${a.statusKey}" style="padding:10px 12px"><div class="ak-hero-label">${esc(g.kind)}</div><div class="ak-hero-text" style="font-size:14px">${esc(g.text)}</div></div>` : ""}
${os.items.length ? `<p style="font-size:13px;margin:10px 0 0"><b style="color:var(--ak-green)">${os.ok.length} chosen</b> · ${os.warn.length} possible · ${os.no.length} rejected</p>` : ""}
${a.tags.length ? `<div class="ak-chips" style="margin-top:10px">${a.tags.map((t) => tagChip(t)).join("")}</div>` : ""}
${nbrs.length ? `<div class="ak-chips" style="margin-top:10px">${nbrs.map(refChip).join("")}</div>` : ""}
<p style="margin:14px 0 0"><a class="ak-btn" href="${href(a)}">Open ${esc(label(a))} →</a></p>`;
  }

  function fit() {
    if (!nodes.length) return;
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const pad = 70;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const r = svg.clientWidth / Math.max(1, svg.clientHeight);
    let w = x1 - x0, h = y1 - y0;
    if (w / h > r) h = w / r; else w = h * r;
    view = { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
    setView();
  }

  // ── interaction ──
  const toSvg = (ev) => {
    const r = svg.getBoundingClientRect();
    return { x: view.x + ((ev.clientX - r.left) / r.width) * view.w, y: view.y + ((ev.clientY - r.top) / r.height) * view.h };
  };
  let drag = null;
  svg.addEventListener("pointerdown", (ev) => {
    const g = ev.target.closest(".g-node");
    svg.setPointerCapture(ev.pointerId);
    if (g) {
      const n = nodes.find((x) => x.id === g.dataset.id);
      drag = { n, moved: false };
      n.fixed = true;
    } else drag = { pan: true, sx: ev.clientX, sy: ev.clientY, v: { ...view }, moved: false };
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!drag) {
      const g = ev.target.closest(".g-node");
      paintHighlight(g?.dataset.id ?? undefined);
      return;
    }
    drag.moved = true;
    if (drag.n) {
      const p = toSvg(ev);
      drag.n.x = p.x; drag.n.y = p.y;
      heat(0.3);
      tick();
    } else {
      const r = svg.getBoundingClientRect();
      view.x = drag.v.x - ((ev.clientX - drag.sx) / r.width) * view.w;
      view.y = drag.v.y - ((ev.clientY - drag.sy) / r.height) * view.h;
      setView();
    }
  });
  svg.addEventListener("pointerup", (ev) => {
    if (drag?.n) {
      drag.n.fixed = false;
      if (!drag.moved) select(drag.n.id);
    } else if (drag && !drag.moved) select(null);
    drag = null;
  });
  svg.addEventListener("dblclick", (ev) => {
    const g = ev.target.closest(".g-node");
    if (g) location.hash = href(S.byId.get(g.dataset.id)).slice(1);
  });
  svg.addEventListener("keydown", (ev) => {
    const g = ev.target.closest(".g-node");
    if (g && ev.key === "Enter") location.hash = href(S.byId.get(g.dataset.id)).slice(1);
  });
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const p = toSvg(ev);
    const f = Math.exp(ev.deltaY * 0.0015);
    view = { x: p.x - (p.x - view.x) * f, y: p.y - (p.y - view.y) * f, w: view.w * f, h: view.h * f };
    setView();
  }, { passive: false });
  svg.addEventListener("pointerleave", () => !drag && paintHighlight());

  function select(id) {
    selected = id;
    paintHighlight();
    detail();
  }

  $("#g-filters").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.status) state.status.has(b.dataset.status) ? state.status.delete(b.dataset.status) : state.status.add(b.dataset.status);
    else if (b.dataset.type) state.types.has(b.dataset.type) ? state.types.delete(b.dataset.type) : state.types.add(b.dataset.type);
    else if ("docs" in b.dataset) state.docs = !state.docs;
    else if ("more" in b.dataset) { state.allTags = !state.allTags; filters(); return; }
    else if (b.dataset.tag != null) state.tag = state.tag === b.dataset.tag ? "" : b.dataset.tag;
    filters();
    build();
  });
  $("#g-fit").addEventListener("click", fit);
  $("#g-shake").addEventListener("click", () => {
    for (const n of nodes) { n.x = W / 2 + (Math.random() - 0.5) * 500; n.y = H / 2 + (Math.random() - 0.5) * 400; }
    heat(1);
  });

  filters();
  build();
  // settle quickly off-screen, then animate the rest
  for (let i = 0; i < 400; i++) { step(); alpha *= 0.99; }
  tick();
  fit();
  detail();
  return () => cancelAnimationFrame(raf);
}
