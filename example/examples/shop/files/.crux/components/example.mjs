// Project component example. Any *.mjs in .adr/components/ is loaded by `adr serve`/`adr build`
// (hot-reloaded on save). Use it in an ADR as a fenced block:
//
//   ```risks
//   Broker outage      | 2 | 5 | ingest buffer in relay
//   Partition hot spot | 3 | 3
//   ```
//
// render(text, helpers) returns HTML. helpers = { args, uid, md, mdInline, esc, highlight,
// ComponentError, ctx: { adr, store, cfg } }. Throw ComponentError(msg, line) for author errors;
// the UI shows them inline and `adr lint` reports them.
// Use the theme tokens (--paper, --ink, --line-2, --accent, --warn, --err, --ak-green…) so
// light/dark and both themes work.

export default {
  name: "risks",
  summary: "Likelihood × impact risk matrix (1–5) with mitigations",
  syntax: "```risks\nRisk | likelihood 1-5 | impact 1-5 | mitigation\n```",
  example: "```risks\nBroker outage | 2 | 5 | relay spool\n```",
  css: `
.x-risk { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 16px; align-items: start; }
.x-risk-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 3px; aspect-ratio: 1; }
.x-risk-grid div { border-radius: 2px; display: grid; place-items: center; font: 700 11px var(--font-mono); color: var(--ink); }
.x-risk ol { margin: 0; padding-left: 20px; font-size: 13.5px; }
.x-risk li + li { margin-top: 4px; }
.x-risk small { color: var(--ink-2); }
@media (max-width: 640px) { .x-risk { grid-template-columns: minmax(0, 1fr); } }`,
  render(text, { esc, ComponentError }) {
    const rows = text.split("\n").map((l, i) => [l.trim(), i + 1]).filter(([l]) => l).map(([l, line]) => {
      const [name, lk, im, note = ""] = l.split("|").map((s) => s.trim());
      const L = Number(lk), I = Number(im);
      if (!(L >= 1 && L <= 5 && I >= 1 && I <= 5)) throw new ComponentError(`likelihood and impact must be 1–5: "${l}"`, line);
      return { name, L, I, note };
    });
    const cells = [];
    for (let i = 5; i >= 1; i--) for (let l = 1; l <= 5; l++) {
      const here = rows.map((r, k) => (r.L === l && r.I === i ? k + 1 : null)).filter(Boolean);
      const heat = (l * i) / 25;
      const bg = heat > 0.5 ? "var(--err-bg)" : heat > 0.2 ? "var(--warn-bg)" : "var(--fill)";
      cells.push(`<div style="background:${bg};${here.length ? "outline:2px solid var(--ink)" : ""}">${here.join(",")}</div>`);
    }
    return `<div class="x-risk"><div><div class="x-risk-grid">${cells.join("")}</div><small>↑ impact · likelihood →</small></div><ol>${rows.map((r) => `<li><b>${esc(r.name)}</b> <small>L${r.L} × I${r.I}</small>${r.note ? `<br><small>${esc(r.note)}</small>` : ""}</li>`).join("")}</ol></div>`;
  },
};
