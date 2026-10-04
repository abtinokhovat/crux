// Card components: rules (if → then, colored by outcome) and arch (component cards in columns).
// Tone marks, same as tree: + ok (green), ! warn (amber), - err (red), * highlight (accent).

const MARKS = { "*": "hi", "+": "ok", "!": "warn", "-": "err" };
const toneOf = (t) => (MARKS[t[0]] && t.length > 1 ? { tone: MARKS[t[0]], rest: t.slice(1).trim() } : { tone: "", rest: t });
const toneCls = (tone) => (tone ? ` ak-tone-${tone}` : "");
const lines = (text) =>
  String(text)
    .split("\n")
    .map((raw, i) => ({ raw, t: raw.trim(), line: i + 1 }))
    .filter((l) => l.t && !l.t.startsWith("//"));

export const rules = {
  name: "rules",
  summary: "If → then rule cards, colored by outcome",
  syntax: `\`\`\`rules [title]
+ Condition => Action          ← green
! Condition => Action | note   ← amber
- Condition => Action          ← red
Condition => Action            ← neutral
\`\`\`
- "=>" (or "→") splits condition and action. "| note" adds a gray note under the action.`,
  example: "```rules\n+ Provider returns a message ID => Set sent\n! Timeout after the body => Wait 30 s for an echo | then send again\n- Closed window => Failed + reason\n```",
  render(text, { args, mdInline, esc, ComponentError }) {
    const rows = lines(text).map(({ t, line }) => {
      const { tone, rest } = toneOf(t);
      const m = rest.split(/\s*(?:=>|→)\s*/);
      if (m.length < 2) throw new ComponentError(`rules line needs "condition => action": "${t}"`, line);
      const [cond, ...act] = m;
      const [action, ...note] = act.join(" → ").split("|").map((s) => s.trim());
      return `<li class="ak-rule${toneCls(tone)}"><div class="ak-rule-if"><span>IF</span>${mdInline(cond)}</div><div class="ak-rule-then"><span>THEN</span><b>${mdInline(action)}</b>${note.length ? `<small>${mdInline(note.join(" | "))}</small>` : ""}</div></li>`;
    });
    if (!rows.length) throw new ComponentError("rules needs at least one line", 1);
    const title = args.trim() ? `<div class="ak-rules-title">${esc(args.trim())}</div>` : "";
    return `<div class="ak-rules">${title}<ul>${rows.join("")}</ul></div>`;
  },
};

export const arch = {
  name: "arch",
  summary: "Component cards in columns (groups), with roles, details and ADR links",
  syntax: `\`\`\`arch [flow]
# Group
Component | runs as · ADR-0001
  detail line
  detail line
*Highlighted component | meta
# Next group
+Healthy component
\`\`\`
- "# Name" starts a column. A line without indent is a card; indented lines are its details.
- "flow" draws → between columns (left to right).`,
  example: "```arch flow\n# Receive\n*inbox-inbound | role · ADR-0028\n  Verify, split, write\n# Queue\nRedpanda | 3 brokers\n  inbox.raw.v1\n```",
  render(text, { args, mdInline, esc, ComponentError }) {
    const groups = [];
    let card = null;
    for (const { raw, t, line } of lines(text)) {
      if (t.startsWith("#")) {
        groups.push({ name: t.replace(/^#+\s*/, ""), cards: [] });
        card = null;
        continue;
      }
      if (!groups.length) groups.push({ name: "", cards: [] });
      const indented = /^\s/.test(raw);
      if (indented) {
        if (!card) throw new ComponentError(`arch detail line has no card above it: "${t}"`, line);
        card.details.push(t);
        continue;
      }
      const { tone, rest } = toneOf(t);
      const [title, ...meta] = rest.split("|").map((s) => s.trim());
      card = { title, meta: meta.join(" | "), tone, details: [] };
      groups.at(-1).cards.push(card);
    }
    if (!groups.some((g) => g.cards.length)) throw new ComponentError("arch needs at least one card", 1);
    const flow = /\bflow\b/.test(args);
    const cardHtml = (c) =>
      `<div class="ak-arch-card${toneCls(c.tone)}"><div class="ak-arch-title">${mdInline(c.title)}</div>${c.meta ? `<div class="ak-arch-meta">${mdInline(c.meta)}</div>` : ""}${c.details.length ? `<ul>${c.details.map((d) => `<li>${mdInline(d)}</li>`).join("")}</ul>` : ""}</div>`;
    const cols = groups.map(
      (g) => `<div class="ak-arch-col">${g.name ? `<div class="ak-arch-group">${esc(g.name)}</div>` : ""}${g.cards.map(cardHtml).join("")}</div>`,
    );
    const body = flow ? cols.join('<div class="ak-arch-arrow" aria-hidden="true">→</div>') : cols.join("");
    return `<div class="ak-arch${flow ? " ak-arch--flow" : ""}" style="--n: ${groups.length}">${body}</div>`;
  },
};
