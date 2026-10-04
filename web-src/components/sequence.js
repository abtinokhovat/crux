// Sequence diagram: same layout as the answer-me-with-html sequence, plus
//  - participants linked to architecture components ("participant Name = node-id", or by name),
//    drawn with the component's kind/tech style and clickable to the map;
//  - every message/note/divider wrapped in a step group, so the app can play the flow ("play").

const FS = 13, LH = 16, ACTOR_H = 34, TOP = 8, MARGIN = 12, LABEL_MAX = 240;
const NARROW = new Set([..."iljtfrI.,:;|!'`()[]{}"]);
const WIDE = new Set([..."mwMWOQGD@%&"]);
const CJK = /[⺀-鿿가-힯豈-﫿︰-﹏＀-￯　-〿]/;
const cw = (ch) => (CJK.test(ch) ? 1 : ch === " " ? 0.3 : NARROW.has(ch) ? 0.32 : WIDE.has(ch) ? 0.86 : ch >= "A" && ch <= "Z" ? 0.68 : 0.56);
const measure = (s, size = FS) => [...String(s ?? "")].reduce((u, ch) => u + cw(ch), 0) * size;
function wrap(str, max, size = FS) {
  const lines = [];
  let line = "";
  for (const tok of String(str).match(/\S+|\s+/g) ?? []) {
    if (/^\s+$/.test(tok)) { if (line) line += " "; continue; }
    const cand = line + tok;
    if (line.trim() && measure(cand, size) > max) { lines.push(line.trimEnd()); line = tok; } else line = cand;
  }
  lines.push(line.trimEnd());
  return lines;
}
const f = (n) => String(Math.round(n * 10) / 10);

const RE = {
  participants: /^participants?\s*[:：]\s*(.+)$/i,
  link: /^participant\s+(.+?)\s*=\s*([\w.-]+)\s*$/i,
  note: /^note\s+([^:：]+)[:：]\s*(.+)$/i,
  divider: /^==\s*(.+?)\s*==$/,
  msg: /^([^:：]+?)\s*(-->|->)\s*([^:：]+?)\s*(?:[:：]\s*(.*))?$/,
  alt: /^alt\s+(.+)$/i,
  else: /^else(?:\s+(.+))?$/i,
  end: /^end$/i,
};

function parse(text, ComponentError) {
  const participants = [];
  const links = new Map();
  const add = (p) => { if (!participants.includes(p)) participants.push(p); };
  const steps = [];
  // What-if branches: "alt <scenario>" … "else <scenario>" … "end". One level, no nesting.
  const blocks = [];
  let blk = null;
  const push = (step) => steps.push(blk ? { ...step, blk: blk.id, br: blk.labels.length - 1 } : step);
  String(text).split("\n").forEach((raw, i) => {
    const t = raw.trim();
    const line = i + 1;
    if (!t || t.startsWith("//")) return;
    let m;
    if ((m = t.match(RE.alt))) {
      if (blk) throw new ComponentError("sequence: alt blocks cannot be nested; close the first with end", line);
      blk = { id: blocks.length, labels: [m[1].trim()] };
      blocks.push(blk);
      steps.push({ kind: "alt", blk: blk.id, br: 0, label: blk.labels[0], line });
      return;
    }
    if ((m = t.match(RE.else))) {
      if (!blk) throw new ComponentError("sequence: else without alt", line);
      blk.labels.push((m[1] ?? "otherwise").trim());
      steps.push({ kind: "else", blk: blk.id, br: blk.labels.length - 1, label: blk.labels.at(-1), line });
      return;
    }
    if (RE.end.test(t)) {
      if (!blk) throw new ComponentError("sequence: end without alt", line);
      steps.push({ kind: "end", blk: blk.id, line });
      blk = null;
      return;
    }
    if ((m = t.match(RE.link))) links.set(m[1], m[2]); // a link never changes the column order
    else if ((m = t.match(RE.participants))) m[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean).forEach(add);
    else if ((m = t.match(RE.note))) {
      const over = m[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      over.forEach(add);
      push({ kind: "note", over, text: m[2].trim(), line });
    } else if ((m = t.match(RE.divider))) push({ kind: "divider", text: m[1], line });
    else if ((m = t.match(RE.msg))) {
      add(m[1]); add(m[3]);
      push({ kind: "msg", from: m[1], to: m[3], dashed: m[2] === "-->", label: (m[4] ?? "").trim(), line });
    } else throw new ComponentError(`sequence: cannot read "${t}". Write A -> B: label (--> for a reply), note A: text, == phase ==, or participant Name = component-id`, line);
  });
  if (blk) throw new ComponentError(`sequence: alt "${blk.labels[0]}" has no end`, 1);
  for (const p of links.keys()) add(p); // linked but never used: still shown, at the end
  if (!participants.length) throw new ComponentError("sequence needs at least one message", 1);
  return { participants, steps, links, blocks };
}

// Find the architecture node for a participant: explicit link first, then id or label match.
function resolve(name, links, arch) {
  const nodes = arch?.nodes ?? {};
  if (links.has(name)) return { node: nodes[links.get(name)] ?? null, explicit: links.get(name) };
  const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const k = key(name);
  if (!k) return { node: null };
  const all = Object.values(nodes);
  return { node: nodes[name] ?? all.find((n) => key(n.id) === k) ?? all.find((n) => key(n.label) === k) ?? null };
}

export const sequence = {
  name: "sequence",
  summary: "Sequence diagram; participants link to components; optional step-by-step playback",
  syntax: `\`\`\`sequence [num] [play]
participant Inbound = inbound   ← link to an architecture component (else matched by name)
A -> B: request                 ← solid
alt Redpanda down               ← what-if: chips switch the branch that plays
  A -> C: fallback
else Redpanda up
  A -> B: normal
end
B --> A: reply                  ← dashed
note A, B: text
== phase ==
\`\`\`
- num: number the messages. play: add playback controls (play, step, scrub, speed).`,
  example: "```sequence num play\nparticipant Inbound = inbound\nMeta -> Inbound: POST webhook\nInbound -> Redpanda: produce\nInbound --> Meta: 200\n```",
  render(text, { args, uid, esc, ComponentError, ctx }) {
    const { participants: ps, steps, links, blocks } = parse(text, ComponentError);
    const num = /\bnum\b/.test(args);
    const play = /\bplay\b/.test(args);
    const id = typeof uid === "function" ? uid() : `sq${Math.random().toString(36).slice(2, 8)}`;
    const arch = ctx?.cfg?.arch;
    const res = new Map(ps.map((p) => [p, resolve(p, links, arch)]));
    const missing = [...res].filter(([, r]) => r.explicit && !r.node).map(([p, r]) => `${p} = ${r.explicit}`);

    const idx = new Map(ps.map((p, i) => [p, i]));
    const actorW = ps.map((p) => Math.max(measure(p) + 28, 84));
    const gaps = ps.slice(1).map((_, i) => (actorW[i] + actorW[i + 1]) / 2 + 28);
    let extraRight = 0, extraLeft = 0;
    const prepared = steps.map((s) => {
      if (s.kind === "alt" || s.kind === "else" || s.kind === "end") return s;
      if (s.kind === "msg") {
        const lines = s.label ? wrap(s.label, LABEL_MAX) : [];
        const width = Math.max(0, ...lines.map((l) => measure(l))) + (num ? 34 : 22);
        const a = idx.get(s.from), b = idx.get(s.to);
        if (a === b) {
          if (a < gaps.length) gaps[a] = Math.max(gaps[a], width + 48);
          else extraRight = Math.max(extraRight, width + 40);
        } else {
          const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
          const span = gaps.slice(lo, hi).reduce((x, y) => x + y, 0);
          if (span < width) gaps[hi - 1] += width - span;
        }
        return { ...s, lines, a, b };
      }
      const lines = wrap(s.text, 220, 12);
      const w = Math.max(...lines.map((l) => measure(l, 12))) + 20;
      if (s.kind === "note" && s.over.length === 1) {
        const i = idx.get(s.over[0]);
        if (i === 0) extraLeft = Math.max(extraLeft, w / 2 - actorW[0] / 2);
        if (i === ps.length - 1) extraRight = Math.max(extraRight, w / 2 - actorW[i] / 2);
      }
      return { ...s, lines, w };
    });
    const xs = [MARGIN + extraLeft + actorW[0] / 2];
    gaps.forEach((g) => xs.push(xs.at(-1) + g));
    const width = xs.at(-1) + actorW.at(-1) / 2 + MARGIN + extraRight;
    const textLines = (lines, cx, cy, attrs = "") => {
      const top = cy - ((lines.length - 1) * LH) / 2;
      return lines.map((l, i) => `<text x="${f(cx)}" y="${f(top + i * LH)}" text-anchor="middle" dominant-baseline="central"${attrs}>${esc(l)}</text>`).join("");
    };

    const body = [];
    const frames = [];
    let y = TOP + ACTOR_H + 22;
    let n = 0, k = 0;
    const br = (s) => (s.blk != null ? ` data-blk="${s.blk}" data-br="${s.br}"` : "");
    for (const s of prepared) {
      const parts = [];
      if (s.kind === "alt") { frames[s.blk] = { y0: y - 6, labels: [{ y: y - 6, text: s.label, br: 0 }] }; y += 26; continue; }
      if (s.kind === "else") { frames[s.blk].labels.push({ y: y - 4, text: s.label, br: s.br }); y += 26; continue; }
      if (s.kind === "end") { frames[s.blk].y1 = y - 4; y += 16; continue; }
      if (s.kind === "msg") {
        n++;
        const cls = `am-edge${s.dashed ? " am-edge--dashed" : ""}`;
        const marker = ` marker-end="url(#${id}-arrow)"`;
        const stepNo = (yy) => (num ? `<text class="am-step" x="${f(xs[s.a] + (s.b >= s.a ? 6 : -6))}" y="${f(yy)}" text-anchor="${s.b >= s.a ? "start" : "end"}">${n}</text>` : "");
        if (s.a === s.b) {
          const x = xs[s.a];
          parts.push(s.lines.map((l, i) => `<text x="${f(x + 40)}" y="${f(y + i * LH + 4)}" dominant-baseline="central">${esc(l)}</text>`).join(""));
          parts.push(`<path class="${cls}" d="M${f(x)},${f(y)} H${f(x + 30)} V${f(y + 20)} H${f(x + 2)}"${marker}/>`, stepNo(y + s.lines.length * LH - 6));
          y += Math.max(s.lines.length * LH, 20) + 28;
        } else {
          y += s.lines.length * LH;
          const [x1, x2] = [xs[s.a], xs[s.b]];
          parts.push(s.lines.map((l, i) => `<text x="${f((x1 + x2) / 2)}" y="${f(y - 10 - (s.lines.length - 1 - i) * LH)}" text-anchor="middle">${esc(l)}</text>`).join(""));
          parts.push(`<path class="${cls}" d="M${f(x1)},${f(y)} L${f(x2 + (x2 > x1 ? -2 : 2))},${f(y)}"${marker}/>`, stepNo(y - 6));
          y += 24;
        }
        const from = res.get(s.from).node?.id ?? "", to = res.get(s.to).node?.id ?? "";
        body.push(`<g class="ak-sq-step"${br(s)} data-step="${k++}" data-kind="msg" data-n="${n}" data-from="${esc(s.from)}" data-to="${esc(s.to)}" data-from-node="${esc(from)}" data-to-node="${esc(to)}" data-label="${esc(s.label)}">${parts.join("")}</g>`);
      } else if (s.kind === "note") {
        const xo = s.over.map((p) => xs[idx.get(p)]);
        const lo = Math.min(...xo), hi = Math.max(...xo);
        const w = Math.max(s.w, hi - lo + 40), h = s.lines.length * LH + 12, cx = (lo + hi) / 2;
        body.push(`<g class="ak-sq-step"${br(s)} data-step="${k++}" data-kind="note" data-label="${esc(s.text)}"><rect class="am-note" x="${f(cx - w / 2)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="2"/>${textLines(s.lines, cx, y + h / 2, ' font-size="12"')}</g>`);
        y += h + 16;
      } else {
        const w = Math.max(...s.lines.map((l) => measure(l, 12))) + 20;
        body.push(`<g class="ak-sq-step"${br(s)} data-step="${k++}" data-kind="divider" data-label="${esc(s.text)}"><line class="am-lifeline" x1="${MARGIN}" y1="${f(y + 10)}" x2="${f(width - MARGIN)}" y2="${f(y + 10)}"/><rect class="am-actor" x="${f(width / 2 - w / 2)}" y="${f(y)}" width="${f(w)}" height="20" rx="2"/>${textLines(s.lines.slice(0, 1), width / 2, y + 10, ' font-size="12"')}</g>`);
        y += 34;
      }
    }
    const height = y + 6;
    // Frames for what-if blocks: a dashed box with a tab per branch ("if …", "else …").
    const frameSvg = frames.map((fr, b) => {
      const x0 = MARGIN / 2, x1 = width - MARGIN / 2;
      const tabs = fr.labels.map((l, i) => {
        const t = `${i === 0 ? "if" : "else"} ${l.text}`;
        const w = t.length * 6.7 + 16; // mono 11px
        return `<g class="ak-sq-branch" data-blk="${b}" data-br="${l.br}">${i ? `<line class="ak-sq-sep" x1="${f(x0)}" y1="${f(l.y)}" x2="${f(x1)}" y2="${f(l.y)}"/>` : ""}<rect class="ak-sq-tab" x="${f(x0)}" y="${f(l.y)}" width="${f(w)}" height="18"/><text class="ak-sq-tabt" x="${f(x0 + 8)}" y="${f(l.y + 9)}" dominant-baseline="central">${esc(t)}</text></g>`;
      }).join("");
      return `<g class="ak-sq-frame" data-blk="${b}"><rect class="ak-sq-box" x="${f(x0)}" y="${f(fr.y0)}" width="${f(x1 - x0)}" height="${f(fr.y1 - fr.y0)}"/>${tabs}</g>`;
    }).join("");
    const actors = ps.map((p, i) => {
      const x = xs[i];
      const node = res.get(p).node;
      const tech = node?.tech ? ` tech tech-${String(node.tech).replace(/[^a-z0-9-]/g, "")}` : "";
      const cls = node ? ` ak-part--linked k-${esc(node.kind)}${tech}` : "";
      const box = `<rect class="am-actor" x="${f(x - actorW[i] / 2)}" y="${TOP}" width="${f(actorW[i])}" height="${ACTOR_H}" rx="2"/>${textLines([p], x, TOP + ACTOR_H / 2)}`;
      const href = node ? (node.children?.length ? `#/map/${encodeURIComponent(node.id)}` : `#/map/${encodeURIComponent(node.parent ?? "")}?sel=${encodeURIComponent(node.id)}`) : "";
      const inner = href ? `<a href="${href}">${box}</a>` : box;
      return `<g class="ak-part${cls}" data-p="${esc(p)}"${node ? ` data-node="${esc(node.id)}"` : ""}><line class="am-lifeline" x1="${f(x)}" y1="${TOP + ACTOR_H}" x2="${f(x)}" y2="${f(height - 4)}"/>${inner}</g>`;
    });
    const svg = `<svg viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" width="${Math.ceil(width)}" height="${Math.ceil(height)}" role="img" aria-label="Sequence: ${esc(ps.join(", "))}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="am-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>${frameSvg}${actors.join("")}${body.join("")}</svg>`;
    const warn = missing.length ? `<figcaption class="ak-sq-warn">Not in architecture.yaml: ${esc(missing.join(", "))}</figcaption>` : "";
    const segs = Array.from({ length: k }, (_, i) => `<button type="button" class="ak-sq-seg" data-sq-seg="${i + 1}" aria-label="Step ${i + 1}"><i></i></button>`).join("");
    // Scenario chips: one group per what-if block; the first branch is the default.
    const scen = blocks.length
      ? `<div class="ak-sq-scen">${blocks.map((b) => `<span class="ak-sq-scen-g">${b.labels.map((l, i) => `<button type="button" class="ak-sq-scen-b${i ? "" : " on"}" data-sq-blk="${b.id}" data-sq-br="${i}">${esc(l)}</button>`).join("")}</span>`).join("")}</div>`
      : "";
    const controls = play
      ? `${scen}<div class="ak-sq-bar"><button type="button" class="ak-sq-btn" data-sq="play" aria-label="Pause"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="i-pause" d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z"/><path class="i-play" d="M5 3l8 5-8 5z"/></svg></button><div class="ak-sq-segs">${segs}</div><span class="ak-sq-count">0/${k}</span><button type="button" class="ak-sq-speed" data-sq="speed" aria-label="Speed">1.5×</button>${[...res.values()].filter((r) => r.node).length >= 2 ? `<button type="button" class="ak-sq-map" data-sq="map" title="Replay these steps on the architecture map">on map ›</button>` : ""}</div><div class="ak-sq-caption" aria-live="polite">&nbsp;</div>`
      : "";
    return `<figure class="am-diagram am-seq ak-seq${play ? " ak-seq--play is-paused" : ""}${blocks.length ? " has-alt" : ""}"${play ? ' tabindex="0" data-sq-player' : ""}>${controls}${svg}${warn}</figure>`;
  },
};
