// Shared canvas parts: a pan/zoom viewer for any SVG, and the IDE shell (left pane | canvas | right pane)
// with draggable splitters whose widths are remembered.

// ── pan / zoom ───────────────────────────────────────────
// Attach to a host that has a size and holds one <svg width height>. Wheel or two-finger scroll
// pans, ctrl/⌘ + wheel or a pinch zooms around the pointer, dragging the background pans.
// fit: "contain" shows the whole drawing; "width" fits the width and starts at the top.
export function panZoom(host, svg, { w, h, fit = "contain", fitMax, max = 4, min = 0.1, onChange, controls = true } = {}) {
  w ??= Number(svg.getAttribute("width")) || svg.viewBox.baseVal.width;
  h ??= Number(svg.getAttribute("height")) || svg.viewBox.baseVal.height;
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  svg.style.cssText += ";display:block;max-width:none;touch-action:none;user-select:none";
  host.classList.add("pz-host");
  let k = 1, vx = 0, vy = 0, user = false;
  const size = () => ({ W: host.clientWidth || 800, H: host.clientHeight || 520 });
  const apply = () => {
    const { W, H } = size();
    svg.setAttribute("viewBox", `${vx.toFixed(1)} ${vy.toFixed(1)} ${(W / k).toFixed(1)} ${(H / k).toFixed(1)}`);
    if (lvl) lvl.textContent = `${Math.round(k * 100)}%`;
    onChange?.({ k, vx, vy });
  };
  const doFit = () => {
    const { W, H } = size();
    const pad = 24;
    k = fit === "width" ? Math.min(fitMax ?? 1, (W - 2 * pad) / w) : Math.min(fitMax ?? 1.1, (W - 2 * pad) / w, (H - 2 * pad) / h);
    k = Math.max(min, k);
    vx = -(W / k - w) / 2;
    vy = fit === "width" ? -pad / k : -(H / k - h) / 2;
    if (fit === "width" && W / k < w) vx = -pad / k;
    user = false;
    apply();
  };
  const zoomAt = (f, px, py) => {
    const { W, H } = size();
    const nk = Math.min(max, Math.max(min, k * f));
    // keep the content point under (px, py) fixed
    const cx = vx + (px ?? W / 2) / k, cy = vy + (py ?? H / 2) / k;
    k = nk;
    vx = cx - (px ?? W / 2) / k;
    vy = cy - (py ?? H / 2) / k;
    user = true;
    apply();
  };
  const at = (ev) => { const r = host.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  host.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? host.clientHeight : 1;
    if (ev.ctrlKey || ev.metaKey) {
      const [px, py] = at(ev);
      zoomAt(Math.exp(-ev.deltaY * unit * 0.0025), px, py);
    } else {
      vx += (ev.deltaX * unit) / k;
      vy += (ev.deltaY * unit) / k;
      user = true;
      apply();
    }
  }, { passive: false });
  const pointers = new Map();
  let drag = null;
  host.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest?.(".pz-ctl")) return;
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    pointers.set(ev.pointerId, at(ev));
    host.dataset.dragged = "";
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = { pinch: true, d0: Math.hypot(a[0] - b[0], a[1] - b[1]), k0: k, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], moved: true };
      return;
    }
    const [px, py] = at(ev);
    drag = { px, py, vx0: vx, vy0: vy, moved: false };
  });
  host.addEventListener("pointermove", (ev) => {
    if (!pointers.has(ev.pointerId) || !drag) return;
    pointers.set(ev.pointerId, at(ev));
    if (drag.pinch) {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const f = Math.hypot(a[0] - b[0], a[1] - b[1]) / drag.d0;
      const target = drag.k0 * f;
      return zoomAt(target / k, drag.mid[0], drag.mid[1]);
    }
    const [px, py] = at(ev);
    const dx = px - drag.px, dy = py - drag.py;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      host.setPointerCapture(ev.pointerId);
      host.classList.add("is-panning");
    }
    vx = drag.vx0 - dx / k;
    vy = drag.vy0 - dy / k;
    user = true;
    apply();
  });
  const release = (ev) => {
    pointers.delete(ev.pointerId);
    if (!drag || (drag.pinch && pointers.size)) return;
    if (drag.moved) host.dataset.dragged = "1"; // a drag is not a click
    host.classList.remove("is-panning");
    drag = null;
  };
  host.addEventListener("pointerup", release);
  host.addEventListener("pointercancel", release);
  host.addEventListener("click", (ev) => { if (host.dataset.dragged) { ev.preventDefault(); ev.stopPropagation(); host.dataset.dragged = ""; } }, true);

  let lvl = null;
  if (controls) {
    const bar = document.createElement("div");
    bar.className = "pz-ctl";
    bar.innerHTML = `<button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="fit" class="pz-lvl" aria-label="Fit">100%</button><button type="button" data-z="in" aria-label="Zoom in">+</button>`;
    host.append(bar);
    lvl = bar.querySelector(".pz-lvl");
    bar.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-z]");
      if (!b) return;
      if (b.dataset.z === "fit") doFit();
      else zoomAt(b.dataset.z === "in" ? 1.25 : 0.8);
    });
  }
  const ro = new ResizeObserver(() => { if (user) apply(); else doFit(); });
  ro.observe(host);
  doFit();
  // bring a content rectangle into view (centered), keeping the zoom
  const reveal = (x, y, bw, bh) => {
    const { W, H } = size();
    vx = x + bw / 2 - W / k / 2;
    vy = y + bh / 2 - H / k / 2;
    user = true;
    apply();
  };
  return { fit: doFit, zoom: (f) => zoomAt(f), reveal, destroy: () => ro.disconnect() };
}

// ── IDE shell ────────────────────────────────────────────
// Markup: <div class="ide" data-ide="key"> <aside class="ide-pane ide-left">…</aside> <div class="ide-split" data-side="l">
// <section class="ide-center">…</section> <div class="ide-split" data-side="r"> <aside class="ide-pane ide-right">…</aside> </div>
// Buttons with data-ide-toggle="l" | "r" show or hide a pane. Widths and visibility are remembered per key.
export function bindIde(root) {
  const ide = root.querySelector(".ide");
  if (!ide) return () => {};
  const key = `crux-ide:${ide.dataset.ide}`;
  let st = {};
  try { st = JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { st = {}; }
  const save = () => { try { localStorage.setItem(key, JSON.stringify(st)); } catch { /* per visit only */ } };
  const narrow = () => innerWidth < 900;
  const paint = () => {
    for (const side of ["l", "r"]) {
      const off = st[`${side}Off`] ?? (narrow() && side !== "l" ? true : narrow());
      ide.classList.toggle(`${side}-off`, !!off);
      if (st[side]) ide.style.setProperty(`--${side}`, `${st[side]}px`);
      for (const b of root.querySelectorAll(`[data-ide-toggle="${side}"]`)) b.setAttribute("aria-pressed", String(!off));
    }
  };
  paint();
  const onClick = (ev) => {
    const b = ev.target.closest("[data-ide-toggle]");
    if (!b || !root.contains(b)) return;
    const side = b.dataset.ideToggle;
    st[`${side}Off`] = !ide.classList.contains(`${side}-off`);
    save();
    paint();
    window.dispatchEvent(new Event("resize"));
  };
  root.addEventListener("click", onClick);
  const onDown = (ev) => {
    const sp = ev.target.closest(".ide-split");
    if (!sp || !ide.contains(sp)) return;
    ev.preventDefault();
    const side = sp.dataset.side;
    const pane = ide.querySelector(side === "l" ? ".ide-left" : ".ide-right");
    const x0 = ev.clientX, w0 = pane.getBoundingClientRect().width;
    sp.classList.add("is-drag");
    document.body.classList.add("ide-resizing");
    const move = (e) => {
      const d = e.clientX - x0;
      st[side] = Math.round(Math.min(640, Math.max(180, w0 + (side === "l" ? d : -d))));
      ide.style.setProperty(`--${side}`, `${st[side]}px`);
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      sp.classList.remove("is-drag");
      document.body.classList.remove("ide-resizing");
      save();
      window.dispatchEvent(new Event("resize"));
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  root.addEventListener("pointerdown", onDown);
  return () => { root.removeEventListener("click", onClick); root.removeEventListener("pointerdown", onDown); };
}
