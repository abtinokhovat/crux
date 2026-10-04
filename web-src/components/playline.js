// Playline: a time axis with events and ranges, and a playhead that runs across it.
// Events light up as the playhead passes them; the newest passed event shows as the caption.

const MARKS = { "*": "hi", "+": "ok", "!": "warn", "-": "err" };

export const playline = {
  name: "playline",
  summary: "Time axis with events and ranges; an animated playhead walks through them",
  syntax: `\`\`\`playline [unit]
0 | Token issued
30 | +Refresh | ig_refresh_token        ← tone marks: + ok, ! warn, - err, * highlight
50-60 | !Reconnect window                ← a range
60 | -Token expires
\`\`\`
- "at | label | note". The unit (e.g. days, h, s) labels the axis and the playhead.`,
  example: "```playline days\n0 | Issued\n30 | +Refresh\n55 | !Ask to reconnect\n60 | -Expires\n```",
  render(text, { args, mdInline, esc, ComponentError }) {
    const unit = args.trim();
    const items = [];
    String(text).split("\n").forEach((raw, i) => {
      const t = raw.trim();
      if (!t || t.startsWith("//")) return;
      const [at, rawLabel = "", ...note] = t.split("|").map((s) => s.trim());
      const m = at.match(/^(-?[\d.]+)(?:\s*-\s*(-?[\d.]+))?$/);
      if (!m) throw new ComponentError(`playline: "${t}" must start with a number or a range like 30-60`, i + 1);
      const tone = MARKS[rawLabel[0]] && rawLabel.length > 1 ? MARKS[rawLabel[0]] : "";
      items.push({ from: Number(m[1]), to: m[2] != null ? Number(m[2]) : null, label: tone ? rawLabel.slice(1).trim() : rawLabel, note: note.join(" | "), tone });
    });
    if (!items.length) throw new ComponentError("playline needs at least one line", 1);
    const lo = Math.min(...items.map((x) => x.from)), hi = Math.max(...items.map((x) => x.to ?? x.from));
    const span = hi - lo || 1;
    const pct = (v) => `${(((v - lo) / span) * 100).toFixed(2)}%`;
    const ranges = items.filter((x) => x.to != null).map((x) => `<div class="ak-pl-range${x.tone ? ` ak-tone-${x.tone}` : ""}" data-pl-at="${x.from}" style="left:${pct(x.from)};width:calc(${pct(x.to)} - ${pct(x.from)})" title="${esc(x.label)}"></div>`).join("");
    const events = items
      .map((x, i) => `<div class="ak-pl-ev${x.tone ? ` ak-tone-${x.tone}` : ""}${i % 2 ? " is-down" : ""}${x.to != null ? " is-range" : ""}" data-pl-at="${x.from}" data-pl-label="${esc(x.label)}" data-pl-note="${esc(x.note)}" style="left:${pct(x.from)}"><i></i><span><b>${esc(String(x.from))}${x.to != null ? `–${esc(String(x.to))}` : ""}${unit ? ` ${esc(unit)}` : ""}</b>${mdInline(x.label)}</span></div>`)
      .join("");
    return `<figure class="ak-pl" data-playline data-lo="${lo}" data-hi="${hi}" data-unit="${esc(unit)}" tabindex="0">
<div class="ak-pl-bar"><button type="button" class="ak-sq-btn" data-pl="play" aria-label="Play"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="i-pause" d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z"/><path class="i-play" d="M5 3l8 5-8 5z"/></svg></button><span class="ak-pl-now">${esc(String(lo))}${unit ? ` ${esc(unit)}` : ""}</span><span class="ak-pl-what">&nbsp;</span></div>
<div class="ak-pl-track">${ranges}<div class="ak-pl-axis"></div>${events}<div class="ak-pl-head" style="left:0%"></div></div>
</figure>`;
  },
};
