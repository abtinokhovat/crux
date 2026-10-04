// Decision-focused components: decision, options, compare, proscons, tradeoff, stats, adr.
// Every component: { name, summary, syntax, example, render(text, { args, uid, md, mdInline, esc, ComponentError, ctx }) }.
import YAML from "yaml";
import { optionCards } from "./option-cards.mjs";

const lines = (text) =>
  String(text)
    .split("\n")
    .map((t, i) => ({ t: t.trim(), line: i + 1 }))
    .filter((l) => l.t && !l.t.startsWith("//"));

export const decision = {
  name: "decision",
  summary: "Bold decision hero: what we decided, in one line",
  syntax: "```decision [accepted|proposed|open|rejected] [label]\nOne-line decision (bold headline)\n\nOptional detail paragraphs (markdown).\n```",
  example: "```decision accepted\nUse Kafka-protocol broker for all cross-service events.\n\nKey records by conversation to keep order.\n```",
  render(text, { args, md, esc, ComponentError, ctx }) {
    const [first = "", ...restArgs] = args.split(/\s+/).filter(Boolean);
    const known = ctx.cfg?.statuses ?? {};
    const status = known[first.toLowerCase()] ? first.toLowerCase() : ctx.adr?.statusKey ?? "proposed";
    const label = (known[first.toLowerCase()] ? restArgs.join(" ") : args).trim() || "Decision";
    const [head, ...more] = String(text).trim().split(/\n\s*\n/);
    if (!head) throw new ComponentError("decision needs a one-line headline", 1);
    return `<div class="ak-hero ak-hero--decision ak-st-${esc(status)}"><div class="ak-hero-label">${esc(label)}</div><div class="ak-hero-text">${md(head)}</div>${more.length ? `<div class="ak-hero-more am-md">${md(more.join("\n\n"))}</div>` : ""}</div>`;
  },
};

export const options = {
  name: "options",
  summary: "Option cards (chosen / possible / rejected) with pros, cons and optional scores",
  syntax: `\`\`\`options [title]
- name: Kafka
  verdict: ok            # ok = chosen, warn = possible, no = rejected
  pros: [Ordered partitions, Replay]
  cons: [One more cluster]
  cost: High             # any other key becomes a labeled field
\`\`\``,
  example: "```options Broker\n- name: Kafka\n  verdict: ok\n  pros: [Replay, Ordering]\n  cons: [Ops cost]\n- name: RabbitMQ\n  verdict: no\n  cons: [No replay]\n```",
  render(text, { args, ComponentError }) {
    let data;
    try {
      data = YAML.parse(text);
    } catch (err) {
      throw new ComponentError(`options: YAML error: ${err.message}`, err.linePos?.[0]?.line ?? 1);
    }
    if (!Array.isArray(data) || !data.length) throw new ComponentError("options needs a YAML list of { name, verdict, pros, cons }", 1);
    const items = data.map((o, i) => {
      if (!o?.name) throw new ComponentError(`option ${i + 1} has no name`, 1);
      const verdict = String(o.verdict ?? (o.chosen ? "ok" : "info")).split(/\s+/);
      const fields = Object.entries(o)
        .filter(([k]) => !["name", "verdict", "chosen", "key", "topic"].includes(k))
        .map(([k, v]) => ({
          label: k[0].toUpperCase() + k.slice(1),
          role: /^pros?$/i.test(k) ? "pro" : /^cons?$/i.test(k) ? "con" : "info",
          text: Array.isArray(v) ? v.map((s) => String(s).replace(/\.?$/, ".")).join(" ") : String(v),
        }));
      return { key: o.key ?? null, name: String(o.name), topic: o.topic ?? null, verdict: { kind: verdict[0], label: verdict.slice(1).join(" ") }, fields };
    });
    return optionCards(items, { title: args });
  },
};

// Weighted criteria matrix. Header: Criterion | weight? | Option A | Option B …
export const compare = {
  name: "compare",
  summary: "Weighted scoring matrix: heatmap plus ranked totals, winner in bold",
  syntax: `\`\`\`compare [max=5]
Criterion   | weight | Kafka | NATS | Postgres
Ordering    | 3      | 5     | 3    | 4
Ops load    | 2      | 1     | 4    | 5
\`\`\`
- weight column is optional (default 1). Scores are 0..max.
- Append a note after a score with a space: "4 managed only".`,
  example: "```compare\nCriterion | weight | A | B\nSpeed | 2 | 5 | 3\nCost | 1 | 2 | 5\n```",
  render(text, { args, esc, ComponentError }) {
    const max = Number(args.match(/max=(\d+)/)?.[1] ?? 5);
    const rows = lines(text).map((l) => ({ ...l, cells: l.t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()) }));
    const body = rows.filter((r) => !/^:?-{2,}/.test(r.cells[0]));
    if (body.length < 2) throw new ComponentError("compare needs a header row and at least one criterion row", 1);
    const head = body[0].cells;
    const wcol = head.findIndex((h, i) => i > 0 && /^(w|weight)$/i.test(h));
    const optCols = head.map((h, i) => i).filter((i) => i > 0 && i !== wcol);
    const crit = body.slice(1).map((r) => {
      const w = wcol >= 0 ? Number(r.cells[wcol]) : 1;
      if (Number.isNaN(w)) throw new ComponentError(`weight "${r.cells[wcol]}" is not a number`, r.line);
      return {
        name: r.cells[0],
        w,
        scores: optCols.map((c) => {
          const m = String(r.cells[c] ?? "").match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
          if (!m) throw new ComponentError(`score "${r.cells[c] ?? ""}" for ${head[c]} is not a number`, r.line);
          return { v: Number(m[1]), note: m[2] };
        }),
      };
    });
    const wsum = crit.reduce((s, c) => s + c.w, 0) || 1;
    const totals = optCols.map((_, j) => crit.reduce((s, c) => s + c.w * c.scores[j].v, 0) / (wsum * max));
    const best = Math.max(...totals);
    const cell = (s) => {
      const r = Math.max(0, Math.min(1, s.v / max));
      return `<td class="ak-cmp-cell" style="--r:${r.toFixed(3)}"><b>${esc(String(s.v))}</b>${s.note ? `<small>${esc(s.note)}</small>` : ""}</td>`;
    };
    const table = `<div class="am-table-wrap"><table class="ak-cmp"><thead><tr><th>Criterion</th>${wcol >= 0 ? "<th>Weight</th>" : ""}${optCols
      .map((c, j) => `<th class="${totals[j] === best ? "ak-win" : ""}">${esc(head[c])}</th>`)
      .join("")}</tr></thead><tbody>${crit
      .map((c) => `<tr><th>${esc(c.name)}</th>${wcol >= 0 ? `<td class="ak-cmp-w">${"●".repeat(Math.min(c.w, 5))}<span>${c.w}</span></td>` : ""}${c.scores.map(cell).join("")}</tr>`)
      .join("")}</tbody></table></div>`;
    const ranked = optCols.map((c, j) => ({ name: head[c], v: totals[j] })).sort((a, b) => b.v - a.v);
    const bars = `<div class="ak-bars">${ranked
      .map((o) => `<div class="ak-bar${o.v === best ? " ak-win" : ""}"><span class="ak-bar-name">${esc(o.name)}</span><span class="ak-bar-track"><span style="width:${(o.v * 100).toFixed(1)}%"></span></span><span class="ak-bar-val">${Math.round(o.v * 100)}</span></div>`)
      .join("")}</div>`;
    return `<div class="ak-compare">${table}<div class="ak-compare-side"><div class="ak-mini-label">Weighted score (0–100)</div>${bars}</div></div>`;
  },
};

export const proscons = {
  name: "proscons",
  summary: "Two-column pros and cons; ~ lines are neutral notes",
  syntax: "```proscons [title]\n+ a benefit\n- a cost\n~ a neutral note\n```",
  example: "```proscons Redpanda\n+ Single binary\n+ Kafka API\n- Smaller community\n```",
  render(text, { args, mdInline, esc, ComponentError }) {
    const pro = [], con = [], neu = [];
    for (const { t, line } of lines(text)) {
      const m = t.match(/^([+\-~])\s*(.*)$/);
      if (!m) throw new ComponentError(`proscons line must start with +, - or ~: "${t}"`, line);
      ({ "+": pro, "-": con, "~": neu })[m[1]].push(m[2]);
    }
    const col = (cls, label, icon, list) =>
      list.length ? `<div class="ak-cq ak-cq--${cls}"><div class="ak-cq-head"><i>${icon}</i>${label}<b>${list.length}</b></div><ul>${list.map((s) => `<li>${mdInline(s)}</li>`).join("")}</ul></div>` : "";
    return `${args ? `<div class="ak-options-title">${esc(args)}</div>` : ""}<div class="ak-cqs">${col("pos", "Pros", "+", pro)}${col("neg", "Cons", "−", con)}${col("other", "Notes", "~", neu)}</div>`;
  },
};

export const tradeoff = {
  name: "tradeoff",
  summary: "Sliders that show where the decision sits between two poles",
  syntax: "```tradeoff\nSimplicity <-> Scale | 0.3 | we lean simple for v1\nBuild <-> Buy | 0.8\n```\n- Position 0 = left pole, 1 = right pole.",
  example: "```tradeoff\nConsistency <-> Availability | 0.25 | per-conversation order matters\n```",
  render(text, { esc, mdInline, ComponentError }) {
    const rows = lines(text).map(({ t, line }) => {
      const m = t.match(/^(.+?)\s*<->\s*(.+?)\s*\|\s*([\d.]+)\s*(?:\|\s*(.*))?$/);
      if (!m) throw new ComponentError(`tradeoff line should be "Left <-> Right | 0.3 | note": "${t}"`, line);
      const pos = Math.max(0, Math.min(1, Number(m[3])));
      return `<div class="ak-trade"><div class="ak-trade-poles"><span class="${pos <= 0.5 ? "ak-lean" : ""}">${esc(m[1])}</span><span class="${pos >= 0.5 ? "ak-lean" : ""}">${esc(m[2])}</span></div><div class="ak-trade-track"><i style="left:${(pos * 100).toFixed(1)}%"></i></div>${m[4] ? `<div class="ak-trade-note">${mdInline(m[4])}</div>` : ""}</div>`;
    });
    return `<div class="ak-trades">${rows.join("")}</div>`;
  },
};

export const stats = {
  name: "stats",
  summary: "Big number tiles for key figures (load, latency, cost)",
  syntax: "```stats\n500 msg/s | Peak inbound | assumption\n32 | Partitions per topic\n```",
  example: "```stats\n500/s | Peak inbound\n7 d | Raw retention\n```",
  render(text, { esc, mdInline, ComponentError }) {
    const tiles = lines(text).map(({ t, line }) => {
      const [value, label, note] = t.split("|").map((s) => s.trim());
      if (!label) throw new ComponentError(`stats line should be "value | label | note": "${t}"`, line);
      return `<div class="ak-stat"><div class="ak-stat-v">${esc(value)}</div><div class="ak-stat-l">${mdInline(label)}</div>${note ? `<div class="ak-stat-n">${mdInline(note)}</div>` : ""}</div>`;
    });
    return `<div class="ak-stats">${tiles.join("")}</div>`;
  },
};

export const adrCards = {
  name: "adr",
  summary: "Embedded cards for other ADRs (status, decision, link)",
  syntax: "```adr\n0004\n0007 why this matters here\n```",
  example: "```adr\n0001\n```",
  render(text, { esc, ComponentError, ctx }) {
    const cards = lines(text).map(({ t, line }) => {
      const [, n, note] = t.match(/^(?:\w+-)?(\d+)\s*(.*)$/) ?? [];
      if (!n) throw new ComponentError(`adr line must start with a number: "${t}"`, line);
      const id = n.padStart(ctx.cfg?.digits ?? 4, "0");
      const a = ctx.store?.byId.get(id);
      if (!a) throw new ComponentError(`ADR ${id} does not exist`, line);
      const gist = a.facts.decision ?? a.facts.recommendation ?? a.facts.question ?? a.subtitle;
      return `<a class="ak-card ak-st-${a.statusKey}" href="#/adr/${id}" data-ref="${id}"><span class="ak-card-id">${esc(ctx.cfg.prefix)}-${id}</span><span class="ak-pill">${esc(a.status)}</span><strong>${esc(a.title)}</strong>${gist ? `<span class="ak-card-gist">${esc(gist)}</span>` : ""}${note ? `<em>${esc(note)}</em>` : ""}</a>`;
    });
    return `<div class="ak-cards">${cards.join("")}</div>`;
  },
};
