// Option cards shared by the Options-table upgrade and the `options` component.
import { esc, mdInline } from "../am.mjs";

function sentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// decided=false (draft, open, in review): the ok row is a leaning, not a choice.
export function optionCards(items, { title, decided = true } = {}) {
  const groups = [];
  for (const it of items) {
    const g = groups.find((x) => x.topic === it.topic) ?? groups[groups.push({ topic: it.topic, items: [] }) - 1];
    g.items.push(it);
  }
  const order = { ok: 0, warn: 1, info: 2, no: 3 };
  const card = (o) => {
    const v = o.verdict.kind;
    const badge = (decided ? { ok: "Chosen", warn: "Possible", no: "Rejected" } : { ok: "Leaning", warn: "Possible", no: "Unlikely" })[v] ?? "Option";
    const label = o.verdict.label ? ` · ${esc(o.verdict.label)}` : "";
    const fields = o.fields
      .map((f) => {
        const parts = sentences(f.text);
        const icon = f.role === "pro" ? "+" : f.role === "con" ? "−" : "";
        const list = parts.length > 1 || icon
          ? `<ul class="ak-opt-list ak-opt-list--${f.role}">${parts.map((s) => `<li>${icon ? `<i>${icon}</i>` : ""}<span>${mdInline(s)}</span></li>`).join("")}</ul>`
          : `<p>${mdInline(f.text)}</p>`;
        return `<div class="ak-opt-field"><div class="ak-opt-flabel">${esc(f.label)}</div>${list}</div>`;
      })
      .join("");
    return `<article class="ak-opt ak-opt--${v}${decided ? "" : " ak-opt--undecided"}"><header><span class="ak-opt-badge">${badge}${label}</span>${o.key ? `<span class="ak-opt-key">${esc(o.key)}</span>` : ""}<h3>${mdInline(o.name)}</h3></header>${fields}</article>`;
  };
  return `<div class="ak-options">${title ? `<div class="ak-options-title">${esc(title)}</div>` : ""}${groups
    .map((g) => {
      const sorted = [...g.items].sort((a, b) => (order[a.verdict.kind] ?? 2) - (order[b.verdict.kind] ?? 2));
      const head = g.topic ? `<div class="ak-options-topic">${mdInline(g.topic)}</div>` : "";
      return `${head}<div class="ak-options-grid">${sorted.map(card).join("")}</div>`;
    })
    .join("")}</div>`;
}
