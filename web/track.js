// Track: animated flow scenes. One primitive for any flow — services, states, keys, people.
//
//   stations:                       a grid map; each word is a station, "." is empty
//     pos  session  parser  dispatcher
//     .    .        domain  .
//   station pos "POS terminal" kind=actor sub="PEP-ISO"
//   token: 0200 purchase            the thing that travels
//   state: status=new, rows=0       what the inspector shows; beats change it
//   scenario ok "Approved"          a scenario is a filter over beats (by tag)
//   scenario timeout "No answer"
//   == Phase ==                     stage pills; click to jump
//   pos -> session : tcp 0200       sync hop     ~> or --> async     <-> round trip
//   [timeout] at shp: no answer | fail, status=unknown
//   [!timeout] shp -> disp : 0210 | ok        "!" excludes a scenario
//   note: narration for the beat above
//   wait 15m : settlement job tick
//   par … end   loop 3 "retry" … end   when a,b … end
//
// parseTrack(text) → model; mountTrack(el, model) → player. No dependencies.

const DUR = { hop: 1050, rt: 1350, at: 1000, wait: 1400, gap: 260 };
const KINDS = ["actor", "service", "store", "queue", "external", "hsm", "job", "state", "key", "gate", "hub", "terminal"];

// ── parse ─────────────────────────────────────────────────────────────
const attrRe = /([\w.-]+)=("([^"]*)"|'([^']*)'|\S+)/g;
const hopRe = /^(?:([\w.-]+):\s+)?([\w.-]+)\s*(<~>|<->|~>|-->|->|=>)\s*([\w.-]+)\s*(?::\s*(.*))?$/;

function attrs(s) {
  const out = {};
  for (const m of String(s ?? "").matchAll(attrRe)) out[m[1]] = m[3] ?? m[4] ?? m[2];
  return out;
}

function splitOps(s) {
  const i = s.search(/\s\|\s|\s\|$/);
  return i < 0 ? [s.trim(), ""] : [s.slice(0, i).trim(), s.slice(i + 2).trim()];
}

// "ok | status=unknown, rows+=1 | token \"0210\"" → [{op}]
function parseOps(s) {
  const ops = [];
  // split on | and on commas that sit outside quotes
  const parts = [];
  let cur = "", q = false;
  for (const ch of String(s ?? "")) {
    if (ch === '"') q = !q;
    if (!q && (ch === "|" || ch === ",")) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  for (let part of parts) {
    part = part.trim();
    if (!part) continue;
    if (/^(ok|fail|warn)$/i.test(part)) { ops.push({ op: "status", v: part.toLowerCase() }); continue; }
    const tok = part.match(/^token\s*[:=]?\s*"?(.+?)"?$/i);
    if (tok && !/^token\s*(\+=|-=)/.test(part)) { ops.push({ op: "token", v: tok[1] }); continue; }
    const m = part.match(/^([\w.-]+)\s*(\+=|-=|=)\s*(.*)$/);
    if (m) ops.push({ op: m[2], k: m[1], v: m[3].replace(/^"(.*)"$/, "$1") });
  }
  return ops;
}

function parseTags(s) {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export function parseTrack(text) {
  const m = { title: "", token: "packet", state: {}, grid: [], stations: new Map(), scenarios: [], phases: [], beats: [], errors: [], cell: { w: 150, h: 112 } };
  const lines = String(text ?? "").replace(/\t/g, "  ").split("\n");
  const stack = [{ kind: "root", beats: m.beats, tags: [] }];
  const top = () => stack[stack.length - 1];
  let phase = "";
  let last = null;
  const err = (n, msg) => m.errors.push({ line: n + 1, msg });

  for (let n = 0; n < lines.length; n++) {
    let t = lines[n].trim();
    if (!t || t.startsWith("//") || /^#(\s|$)/.test(t)) continue;

    if (/^stations\s*:\s*$/i.test(t)) {
      while (n + 1 < lines.length && /^\s+\S/.test(lines[n + 1])) {
        n++;
        const row = lines[n].trim();
        if (row.startsWith("//")) continue;
        m.grid.push(row.split(/\s+/).map((c) => (c === "." || c === "-" ? null : c)));
      }
      continue;
    }
    let mm;
    if ((mm = t.match(/^title\s*:\s*(.+)$/i))) { m.title = mm[1]; continue; }
    if ((mm = t.match(/^token\s*:\s*(.+)$/i))) { m.token = mm[1]; continue; }
    if ((mm = t.match(/^cell\s*:\s*(\d+)\s*x\s*(\d+)$/i))) { m.cell = { w: +mm[1], h: +mm[2] }; continue; }
    if ((mm = t.match(/^state\s*:\s*(.+)$/i))) {
      for (const o of parseOps(mm[1])) if (o.op === "=") m.state[o.k] = o.v;
      continue;
    }
    if ((mm = t.match(/^station\s+([\w.-]+)\s*(?:=\s*([\w.-]+))?\s*(?:"([^"]*)")?\s*(.*)$/i))) {
      const a = attrs(mm[4]);
      const s = m.stations.get(mm[1]) ?? { id: mm[1] };
      Object.assign(s, { elId: mm[2] ?? a.el ?? s.elId, label: mm[3] ?? s.label ?? mm[1], labelSet: !!mm[3] || s.labelSet, kind: a.kind ?? s.kind ?? "service", kindSet: !!a.kind || s.kindSet, sub: a.sub ?? s.sub ?? "" });
      if (a.kind && !KINDS.includes(a.kind)) err(n, `unknown station kind "${a.kind}" (${KINDS.join(", ")})`);
      m.stations.set(mm[1], s);
      continue;
    }
    if ((mm = t.match(/^scenario\s+([\w.-]+)\s*(?:"([^"]*)")?\s*(.*)$/i))) {
      const [rest, ops] = splitOps(mm[3]);
      const a = attrs(rest);
      m.scenarios.push({ id: mm[1], label: mm[2] ?? mm[1], tags: new Set([mm[1], ...parseTags(a.tags ?? "")]), ops: parseOps(ops), outcome: a.outcome ?? "", tone: a.tone ?? "" });
      continue;
    }
    if ((mm = t.match(/^==\s*(.+?)\s*(?:==)?$/))) {
      phase = mm[1];
      if (!m.phases.includes(phase)) m.phases.push(phase);
      continue;
    }
    if ((mm = t.match(/^(?:note|>)\s*:?\s*(.+)$/i)) && (/^note\b/i.test(t) || t.startsWith(">"))) {
      if (last) last.notes.push(mm[1]);
      else err(n, "note before any beat");
      continue;
    }
    if (/^end$/i.test(t)) {
      if (stack.length > 1) stack.pop();
      else err(n, "end without a block");
      continue;
    }

    // tags prefix
    let tags = [];
    if ((mm = t.match(/^\[([^\]]*)\]\s*(.*)$/))) { tags = parseTags(mm[1]); t = mm[2]; }
    const blockTags = stack.flatMap((s) => s.tags ?? []);
    const allTags = [...blockTags, ...tags];

    if ((mm = t.match(/^when\s+(.+)$/i))) {
      stack.push({ kind: "when", beats: top().beats, tags: [...tags, ...parseTags(mm[1])] });
      continue;
    }
    if (/^par$/i.test(t)) {
      const b = { kind: "par", beats: [], tags: allTags, phase, notes: [], ops: [], line: n + 1 };
      top().beats.push(b);
      stack.push({ kind: "par", beats: b.beats, tags: [] });
      last = b;
      continue;
    }
    if ((mm = t.match(/^loop\s+(\d+)\s*(?:"([^"]*)")?\s*$/i))) {
      const b = { kind: "loop", n: +mm[1], label: mm[2] ?? "", beats: [], tags: allTags, phase, notes: [], ops: [], line: n + 1 };
      top().beats.push(b);
      stack.push({ kind: "loop", beats: b.beats, tags: [] });
      last = b;
      continue;
    }

    const [body, opsText] = splitOps(t);
    const ops = parseOps(opsText);
    let b = null;
    if ((mm = body.match(/^at\s+([\w.-]+)\s*:\s*(.*)$/i))) b = { kind: "at", from: mm[1], to: mm[1], label: mm[2] };
    else if ((mm = body.match(/^wait\s+(\S+)\s*(?::\s*(.*))?$/i))) b = { kind: "wait", dur: mm[1], label: mm[2] ?? "" };
    else if ((mm = body.match(hopRe))) {
      const arrow = mm[3];
      b = { kind: arrow.includes("<") ? "rt" : "hop", id: mm[1] ?? "", from: mm[2], to: mm[4], async: arrow === "~>" || arrow === "-->" || arrow === "<~>", label: mm[5] ?? "" };
    }
    if (!b) { err(n, `cannot read "${t}"`); continue; }
    Object.assign(b, { tags: allTags, phase, notes: [], ops, line: n + 1 });
    b.status = ops.find((o) => o.op === "status")?.v ?? "";
    top().beats.push(b);
    last = b;
  }
  if (stack.length > 1) err(lines.length - 1, `missing "end" for ${top().kind}`);

  // stations: from the grid, then any used in beats but not placed (appended on a new row)
  const placed = new Set();
  m.grid.forEach((row, r) => row.forEach((id, c) => {
    if (!id) return;
    const s = m.stations.get(id) ?? { id, label: id, kind: "service", sub: "" };
    Object.assign(s, { col: c, row: r });
    m.stations.set(id, s);
    placed.add(id);
  }));
  const used = [];
  const walk = (bs) => bs.forEach((b) => { if (b.beats) walk(b.beats); for (const x of [b.from, b.to]) if (x && !used.includes(x)) used.push(x); });
  walk(m.beats);
  const extra = used.filter((id) => !placed.has(id));
  if (extra.length) {
    const r = m.grid.length;
    m.grid.push(extra);
    extra.forEach((id, c) => {
      const s = m.stations.get(id) ?? { id, label: id, kind: "service", sub: "" };
      Object.assign(s, { col: c, row: r });
      m.stations.set(id, s);
    });
  }
  for (const s of m.stations.values()) if (s.col == null) m.errors.push({ line: 0, msg: `station "${s.id}" is declared but not on the stations grid` });
  if (!m.scenarios.length) m.scenarios.push({ id: "main", label: m.title || "Flow", tags: new Set(), ops: [], outcome: "", tone: "" });
  return m;
}

// Beats of one scenario as frames: each frame plays its acts together.
export function framesOf(m, scen) {
  const inc = (b) => {
    const pos = b.tags.filter((t) => !t.startsWith("!"));
    const neg = b.tags.filter((t) => t.startsWith("!")).map((t) => t.slice(1));
    return (!pos.length || pos.some((t) => scen.tags.has(t))) && !neg.some((t) => scen.tags.has(t));
  };
  const out = [];
  const walk = (beats, round) => {
    for (const b of beats) {
      if (!inc(b)) continue;
      if (b.kind === "par") { const acts = b.beats.filter(inc); if (acts.length) out.push({ acts, phase: b.phase, round, par: true, notes: b.notes }); }
      else if (b.kind === "loop") for (let k = 1; k <= b.n; k++) walk(b.beats, { k, n: b.n, label: b.label });
      else out.push({ acts: [b], phase: b.phase, round, notes: b.notes });
    }
  };
  walk(m.beats, null);
  return out;
}

// ── geometry ──────────────────────────────────────────────────────────
// Stations are crux element boxes (the ego-map look); rails run centre to centre under them.
const PAD = { x: 18, top: 34, bottom: 44 };
const BOX = { h: 40 };
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const f1 = (n) => Math.round(n * 10) / 10;
const boxW = (m) => Math.min(m.cell.w - 20, 150);

function pos(m, id) {
  const s = m.stations.get(id);
  return { x: PAD.x + s.col * m.cell.w + m.cell.w / 2, y: PAD.top + s.row * m.cell.h + BOX.h / 2 };
}

// Straight when nothing sits between, an arc over the row when a station would be crossed,
// an S-curve across rows and columns.
function railPath(m, a, b, occupied) {
  const A = pos(m, a), B = pos(m, b);
  const sa = m.stations.get(a), sb = m.stations.get(b);
  if (sa.row === sb.row || sa.col === sb.col) {
    const row = sa.row === sb.row;
    const lo = row ? Math.min(sa.col, sb.col) : Math.min(sa.row, sb.row), hi = row ? Math.max(sa.col, sb.col) : Math.max(sa.row, sb.row);
    let between = 0;
    for (let i = lo + 1; i < hi; i++) if (occupied.has(row ? `${i},${sa.row}` : `${sa.col},${i}`)) between++;
    if (!between) return `M${f1(A.x)} ${f1(A.y)} L${f1(B.x)} ${f1(B.y)}`;
    if (row) {
      const h = Math.min(m.cell.h * 0.55, 34 + (hi - lo) * 6);
      const y = Math.min(A.y, B.y) - BOX.h / 2;
      return `M${f1(A.x)} ${f1(A.y)} L${f1(A.x)} ${f1(y)} C${f1(A.x)} ${f1(y - h)} ${f1(B.x)} ${f1(y - h)} ${f1(B.x)} ${f1(y)} L${f1(B.x)} ${f1(B.y)}`;
    }
    const w = boxW(m) / 2 + 26;
    return `M${f1(A.x)} ${f1(A.y)} C${f1(A.x + w * 1.6)} ${f1(A.y)} ${f1(B.x + w * 1.6)} ${f1(B.y)} ${f1(B.x)} ${f1(B.y)}`;
  }
  const dx = B.x - A.x, dy = B.y - A.y;
  if (Math.abs(dx) >= Math.abs(dy) * 0.9) {
    const mx = A.x + dx / 2;
    return `M${f1(A.x)} ${f1(A.y)} C${f1(mx)} ${f1(A.y)} ${f1(mx)} ${f1(B.y)} ${f1(B.x)} ${f1(B.y)}`;
  }
  const my = A.y + dy / 2;
  return `M${f1(A.x)} ${f1(A.y)} C${f1(A.x)} ${f1(my)} ${f1(B.x)} ${f1(my)} ${f1(B.x)} ${f1(B.y)}`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const textW = (s, size = 11) => [...String(s)].length * size * 0.61;
function clip(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

const KIND_TAG = { actor: "ACTOR", service: "SERVICE", store: "STORE", queue: "QUEUE", external: "EXTERNAL", hsm: "HSM", job: "JOB", state: "STATE", key: "KEY", gate: "GATE", hub: "HUB", terminal: "END" };
// small 24×24 glyphs for stations that are not crux elements
const GLYPH = {
  key: "M7 14a5 5 0 1 1 4.6-7H22v4h-2v3h-3v-3h-5.4A5 5 0 0 1 7 14zm0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  hsm: "M6 10V7a6 6 0 1 1 12 0v3h1v12H5V10h1zm3 0h6V7a3 3 0 1 0-6 0v3zm2 4v4h2v-4h-2z",
  state: "M4 7h16v10H4z",
  job: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 5v6l5 3 1-1.7-4-2.3V7h-2z",
  gate: "M12 2l10 10-10 10L2 12z",
};

// ── views ─────────────────────────────────────────────────────────────
function nodeSvg(m, s, x, y, w, h, small = false) {
  const el = s.el;
  const kind = s.kind;
  const icon = el?.icon ?? GLYPH[kind] ?? null;
  const tag = (el?.tag ?? KIND_TAG[kind] ?? kind).toUpperCase();
  const label = s.label;
  const cls = `tk-node k-${esc(kind)}${el?.techClass ? ` ${esc(el.techClass)}` : ""}${el?.inferred ? " is-inferred" : ""}`;
  const inner = `<rect class="box" x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}"/>${icon ? `<svg x="${f1(x + w - 17)}" y="${f1(y + 5)}" width="11" height="11" viewBox="0 0 24 24"><path class="ic" d="${icon}"/></svg>` : ""}<text class="tag" x="${f1(x + 7)}" y="${f1(y + 12.5)}">${esc(clip(tag, Math.floor((w - 24) / 5.6)))}</text><text class="label" x="${f1(x + 7)}" y="${f1(y + (small ? 27 : 29))}">${esc(clip(label, Math.floor((w - 12) / 7.4)))}</text>`;
  const g = `<g class="${cls}">${inner}</g>`;
  return el?.href ? `<a href="${esc(el.href)}">${g}</a>` : g;
}

// Map: stations on the grid, rails between them, a token that rides the rails.
function metroView(m, scenFrames) {
  const cols = Math.max(1, ...m.grid.map((r) => r.length));
  const W = PAD.x * 2 + cols * m.cell.w, H = PAD.top + (m.grid.length - 1) * m.cell.h + BOX.h + PAD.bottom + 26;
  const occupied = new Set([...m.stations.values()].filter((s) => s.col != null).map((s) => `${s.col},${s.row}`));
  const rails = new Map();
  for (const [sid, frames] of scenFrames) for (const fr of frames) for (const a of fr.acts) {
    if (a.kind !== "hop" && a.kind !== "rt") continue;
    if (!m.stations.get(a.from) || !m.stations.get(a.to) || a.from === a.to) continue;
    const k = key(a.from, a.to);
    if (!rails.has(k)) rails.set(k, { k, a: a.from < a.to ? a.from : a.to, b: a.from < a.to ? a.to : a.from, async: false, scen: new Set() });
    if (a.async) rails.get(k).async = true;
    rails.get(k).scen.add(sid);
  }
  for (const r of rails.values()) r.d = railPath(m, r.a, r.b, occupied);
  const railSvg = [...rails.values()].map((r) => `<g class="tk-rail ${r.async ? "m-async" : "m-sync"}" data-rail="${esc(r.k)}" data-scen="${esc([...r.scen].join(" "))}"><path class="bed" d="${r.d}"/><path class="run" d="${r.d}"/></g>`).join("");
  const w = boxW(m);
  const st = [...m.stations.values()].filter((s) => s.col != null).map((s) => {
    const p = pos(m, s.id);
    return `<g class="tk-st" data-st="${esc(s.id)}"><title>${esc(s.label)}${s.sub ? ` — ${esc(s.sub)}` : ""}</title><rect class="tk-halo" x="${f1(p.x - w / 2 - 5)}" y="${f1(p.y - BOX.h / 2 - 5)}" width="${f1(w + 10)}" height="${BOX.h + 10}"/>${nodeSvg(m, s, p.x - w / 2, p.y - BOX.h / 2, w, BOX.h)}${s.sub ? `<text class="tk-sub" x="${f1(p.x)}" y="${f1(p.y + BOX.h / 2 + 13)}">${esc(clip(s.sub, Math.floor((m.cell.w - 14) / 6.3)))}</text>` : ""}<g class="tk-badge" transform="translate(${f1(p.x)} ${f1(p.y + BOX.h / 2 + (s.sub ? 31 : 19))})"><rect y="-12" height="17"/><text y="0"></text></g></g>`;
  }).join("");
  const svg = `<svg class="tk-svg" viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img"><g class="tk-rails">${railSvg}</g><g class="tk-stations">${st}</g><g class="tk-tokens"></g><rect class="tk-wait" x="0" y="0" width="${W}" height="${H}"/><text class="tk-waittext" x="${W / 2}" y="${H / 2}"></text></svg>`;
  return {
    svg, W, H,
    path(svgEl, a) {
      const k = key(a.from, a.to);
      const p = svgEl.querySelector(`[data-rail="${CSS.escape(k)}"] .bed`);
      return p ? { el: p, rev: a.from !== rails.get(k).a } : null;
    },
    railOf: (a) => key(a.from, a.to),
    at: (id) => (m.stations.get(id)?.col != null ? pos(m, id) : null),
  };
}

// Lanes: the same beats as a sequence diagram — one lifeline per station, one row per act.
function lanesView(m, frames) {
  const ids = [];
  for (const fr of frames) for (const a of fr.acts) for (const x of [a.from, a.to]) if (x && !ids.includes(x)) ids.push(x);
  const order = ids.map((id) => m.stations.get(id)).filter(Boolean);
  const LW = Math.max(112, Math.min(150, 1080 / Math.max(1, order.length))), TOP = 62, RH = 30, LEFT = 14;
  const x = new Map(order.map((s, i) => [s.id, LEFT + i * LW + LW / 2]));
  const W = LEFT * 2 + order.length * LW;
  const rows = [];
  let y = TOP + 18, phase = "";
  const rowOf = [];
  frames.forEach((fr, fi) => {
    if (fr.phase && fr.phase !== phase) { phase = fr.phase; rows.push({ kind: "phase", y, label: phase }); y += RH; }
    rowOf[fi] = y;
    fr.acts.forEach((a, ai) => { rows.push({ kind: "act", y, a, fi, ai, round: fr.round }); y += RH; });
  });
  const H = y + 14;
  const heads = order.map((s) => `<line class="tk-life" x1="${f1(x.get(s.id))}" x2="${f1(x.get(s.id))}" y1="${TOP - 10}" y2="${f1(H - 6)}"/><g class="tk-st" data-st="${esc(s.id)}">${nodeSvg(m, s, x.get(s.id) - LW / 2 + 6, 8, LW - 12, 36, true)}</g>`).join("");
  const body = rows.map((r) => {
    if (r.kind === "phase") return `<g class="tk-ln-phase"><line x1="${LEFT}" x2="${f1(W - LEFT)}" y1="${f1(r.y)}" y2="${f1(r.y)}"/><text x="${f1(LEFT + 4)}" y="${f1(r.y - 5)}">${esc(r.label.toUpperCase())}</text></g>`;
    const a = r.a, x1 = x.get(a.from), x2 = x.get(a.to ?? a.from);
    const cls = `tk-ln m-${a.async ? "async" : "sync"} k-${a.kind}${a.status ? ` s-${a.status}` : ""}`;
    const text = clip([a.label, r.round ? `(${r.round.k}/${r.round.n})` : ""].filter(Boolean).join(" "), 60);
    if (a.kind === "at" || a.kind === "wait" || x1 === x2) {
      const cx = a.kind === "wait" ? LEFT + 6 : x1;
      const t = a.kind === "wait" ? `WAIT ${a.dur}${text ? ` · ${text}` : ""}` : text;
      const tx = Math.min(cx + 10, W - LEFT - textW(t, 10.5) - 4);
      return `<g class="${cls}" data-f="${r.fi}" data-a="${r.ai}"><rect class="tk-ln-box" x="${f1(cx - 5)}" y="${f1(r.y - 8)}" width="10" height="16"/><path class="tk-ln-path" d="M${f1(cx)} ${f1(r.y)} L${f1(cx + 0.1)} ${f1(r.y)}"/><text class="tk-ln-label" x="${f1(Math.max(LEFT, tx))}" y="${f1(r.y + 4)}" text-anchor="start">${esc(t)}</text></g>`;
    }
    const dir = x2 > x1 ? 1 : -1;
    const rt = a.kind === "rt";
    const d = rt ? `M${f1(x1)} ${f1(r.y - 3)} L${f1(x2 - dir * 2)} ${f1(r.y - 3)} M${f1(x2 - dir * 2)} ${f1(r.y + 4)} L${f1(x1)} ${f1(r.y + 4)}` : `M${f1(x1)} ${f1(r.y)} L${f1(x2 - dir * 2)} ${f1(r.y)}`;
    const ay = rt ? r.y - 3 : r.y;
    const head = `M${f1(x2 - dir * 8)} ${f1(ay - 4)} L${f1(x2 - dir * 1)} ${f1(ay)} L${f1(x2 - dir * 8)} ${f1(ay + 4)}z`;
    const half = textW(text, 10.5) / 2 + 4;
    const lx = Math.max(LEFT + half, Math.min(W - LEFT - half, (x1 + x2) / 2));
    return `<g class="${cls}" data-f="${r.fi}" data-a="${r.ai}"><path class="tk-ln-path" d="${d}"/><path class="tk-ln-head" d="${head}"/><text class="tk-ln-label" x="${f1(lx)}" y="${f1(r.y - 7)}">${esc(text)}</text></g>`;
  }).join("");
  const svg = `<svg class="tk-svg tk-lanes" viewBox="0 0 ${f1(W)} ${f1(H)}" width="${f1(W)}" height="${f1(H)}" role="img">${heads}${body}<g class="tk-tokens"></g></svg>`;
  return {
    svg, W, H,
    path(svgEl, a, fi, ai) {
      const p = svgEl.querySelector(`.tk-ln[data-f="${fi}"][data-a="${ai}"] .tk-ln-path`);
      return p ? { el: p, rev: false } : null;
    },
    rowY: (fi) => rowOf[fi],
  };
}

// ── style ─────────────────────────────────────────────────────────────
// crux blueprint tokens (--ink, --line, --accent, --m-async…) with fallbacks for pages without them.
const CSS_TEXT = `
.tk{--tk-ink:var(--ink,#16181d);--tk-ink2:var(--ink-2,#4b5260);--tk-ink3:var(--ink-3,#8b929e);--tk-line:var(--line,#1d2026);--tk-line2:var(--line-2,#d6dae1);--tk-paper:var(--paper,#fff);--tk-fill:var(--fill,#f3f5f8);--tk-accent:var(--accent,#1d5fbf);--tk-accent-bg:var(--accent-bg,#e4ecf8);--tk-async:var(--m-async,#1d5fbf);--tk-ok:var(--ak-green,#1f7a3d);--tk-ok-bg:var(--ak-green-bg,#e3f3e8);--tk-err:var(--err,#c62828);--tk-err-bg:var(--err-bg,#fbeaea);--tk-warn:var(--warn,#a8620a);--tk-warn-bg:var(--warn-bg,#fdf3e2);--tk-mono:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);--tk-sans:var(--font-sans,-apple-system,system-ui,sans-serif);--tk-bw:var(--bw,1.5px);
  display:block;container-type:inline-size;margin:12px 0;background:var(--tk-paper);border:var(--tk-bw) solid var(--tk-line);color:var(--tk-ink);font:13px/1.45 var(--tk-sans);max-width:100%;min-width:0;outline:none}
.tk *{box-sizing:border-box}
.tk-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:10px 12px;border-bottom:var(--tk-bw) solid var(--tk-line);background:var(--tk-fill)}
.tk-title{font:700 11px var(--tk-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--tk-ink2);margin-right:auto}
.tk .tk-segbtns{display:inline-flex;flex-wrap:wrap;border:var(--tk-bw) solid var(--tk-line);background:var(--tk-paper)}
.tk .tk-segbtns button{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;font:600 12px var(--tk-mono);color:var(--tk-ink2);background:none;border:0;cursor:pointer;white-space:nowrap}
.tk .tk-segbtns button+button{border-left:1px solid var(--tk-line2)}
.tk .tk-segbtns button:hover{color:var(--tk-ink);background:var(--tk-fill)}
.tk .tk-segbtns button.on{background:var(--tk-ink);color:var(--tk-paper)}
.tk-tone{width:8px;height:8px;background:var(--tk-ink3)}
.tk-tone.t-ok{background:var(--tk-ok)}.tk-tone.t-fail{background:var(--tk-err)}.tk-tone.t-warn{background:var(--tk-warn)}
.tk-scens{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px 0}
.tk-scens > span{font:600 10.5px var(--tk-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--tk-ink3)}
.tk .ak-sq-bar.tk-bar{margin:0;padding:10px 12px 0}
.tk-step{flex:none;border:0;background:none;padding:2px 4px;font:600 12px var(--tk-mono);color:var(--tk-ink2);cursor:pointer}
.tk-step:hover{background:var(--tk-fill);color:var(--tk-accent)}
.tk .ak-sq-seg.fail i{background:var(--tk-err)}.tk .ak-sq-seg.warn i{background:var(--tk-warn)}.tk .ak-sq-seg.ok i{background:var(--tk-ok)}
.tk .ak-sq-seg.ph{margin-left:6px}
.tk-main{display:grid;grid-template-columns:minmax(0,1fr)}
.tk-stage{position:relative;overflow:auto;padding:6px 8px 0;min-height:160px}
.tk-stage.is-lanes{max-height:560px}
.tk-svg{display:block;width:100%;height:auto;margin:0 auto;font-family:var(--tk-mono)}
.tk-lanes{width:auto;max-width:none}
.tk-side{border-top:var(--tk-bw) solid var(--tk-line);display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,.9fr);min-width:0}
@container (max-width:760px){.tk-side{grid-template-columns:minmax(0,1fr)}.tk-sec{border-right:0!important;border-bottom:1px solid var(--tk-line2)!important}}
.tk-sec{padding:10px 12px;border-right:1px solid var(--tk-line2);min-height:120px}
.tk-sec:last-child{border-right:0}
.tk-k{display:flex;justify-content:space-between;gap:8px;font:600 10.5px var(--tk-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--tk-ink3);margin-bottom:7px}
.tk-k b{color:var(--tk-ink)}
.tk-hop{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin:2px 0 6px}
.tk-arrow{font:700 15px var(--tk-mono);color:var(--m-sync,var(--tk-ink2))}
.tk-arrow.m-async{color:var(--tk-async)}
.tk-what{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font:12px var(--tk-mono);color:var(--tk-ink2);word-break:break-word}
.tk-notes{margin:8px 0 0;padding:0;list-style:none}
.tk-notes li{font-size:12.5px;color:var(--tk-ink2);border-left:2px solid var(--tk-line2);padding:1px 0 1px 8px;margin:4px 0}
.tk-round{font:700 10px var(--tk-mono);text-transform:uppercase;letter-spacing:.05em;color:var(--tk-err);border:1.5px solid var(--tk-err);padding:2px 5px}
.tk-vars{display:flex;flex-direction:column}
.tk-var{display:grid;grid-template-columns:minmax(80px,auto) minmax(0,1fr);gap:8px;padding:4px 0;border-bottom:1px solid var(--tk-line2);font:12px var(--tk-mono)}
.tk-var:last-child{border-bottom:0}
.tk-var span{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--tk-ink3);padding-top:1px}
.tk-var b{font-weight:600;word-break:break-word;transition:background .5s}
.tk-var.is-new b{background:var(--tk-warn-bg);box-shadow:inset 0 -2px var(--tk-warn)}
.tk-out{background:var(--tk-fill)}
.tk-out.s-ok{background:var(--tk-ok-bg)}.tk-out.s-fail{background:var(--tk-err-bg)}.tk-out.s-warn{background:var(--tk-warn-bg)}
.tk-out b{display:block;font-size:13.5px}
.tk-out p{margin:3px 0 0;font-size:12.5px;color:var(--tk-ink2)}
.tk-phases{display:flex;flex-wrap:wrap;gap:0;border-top:var(--tk-bw) solid var(--tk-line)}
.tk-phase{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border:0;border-right:1px solid var(--tk-line2);background:var(--tk-paper);font:600 11px var(--tk-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--tk-ink3);cursor:pointer}
.tk-phase:hover{background:var(--tk-fill);color:var(--tk-ink)}
.tk-phase i{display:grid;place-items:center;width:18px;height:18px;font:700 10.5px var(--tk-mono);font-style:normal;border:1.5px solid var(--tk-line2);color:var(--tk-ink3)}
.tk-phase.done{color:var(--tk-ink2)}.tk-phase.done i{background:var(--tk-ink);border-color:var(--tk-ink);color:var(--tk-paper)}
.tk-phase.now{color:var(--tk-ink);background:var(--tk-warn-bg)}.tk-phase.now i{background:var(--tk-warn);border-color:var(--tk-warn);color:var(--tk-paper)}
.tk-clock{margin-left:auto;align-self:center;padding:0 12px;font:600 11px var(--tk-mono);color:var(--tk-ink2)}
.tk-script{border-top:var(--tk-bw) solid var(--tk-line)}
.tk-script > summary{cursor:pointer;padding:8px 12px;font:600 11px var(--tk-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--tk-ink2);background:var(--tk-fill)}
.tk-script > .ak-route{padding:4px 12px 12px}
.tk-script .ak-route-step{cursor:pointer}
.tk-script .ak-route-step.is-done .ak-route-n{background:var(--tk-ink2)}
.tk-err{padding:10px 12px;color:var(--tk-err);font:12px var(--tk-mono);border-bottom:1px solid var(--tk-line2);background:var(--tk-err-bg)}
/* map */
.tk-rail .bed{fill:none;stroke:var(--tk-line2);stroke-width:3;transition:opacity .3s}
.tk-rail.m-async .bed{stroke-dasharray:5 4}
.tk-rail .run{fill:none;stroke:var(--tk-ink);stroke-width:3;opacity:0;transition:opacity .3s,stroke .3s}
.tk-rail.m-async .run{stroke:var(--tk-async);stroke-dasharray:6 4;animation:ak-dash 1.4s linear infinite}
.tk-rail.is-off .bed{opacity:.35}
.tk-rail.done .run{opacity:1}
.tk-rail.fail .run{opacity:1;stroke:var(--tk-err)}
.tk-rail.warn .run{opacity:1;stroke:var(--tk-warn)}
.tk.is-ended.end-ok .tk-rail.done .run{stroke:var(--tk-ok)}
.tk-node .box{fill:var(--tk-paper);stroke:var(--tk-ink2);stroke-width:1.5;transition:fill .3s,stroke .3s}
.tk-node.tech .box{fill:var(--tc-bg,var(--tk-paper));stroke:var(--tc,var(--tk-ink2))}
.tk-node.k-service .box,.tk-node.k-app .box,.tk-node.k-job .box{stroke:var(--tk-ink);stroke-width:2.25;fill:var(--tk-paper)}
.tk-node.k-external .box,.tk-node.k-actor .box{stroke-dasharray:5 4}
.tk-node.k-queue .box,.tk-node.k-broker .box{fill:var(--tk-fill);stroke:var(--tk-async);stroke-dasharray:5 3}
.tk-node.k-key .box{fill:var(--tk-warn-bg);stroke:var(--tk-warn)}
.tk-node.k-hsm .box{fill:var(--tk-fill);stroke:var(--tk-ink);stroke-width:2.25}
.tk-node.k-state .box{fill:var(--tk-fill);stroke:var(--tk-ink2)}
.tk-node.is-inferred .box{stroke-dasharray:2 3}
.tk-node .tag{font:600 8.5px var(--tk-mono);fill:var(--tk-ink3);letter-spacing:.06em}
.tk-node.tech .tag{fill:var(--tc,var(--tk-ink3))}
.tk-node.k-key .tag{fill:var(--tk-warn)}
.tk-node .label{font:600 12px var(--tk-mono);fill:var(--tk-ink)}
.tk-node .ic{fill:var(--tc,var(--tk-ink2))}
.tk-node.k-key .ic{fill:var(--tk-warn)}
.tk-st a:hover .box{stroke-width:3}
.tk-sub{font:10px var(--tk-mono);fill:var(--tk-ink3);text-anchor:middle}
.tk-halo{fill:none;stroke:var(--tk-accent);stroke-width:2;opacity:0}
.tk-st.is-off{opacity:.3}
.tk-st.done .tk-node .box{stroke:var(--tk-ink);stroke-width:2.25}
.tk-st.ok .tk-node .box{stroke:var(--tk-ok);fill:var(--tk-ok-bg);stroke-width:2.5;stroke-dasharray:none}
.tk-st.fail .tk-node .box{stroke:var(--tk-err);fill:var(--tk-err-bg);stroke-width:2.5;stroke-dasharray:none}
.tk-st.warn .tk-node .box{stroke:var(--tk-warn);fill:var(--tk-warn-bg);stroke-width:2.5;stroke-dasharray:none}
.tk-st.is-active .tk-node .box{fill:var(--tk-accent-bg);stroke:var(--tk-accent);stroke-width:3;stroke-dasharray:none}
.tk-st.is-active .tk-halo{opacity:.5;animation:tk-blink 1s steps(2) infinite}
@keyframes tk-blink{50%{opacity:.12}}
.tk-badge{opacity:0;transition:opacity .25s;pointer-events:none}
.tk-badge rect{fill:var(--tk-ink)}
.tk-badge text{font:600 10px var(--tk-mono);fill:var(--tk-paper);text-anchor:middle}
.tk-badge.s-fail rect{fill:var(--tk-err)}.tk-badge.s-ok rect{fill:var(--tk-ok)}.tk-badge.s-warn rect{fill:var(--tk-warn)}
.tk-badge.show{opacity:1}
.tk-token rect{fill:var(--tk-ink)}
.tk-token text{font:700 9.5px var(--tk-mono);fill:var(--tk-paper);text-anchor:middle;letter-spacing:.03em}
.tk-token.m-async rect{fill:var(--tk-async)}
.tk-token.s-ok rect{fill:var(--tk-ok)}.tk-token.s-fail rect{fill:var(--tk-err)}.tk-token.s-warn rect{fill:var(--tk-warn)}
.tk-hoplabel{font:10px var(--tk-mono);fill:var(--tk-accent);text-anchor:middle;paint-order:stroke;stroke:var(--tk-paper);stroke-width:4px}
.tk-wait{fill:var(--tk-paper);opacity:0;transition:opacity .3s;pointer-events:none}
.tk-wait.show{opacity:.78}
.tk-waittext{font:700 15px var(--tk-mono);letter-spacing:.06em;fill:var(--tk-ink);text-anchor:middle;opacity:0;transition:opacity .3s;pointer-events:none}
.tk-waittext.show{opacity:1}
/* lanes */
.tk-life{stroke:var(--tk-line2);stroke-width:1.5;stroke-dasharray:3 4}
.tk-ln-phase line{stroke:var(--tk-line2);stroke-dasharray:4 3}
.tk-ln-phase text{font:700 10px var(--tk-mono);letter-spacing:.1em;fill:var(--tk-ink2)}
.tk-ln-path{fill:none;stroke:var(--tk-line2);stroke-width:1.5}
.tk-ln-head{fill:var(--tk-line2)}
.tk-ln.m-async .tk-ln-path{stroke-dasharray:5 3}
.tk-ln-label{font:10.5px var(--tk-mono);fill:var(--tk-ink3);text-anchor:middle;paint-order:stroke;stroke:var(--tk-paper);stroke-width:4px}
.tk-ln-box{fill:var(--tk-paper);stroke:var(--tk-ink3);stroke-width:1.5}
.tk-ln.done .tk-ln-path{stroke:var(--m-sync,var(--tk-ink2))}.tk-ln.done .tk-ln-head{fill:var(--m-sync,var(--tk-ink2))}
.tk-ln.done.m-async .tk-ln-path{stroke:var(--tk-async)}.tk-ln.done.m-async .tk-ln-head{fill:var(--tk-async)}
.tk-ln.done .tk-ln-label{fill:var(--tk-ink)}
.tk-ln.done.m-async .tk-ln-label{fill:var(--tk-accent)}
.tk-ln.s-fail.done .tk-ln-path,.tk-ln.s-fail.done .tk-ln-box{stroke:var(--tk-err)}.tk-ln.s-fail.done .tk-ln-head{fill:var(--tk-err)}
.tk-ln.s-ok.done .tk-ln-path,.tk-ln.s-ok.done .tk-ln-box{stroke:var(--tk-ok)}.tk-ln.s-ok.done .tk-ln-head{fill:var(--tk-ok)}
.tk-ln.s-warn.done .tk-ln-box{stroke:var(--tk-warn);fill:var(--tk-warn-bg)}
.tk-ln.cur .tk-ln-path{stroke:var(--tk-warn);stroke-width:2.5}.tk-ln.cur .tk-ln-head{fill:var(--tk-warn)}
.tk-ln.cur .tk-ln-label{fill:var(--tk-ink);font-weight:700}
.tk-ln.cur .tk-ln-box{stroke:var(--tk-warn);fill:var(--tk-warn-bg)}
@keyframes ak-dash{to{stroke-dashoffset:-20}}
.am-intro:has(.tk),.am-md:has(> .tk){max-width:none}
.am-intro:has(.tk) > :not(.tk){max-width:72ch}
@media (prefers-reduced-motion:reduce){.tk-rail .run,.tk-st.is-active .tk-halo{animation:none}}
`;

function injectCss() {
  if (typeof document === "undefined" || document.getElementById("tk-css")) return;
  const s = document.createElement("style");
  s.id = "tk-css";
  s.textContent = CSS_TEXT;
  document.head.appendChild(s);
}

// ── player ────────────────────────────────────────────────────────────
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function durMs(s) {
  const m = String(s).match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/);
  if (!m) return 0;
  return +m[1] * { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2] ?? "s"];
}
function fmtClock(ms) {
  const s = Math.round(ms / 1e3);
  if (s < 1) return "T+0";
  if (s < 60) return `T+${s}s`;
  if (s < 3600) return `T+${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ""}`;
  return `T+${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60) ? ` ${Math.floor((s % 3600) / 60)}m` : ""}`;
}

const SPEEDS = [0.5, 1, 1.5, 2];
const ICON_PLAY = `<svg viewBox="0 0 16 16" aria-hidden="true"><path class="i-pause" d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z"/><path class="i-play" d="M5 3l8 5-8 5z"/></svg>`;

// crux: { el(id), chip(id), transport(word) } — stations become elements, hops become chips.
export function mountTrack(root, m, opts = {}) {
  injectCss();
  const crux = opts.crux ?? null;
  // stations → crux elements; hop labels → transports (a queue/topic label makes the hop async)
  for (const s of m.stations.values()) {
    const el = crux?.el?.(s.elId ?? s.id) ?? null;
    s.el = el;
    if (el) {
      if (!s.labelSet) s.label = el.title;
      if (!s.kindSet) s.kind = { actor: "actor", external: "external", store: "store", cache: "store", broker: "queue", job: "job" }[el.kind] ?? (el.kind === "gateway" ? "service" : "service");
    }
  }
  const walk = (bs) => bs.forEach((b) => {
    if (b.beats) walk(b.beats);
    if ((b.kind === "hop" || b.kind === "rt") && b.label) {
      const w = b.label.split(/\s+/)[0];
      const tr = crux?.transport?.(w) ?? null;
      if (tr) { b.tr = tr; b.what = b.label.slice(w.length).trim(); if (tr.mode === "async" || tr.mode === "stream") b.async = true; }
    }
  });
  walk(m.beats);

  const scenFrames = new Map(m.scenarios.map((s) => [s.id, framesOf(m, s)]));
  const metro = metroView(m, scenFrames);
  const P = { scen: m.scenarios[0], frames: [], k: 0, playing: false, speed: 1, view: opts.view === "lanes" ? "lanes" : "metro", raf: 0, timer: 0, seen: false, lanes: null, prev: {} };

  root.classList.add("tk");
  root.innerHTML = `${m.errors.length ? `<div class="tk-err">${m.errors.map((e) => `${e.line ? `line ${e.line}: ` : ""}${esc(e.msg)}`).join("<br>")}</div>` : ""}
<div class="tk-top"><span class="tk-title">${esc(m.title || "Flow")}</span><span class="tk-segbtns" data-tk-view><button data-view="metro" class="${P.view === "metro" ? "on" : ""}">Map</button><button data-view="lanes" class="${P.view === "lanes" ? "on" : ""}">Lanes</button></span></div>
${m.scenarios.length > 1 ? `<div class="tk-scens"><span>Scenario</span><span class="tk-segbtns">${m.scenarios.map((s, i) => `<button class="${i === 0 ? "on" : ""}" data-scen="${esc(s.id)}">${s.tone ? `<i class="tk-tone t-${esc(s.tone)}"></i>` : ""}${esc(s.label)}</button>`).join("")}</span></div>` : ""}
<div class="ak-sq-bar tk-bar"><button type="button" class="ak-sq-btn" data-tk="play" aria-label="Play">${ICON_PLAY}</button><button type="button" class="tk-step" data-tk="back" title="Step back (←)">‹</button><button type="button" class="tk-step" data-tk="next" title="Step (→)">›</button><div class="ak-sq-segs"></div><span class="ak-sq-count"></span><button type="button" class="ak-sq-speed" data-tk="speed" aria-label="Speed">1×</button></div>
<div class="tk-main"><div class="tk-stage"></div><aside class="tk-side"><div class="tk-sec tk-now"></div><div class="tk-sec"><div class="tk-k"><span>${esc(m.token)}</span></div><div class="tk-vars"></div></div><div class="tk-sec tk-out"></div></aside></div>
<div class="tk-phases"></div>
<details class="tk-script"><summary>Script · every beat of this scenario</summary><ol class="ak-route"></ol></details>`;
  const $ = (s) => root.querySelector(s);
  const stage = $(".tk-stage");
  const sname = (id) => m.stations.get(id)?.label ?? id;
  const chip = (id) => crux?.chip?.(m.stations.get(id)?.elId ?? id) ?? `<span class="ak-el k-${esc(m.stations.get(id)?.kind ?? "service")}"><span>${esc(sname(id))}</span></span>`;

  function buildView() {
    if (P.view === "metro") stage.innerHTML = metro.svg;
    else { P.lanes = lanesView(m, P.frames); stage.innerHTML = P.lanes.svg; }
    stage.classList.toggle("is-lanes", P.view === "lanes");
    const svg = stage.querySelector("svg");
    if (P.view === "metro") {
      for (const g of svg.querySelectorAll(".tk-rail")) g.classList.toggle("is-off", !g.dataset.scen.split(" ").includes(P.scen.id));
      const used = new Set(P.frames.flatMap((f) => f.acts.flatMap((a) => [a.from, a.to])));
      for (const g of svg.querySelectorAll(".tk-st")) g.classList.toggle("is-off", !used.has(g.dataset.st));
    }
  }

  // state after frames [0, k)
  function stateAt(k) {
    const s = { vars: { ...m.state }, rails: new Map(), st: new Map(), token: m.token, tstatus: "", at: null, clock: 0, done: new Set() };
    for (const o of P.scen.ops) applyOp(s, o);
    for (let i = 0; i < k; i++) applyFrame(s, P.frames[i], i);
    return s;
  }
  function applyOp(s, o) {
    if (o.op === "=") s.vars[o.k] = o.v;
    else if (o.op === "+=" || o.op === "-=") s.vars[o.k] = String((parseFloat(s.vars[o.k]) || 0) + (o.op === "+=" ? 1 : -1) * (parseFloat(o.v) || 0));
    else if (o.op === "token") s.token = o.v;
    else if (o.op === "status") s.tstatus = o.v;
  }
  function applyFrame(s, fr, i) {
    fr.acts.forEach((a, ai) => {
      s.done.add(`${i}:${ai}`);
      if (a.kind === "hop" || a.kind === "rt") {
        if (a.from !== a.to) s.rails.set(metro.railOf(a), a.status === "fail" ? "fail" : a.status === "warn" ? "warn" : "done");
        if (!s.st.get(a.from)) s.st.set(a.from, "done");
        const prev = s.st.get(a.to);
        s.st.set(a.to, a.kind === "hop" && a.status ? a.status : prev && prev !== "done" ? prev : "done");
        s.at = a.kind === "rt" ? a.from : a.to;
      } else if (a.kind === "at") {
        s.st.set(a.from, a.status || s.st.get(a.from) || "done");
        s.at = s.at ?? a.from;
      } else if (a.kind === "wait") s.clock += durMs(a.dur);
      for (const o of a.ops) applyOp(s, o);
    });
  }

  function hopHtml(a) {
    if (a.kind === "wait") return `<div class="tk-hop"><span class="ak-tr m-trigger">wait</span><b>${esc(a.dur)}</b></div>${a.label ? `<div class="tk-what">${esc(a.label)}</div>` : ""}`;
    if (a.kind === "at") return `<div class="tk-hop">${chip(a.from)}</div>${a.label ? `<div class="tk-what">${esc(a.label)}</div>` : ""}`;
    const mode = a.async ? "async" : "sync";
    return `<div class="tk-hop">${chip(a.from)}<span class="tk-arrow m-${mode}">${a.kind === "rt" ? "⇄" : a.async ? "⇢" : "→"}</span>${chip(a.to)}</div><div class="tk-what">${a.tr ? a.tr.html : ""}${esc(a.tr ? a.what : a.label)}</div>`;
  }

  function paint(s, cur) {
    const svg = stage.querySelector("svg");
    const ended = P.k >= P.frames.length;
    if (P.view === "metro") {
      for (const g of svg.querySelectorAll(".tk-rail")) { g.classList.remove("done", "fail", "warn"); const v = s.rails.get(g.dataset.rail); if (v) g.classList.add(v); }
      for (const g of svg.querySelectorAll(".tk-st")) {
        g.classList.remove("done", "ok", "fail", "warn", "is-active");
        const v = s.st.get(g.dataset.st);
        if (v) g.classList.add(v);
        const b = g.querySelector(".tk-badge");
        const at = cur?.acts.find((a) => a.kind === "at" && a.from === g.dataset.st && a.label);
        b.setAttribute("class", `tk-badge${at ? " show" : ""}${at?.status ? ` s-${at.status}` : ""}`);
        if (at) {
          const t = clip(at.label, 44);
          b.querySelector("text").textContent = t;
          const w = textW(t, 10) + 14;
          const r = b.querySelector("rect");
          r.setAttribute("x", f1(-w / 2));
          r.setAttribute("width", f1(w));
        }
      }
      if (cur) for (const a of cur.acts) if (a.kind !== "wait") for (const id of [a.from, a.to]) svg.querySelector(`.tk-st[data-st="${CSS.escape(id)}"]`)?.classList.add("is-active");
    } else {
      for (const g of svg.querySelectorAll(".tk-ln")) {
        g.classList.toggle("done", s.done.has(`${g.dataset.f}:${g.dataset.a}`));
        g.classList.toggle("cur", !!cur && +g.dataset.f === P.k);
      }
    }
    root.classList.toggle("is-ended", ended);
    root.classList.toggle("end-ok", ended && s.tstatus !== "fail" && s.tstatus !== "warn");
    // progress segments (the sequence player's bar)
    $(".ak-sq-segs").innerHTML = P.frames.map((fr, i) => {
      const st = fr.acts.find((a) => a.status)?.status ?? "";
      const ph = i > 0 && fr.phase !== P.frames[i - 1].phase ? " ph" : "";
      return `<button type="button" class="ak-sq-seg${i < P.k ? ` done${st ? ` ${st}` : ""}` : ""}${cur && i === P.k ? " cur" : ""}${ph}" data-seg="${i}" title="${esc(`${i + 1}. ${fr.acts.map((a) => (a.kind === "wait" ? `wait ${a.dur}` : a.kind === "at" ? `at ${sname(a.from)}` : `${sname(a.from)} → ${sname(a.to)}`)).join(" + ")}`)}"${cur && i === P.k ? ` style="--dur:${(DUR[fr.acts[0].kind] ?? DUR.hop) / P.speed}ms"` : ""}><i></i></button>`;
    }).join("");
    $(".ak-sq-count").textContent = `${Math.min(P.k + (cur ? 1 : 0), P.frames.length)}/${P.frames.length}`;
    $("[data-tk=play]").setAttribute("aria-label", P.playing ? "Pause" : "Play");
    root.classList.toggle("is-paused", !P.playing);
    // now
    const fr = cur ?? P.frames[Math.min(P.k, P.frames.length) - 1];
    const idx = cur ? P.k + 1 : Math.min(P.k, P.frames.length);
    const notes = fr ? [...fr.notes, ...fr.acts.flatMap((a) => (a.notes === fr.notes ? [] : a.notes))] : [];
    $(".tk-now").innerHTML = fr
      ? `<div class="tk-k"><span>Beat <b>${idx}</b> / ${P.frames.length}</span><span>${esc(fr.phase || "")}</span></div>${fr.round ? `<div style="margin-bottom:6px"><span class="tk-round">${esc(fr.round.label || "round")} ${fr.round.k} of ${fr.round.n}</span></div>` : ""}${fr.acts.map(hopHtml).join("")}${notes.length ? `<ul class="tk-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`
      : `<div class="tk-k"><span>Ready</span><span>${P.frames.length} beats</span></div><div class="tk-what">Press play, click a segment, a phase or a beat in the script.</div>`;
    const vars = Object.entries(s.vars);
    $(".tk-vars").innerHTML = vars.length ? vars.map(([k, v]) => `<div class="tk-var${P.prev[k] !== undefined && P.prev[k] !== v ? " is-new" : ""}"><span>${esc(k)}</span><b>${esc(v === "" ? "—" : v)}</b></div>`).join("") : `<div class="tk-what">no state</div>`;
    P.prev = { ...s.vars };
    const oc = $(".tk-out");
    const tone = ended ? s.tstatus || "ok" : "";
    oc.className = `tk-sec tk-out${tone ? ` s-${tone}` : ""}`;
    oc.innerHTML = `<div class="tk-k"><span>${ended ? "Outcome" : "Ends with"}</span><span>${fmtClock(s.clock)}</span></div><b>${ended ? (tone === "fail" ? "✕ " : tone === "warn" ? "! " : "✓ ") : ""}${esc(P.scen.label)}</b>${P.scen.outcome ? `<p>${esc(P.scen.outcome)}</p>` : ""}`;
    // phases
    const curPhase = (cur ?? P.frames[P.k - 1])?.phase;
    const phases = m.phases.filter((p) => P.frames.some((f) => f.phase === p));
    const curI = phases.indexOf(curPhase);
    $(".tk-phases").innerHTML = phases.map((p, i) => `<button class="tk-phase ${i < curI || (ended && i <= curI) ? "done" : i === curI ? "now" : ""}" data-phase="${esc(p)}"><i>${i + 1}</i>${esc(p)}</button>`).join("") + `<span class="tk-clock">${fmtClock(s.clock)}</span>`;
    for (const li of root.querySelectorAll(".tk-script li[data-f]")) {
      li.classList.toggle("is-current", +li.dataset.f === P.k && !!cur);
      li.classList.toggle("is-done", +li.dataset.f < P.k);
    }
  }

  // the script, written as a crux route
  function script() {
    let ph = "";
    const out = [];
    P.frames.forEach((fr, i) => {
      if (fr.phase && fr.phase !== ph) { ph = fr.phase; out.push(`<li class="ak-route-phase">${esc(ph)}</li>`); }
      const a = fr.acts[0];
      const mode = a.async ? "async" : "sync";
      out.push(`<li class="ak-route-step m-${mode}" data-f="${i}"><span class="ak-route-n">${i + 1}</span><div class="ak-route-body">${fr.acts.map((x) => {
        const st = x.status ? ` <span class="ak-tr" style="border-color:var(--${x.status === "ok" ? "ak-green" : x.status === "fail" ? "err" : "warn"});color:var(--${x.status === "ok" ? "ak-green" : x.status === "fail" ? "err" : "warn"})">${x.status}</span>` : "";
        if (x.kind === "wait") return `<div class="ak-route-what"><span class="ak-tr m-trigger">wait ${esc(x.dur)}</span><span>${esc(x.label)}</span></div>`;
        if (x.kind === "at") return `<div class="ak-route-hop">${chip(x.from)}${st}</div>${x.label ? `<div class="ak-route-what"><span>${esc(x.label)}</span></div>` : ""}`;
        return `<div class="ak-route-hop">${chip(x.from)}<span class="ak-route-arrow">${x.kind === "rt" ? "⇄" : x.async ? "⇢" : "→"}</span>${chip(x.to)}${st}</div><div class="ak-route-what">${x.tr ? x.tr.html : ""}<span>${esc(x.tr ? x.what : x.label)}</span>${fr.round ? ` <code>${fr.round.k}/${fr.round.n}</code>` : ""}</div>`;
      }).join("")}${[...fr.notes, ...fr.acts.flatMap((x) => (x.notes === fr.notes ? [] : x.notes))].map((n) => `<div class="ak-route-note">${esc(n)}</div>`).join("")}</div></li>`);
    });
    $(".tk-script .ak-route").innerHTML = out.join("");
  }

  // ── tokens ──
  function tokenEl(label, cls) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const t = clip(label, 28);
    const w = textW(t, 9.5) + 14;
    g.setAttribute("class", `tk-token ${cls}`);
    g.innerHTML = `<rect x="${f1(-w / 2)}" y="-9" width="${f1(w)}" height="18"/><text y="3.5">${esc(t)}</text>`;
    return g;
  }
  const clearTokens = () => stage.querySelectorAll(".tk-tokens > *").forEach((n) => n.remove());
  function placeToken(s) {
    clearTokens();
    if (P.view !== "metro" || !s.at) return;
    const p = metro.at(s.at);
    if (!p) return;
    const g = tokenEl(s.token, s.tstatus ? `s-${s.tstatus}` : "");
    g.setAttribute("transform", `translate(${f1(p.x)} ${f1(p.y - BOX.h / 2 - 12)})`);
    stage.querySelector(".tk-tokens").appendChild(g);
  }

  function stop() {
    cancelAnimationFrame(P.raf);
    clearTimeout(P.timer);
    P.raf = P.timer = 0;
    stage.querySelector(".tk-wait")?.classList.remove("show");
    stage.querySelector(".tk-waittext")?.classList.remove("show");
  }
  function seek(k) {
    stop();
    P.k = Math.max(0, Math.min(k, P.frames.length));
    const s = stateAt(P.k);
    paint(s, null);
    placeToken(s);
    scrollLanes();
  }
  function scrollLanes() {
    if (P.view !== "lanes" || !P.lanes) return;
    const y = P.lanes.rowY(Math.min(P.k, P.frames.length - 1));
    const svg = stage.querySelector("svg");
    if (y == null || !svg) return;
    const scale = svg.getBoundingClientRect().height / P.lanes.H || 1;
    stage.scrollTo({ top: Math.max(0, y * scale - stage.clientHeight / 2), behavior: "smooth" });
  }

  // animate frame k, then call done
  function animate(k, done) {
    stop();
    const fr = P.frames[k];
    const before = stateAt(k);
    P.k = k;
    paint(before, fr);
    scrollLanes();
    const svg = stage.querySelector("svg");
    const layer = svg.querySelector(".tk-tokens");
    clearTokens();
    const moves = [];
    let dur = 0, waitAct = null;
    fr.acts.forEach((a, ai) => {
      dur = Math.max(dur, DUR[a.kind] ?? DUR.hop);
      if (a.kind === "wait") { waitAct = a; return; }
      const status = a.kind === "hop" ? a.ops.find((o) => o.op === "status")?.v ?? before.tstatus : before.tstatus;
      const label = a.kind === "rt" ? before.token : a.ops.find((o) => o.op === "token")?.v ?? before.token;
      const path = a.kind === "at" || a.from === a.to ? null : P.view === "metro" ? metro.path(svg, a) : P.lanes.path(svg, a, k, ai);
      let g;
      if (P.view === "lanes") {
        g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("class", `tk-token ${a.async ? "m-async" : ""}`);
        g.innerHTML = `<rect x="-5" y="-5" width="10" height="10"/>`;
      } else g = tokenEl(label, `${a.async ? "m-async" : ""}${status ? ` s-${status}` : ""}`);
      layer.appendChild(g);
      let lab = null;
      if (a.label && P.view === "metro" && path) {
        lab = document.createElementNS("http://www.w3.org/2000/svg", "text");
        lab.setAttribute("class", "tk-hoplabel");
        lab.textContent = clip(a.label, 48);
        layer.appendChild(lab);
      }
      if (!path) {
        const p = P.view === "metro" ? metro.at(a.from) : null;
        if (p) g.setAttribute("transform", `translate(${f1(p.x)} ${f1(p.y - BOX.h / 2 - 12)})`);
        else g.remove();
      }
      moves.push({ a, g, lab, path, len: path ? path.el.getTotalLength() : 0 });
    });
    if (waitAct && P.view === "metro") {
      svg.querySelector(".tk-wait").classList.add("show");
      const wt = svg.querySelector(".tk-waittext");
      wt.textContent = `WAIT ${waitAct.dur}${waitAct.label ? ` · ${clip(waitAct.label, 44)}` : ""}`;
      wt.classList.add("show");
    }
    const total = dur / P.speed;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / total);
      for (const mv of moves) {
        if (!mv.path) continue;
        let u = mv.a.kind === "rt" ? (t < 0.5 ? ease(t * 2) : 1 - ease((t - 0.5) * 2)) : ease(t);
        if (mv.path.rev) u = 1 - u;
        const pt = mv.path.el.getPointAtLength(u * mv.len);
        // one height for the whole hop — the height it rests at above a station
        const lift = P.view === "metro" ? -(BOX.h / 2 + 12) : 0;
        mv.g.setAttribute("transform", `translate(${f1(pt.x)} ${f1(pt.y + lift)})`);
        if (mv.lab) { mv.lab.setAttribute("x", f1(pt.x)); mv.lab.setAttribute("y", f1(pt.y + lift - 15)); mv.lab.style.opacity = String(Math.min(1, Math.sin(Math.PI * t) * 2.2)); }
      }
      if (t < 1) { P.raf = requestAnimationFrame(step); return; }
      P.raf = 0;
      svg.querySelector(".tk-wait")?.classList.remove("show");
      svg.querySelector(".tk-waittext")?.classList.remove("show");
      P.k = k + 1;
      const s = stateAt(P.k);
      paint(s, null);
      placeToken(s);
      P.timer = setTimeout(done, DUR.gap / P.speed);
    };
    P.raf = requestAnimationFrame(step);
  }

  function loop() {
    if (!P.playing) return;
    if (P.k >= P.frames.length) { P.playing = false; seek(P.frames.length); return; }
    animate(P.k, loop);
  }
  function play(on) {
    if (on && P.k >= P.frames.length) P.k = 0;
    P.playing = on;
    if (on) loop();
    else seek(P.k);
  }
  const once = (k) => { P.playing = false; animate(k, () => paint(stateAt(P.k), null)); };
  function setScen(id) {
    P.scen = m.scenarios.find((s) => s.id === id) ?? m.scenarios[0];
    P.frames = scenFrames.get(P.scen.id);
    for (const b of root.querySelectorAll("[data-scen]")) b.classList.toggle("on", b.dataset.scen === P.scen.id);
    P.prev = {};
    stop();
    buildView();
    script();
    P.playing = false;
    seek(0);
    if (P.seen) play(true);
  }

  root.addEventListener("click", (ev) => {
    const b = ev.target.closest("button, li[data-f]");
    if (!b || !root.contains(b)) return;
    if (b.dataset.tk === "play") play(!P.playing);
    else if (b.dataset.tk === "next") { if (P.k < P.frames.length) once(P.k); }
    else if (b.dataset.tk === "back") { P.playing = false; seek(P.k - 1); }
    else if (b.dataset.tk === "speed") { P.speed = SPEEDS[(SPEEDS.indexOf(P.speed) + 1) % SPEEDS.length]; b.textContent = `${P.speed}×`; }
    else if (b.dataset.view) { P.view = b.dataset.view; for (const x of root.querySelectorAll("[data-view]")) x.classList.toggle("on", x === b); const was = P.playing; P.playing = false; stop(); buildView(); seek(P.k); if (was) play(true); }
    else if (b.dataset.scen) { P.seen = true; setScen(b.dataset.scen); }
    else if (b.dataset.phase) { P.playing = false; seek(P.frames.findIndex((f) => f.phase === b.dataset.phase)); }
    else if (b.dataset.seg != null) { P.playing = false; seek(+b.dataset.seg); once(+b.dataset.seg); }
    else if (b.dataset.f != null) { P.playing = false; seek(+b.dataset.f); once(+b.dataset.f); }
  });
  root.tabIndex = 0;
  root.addEventListener("keydown", (ev) => {
    if (ev.target !== root) return;
    if (ev.key === " ") { ev.preventDefault(); play(!P.playing); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); if (P.k < P.frames.length) once(P.k); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); P.playing = false; seek(P.k - 1); }
  });

  setScen(P.scen.id);
  if (opts.autoplay !== false && typeof IntersectionObserver !== "undefined") {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting) && !P.seen) { P.seen = true; play(true); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(root);
  }
  return { play, seek, setScen, destroy: stop, model: m };
}

// ── steps → track ─────────────────────────────────────────────────────
// A default scene for any crux flow: participants laid out in order of first use; pure lookup
// targets (only ever called synchronously, never call anyone) drop to a row under their caller.
export function trackFromSteps(f, byId) {
  const steps = f.steps ?? [];
  const order = [];
  const sends = new Set(), asyncTouch = new Set();
  for (const s of steps) {
    for (const x of [s.fromId || s.from, s.toId || s.to]) if (x && !order.includes(x)) order.push(x);
    sends.add(s.fromId || s.from);
    if (s.async) { asyncTouch.add(s.fromId || s.from); asyncTouch.add(s.toId || s.to); }
  }
  const lookup = new Set(order.filter((id) => !sends.has(id) && !asyncTouch.has(id) && order.indexOf(id) > 0));
  const row0 = order.filter((id) => !lookup.has(id));
  const grid = [row0.slice(), row0.map(() => ".")];
  for (const id of lookup) {
    const caller = steps.find((s) => (s.toId || s.to) === id)?.fromId;
    let c = Math.max(0, row0.indexOf(caller));
    while (grid[1][c] && grid[1][c] !== ".") c++;
    grid[1][c] = id;
  }
  if (grid[1].every((x) => !x || x === ".")) grid.pop();
  const q = (s) => String(s ?? "").replace(/"/g, "'");
  const lines = [`title: ${f.title}`, `token: ${f.id}`, "state: step=—", "stations:", ...grid.map((r) => "  " + r.map((x) => x ?? ".").join("  "))];
  for (const id of order) { const e = byId?.get?.(id); if (e?.summary) lines.push(`station ${id} sub="${q(e.summary).slice(0, 34)}"`); }
  let phase = "";
  for (const s of steps) {
    if (s.phase && s.phase !== phase) { phase = s.phase; lines.push(`== ${phase} ==`); }
    const a = s.fromId || s.from, b = s.toId || s.to;
    const label = [s.transport, s.name || s.label].filter(Boolean).join(" ").replace(/\|/g, "/");
    lines.push(a === b ? `at ${a}: ${label || s.id} | step=${s.id}` : `${a} ${s.async ? "~>" : "->"} ${b} : ${label} | step=${s.id}`);
    for (const n of s.notes ?? []) lines.push(`note: ${n}`);
    for (const br of s.branches ?? []) lines.push(`note: branch — ${br.when} → ${br.to}`);
  }
  return lines.join("\n");
}

// Mount every [data-track] element under root that has not been mounted yet.
export function hydrateTracks(root = document, crux = null) {
  for (const el of root.querySelectorAll("[data-track]:not([data-tk-ready])")) {
    el.setAttribute("data-tk-ready", "1");
    const src = el.dataset.src ?? "";
    try { mountTrack(el, parseTrack(src), { view: el.dataset.view, crux }); }
    catch (e) { el.innerHTML = `<div class="tk-err">track: ${esc(e.message)}</div>`; }
  }
}
