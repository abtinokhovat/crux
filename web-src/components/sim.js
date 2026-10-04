// Sim: a queue under load. A burst of inflow, a steady outflow, optional merging (many inbound
// messages answered by one send), and a deadline. The app draws the backlog over time, animates
// it, and lets the reader move the sliders.

const DUR = { s: 1, sec: 1, min: 60, m: 60, h: 3600, hour: 3600, d: 86400, day: 86400 };
const RATE = { s: 1, sec: 1, min: 1 / 60, m: 1 / 60, h: 1 / 3600 };

function duration(text, line, ComponentError) {
  const m = String(text).trim().match(/^([\d.]+)\s*([a-z]+)$/i);
  if (!m || !DUR[m[2].toLowerCase()]) throw new ComponentError(`sim: "${text}" is not a duration like 30 min or 1 h`, line);
  return Number(m[1]) * DUR[m[2].toLowerCase()];
}
function rate(text, line, ComponentError) {
  const m = String(text).trim().match(/^([\d.]+)\s*\/\s*([a-z]+)$/i);
  if (!m || !RATE[m[2].toLowerCase()]) throw new ComponentError(`sim: "${text}" is not a rate like 500 /s or 20 /min`, line);
  return Number(m[1]) * RATE[m[2].toLowerCase()];
}

export const sim = {
  name: "sim",
  summary: "Queue simulation: burst inflow vs steady outflow, backlog chart with sliders and a deadline",
  syntax: `\`\`\`sim [title]
inflow: 500 /s for 1 h, then 20 /s     ← burst rate and length, then the base rate
outflow: 80 /s
merge: 1                              ← optional: inbound messages per send (slider 1–10)
deadline: 24 h | reply window          ← optional: the longest acceptable wait
horizon: 8 h                           ← optional: chart length (default: until drained)
\`\`\``,
  example: "```sim Black Friday\ninflow: 500 /s for 1 h, then 20 /s\noutflow: 80 /s\ndeadline: 24 h | reply window\n```",
  render(text, { args, esc, ComponentError }) {
    const cfg = {};
    String(text).split("\n").forEach((raw, i) => {
      const t = raw.trim();
      if (!t || t.startsWith("//")) return;
      const m = t.match(/^(\w+)\s*:\s*(.+)$/);
      if (!m) throw new ComponentError(`sim: "${t}" must be "key: value"`, i + 1);
      const [k, v] = [m[1].toLowerCase(), m[2].trim()];
      if (k === "inflow") {
        const p = v.match(/^(.+?)\s+for\s+(.+?)(?:,\s*then\s+(.+))?$/i);
        if (!p) throw new ComponentError(`sim: inflow must be "500 /s for 1 h, then 20 /s"`, i + 1);
        cfg.peak = rate(p[1], i + 1, ComponentError);
        cfg.burst = duration(p[2], i + 1, ComponentError);
        cfg.base = p[3] ? rate(p[3], i + 1, ComponentError) : 0;
      } else if (k === "outflow") cfg.out = rate(v, i + 1, ComponentError);
      else if (k === "merge") cfg.merge = Number(v) || 1;
      else if (k === "deadline") {
        const [d, label = "deadline"] = v.split("|").map((s) => s.trim());
        cfg.deadline = duration(d, i + 1, ComponentError);
        cfg.deadlineLabel = label;
      } else if (k === "horizon") cfg.horizon = duration(v, i + 1, ComponentError);
      else throw new ComponentError(`sim: unknown key "${k}" (inflow, outflow, merge, deadline, horizon)`, i + 1);
    });
    if (cfg.peak == null || cfg.out == null) throw new ComponentError("sim needs inflow and outflow", 1);
    const data = { merge: 1, base: 0, ...cfg };
    const slider = (key, label, min, max, step, value, unit) =>
      `<label class="ak-sim-s"><span>${esc(label)}</span><input type="range" data-sim-k="${key}" min="${min}" max="${max}" step="${step}" value="${value}"><b data-sim-v="${key}"></b><i>${esc(unit)}</i></label>`;
    const sliders = [
      slider("peak", "Burst inflow", 0, Math.max(10, Math.ceil(data.peak * 2)), Math.max(1, Math.round(data.peak / 50)), data.peak, "/s"),
      slider("burst", "Burst length", 60, Math.max(3600, data.burst * 3), 60, data.burst, ""),
      slider("out", "Outflow", 1, Math.max(10, Math.ceil(data.out * 3)), 1, data.out, "/s"),
      slider("merge", "Messages per send", 1, 10, 0.5, data.merge, "×"),
    ].join("");
    return `<figure class="ak-sim" data-sim='${esc(JSON.stringify(data))}' tabindex="0">
${args.trim() ? `<figcaption class="ak-sim-title">${esc(args.trim())}</figcaption>` : ""}
<div class="ak-sim-sliders">${sliders}</div>
<div class="ak-sim-out"></div>
<div class="ak-sim-chart"></div>
</figure>`;
  },
};
