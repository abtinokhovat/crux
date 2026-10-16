// Client-side full-text search over ADRs and docs, plus the ⌘K palette.
import { $, S, esc, gist, href, label, pill } from "./util.js";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const tokens = (q) => norm(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

let cache = { site: null, docs: [] };
function docs() {
  if (cache.site === S.site) return cache.docs;
  cache = {
    site: S.site,
    docs: [...S.byId.values()].map((a) => ({
      item: a,
      f: [
        [norm(a.id + " " + label(a)), 8],
        [norm(a.title), 6],
        [norm(a.tags.join(" ") + " " + a.components.join(" ")), 4],
        [norm(a.subtitle + " " + (gist(a).text ?? "")), 3],
        [norm(a.sections.map((s) => s.title).join(" ")), 2],
        [norm(a.text), 1],
      ],
    })),
  };
  return cache.docs;
}

export function search(q, limit = 20) {
  const qt = tokens(q);
  if (!qt.length) return [];
  const out = [];
  for (const d of docs()) {
    let score = 0;
    let all = true;
    for (const t of qt) {
      let best = 0;
      for (const [text, w] of d.f) {
        const i = text.indexOf(t);
        if (i === -1) continue;
        const word = i === 0 || /[^\p{L}\p{N}]/u.test(text[i - 1]);
        best = Math.max(best, w * (word ? 1.5 : 1));
      }
      if (!best) { all = false; break; }
      score += best;
    }
    if (all) out.push({ item: d.item, score: score + (d.item.kind === "adr" ? 0.5 : 0) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function snippet(a, q) {
  const qt = tokens(q);
  const text = a.text ?? "";
  const lower = norm(text);
  let at = -1;
  for (const t of qt) { const i = lower.indexOf(t); if (i !== -1 && (at === -1 || i < at)) at = i; }
  const g = gist(a).text ?? a.subtitle ?? "";
  const raw = at === -1 ? g : (at > 50 ? "…" : "") + text.slice(Math.max(0, at - 50), at + 130) + "…";
  let html = esc(raw);
  for (const t of qt.sort((x, y) => y.length - x.length)) html = html.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>");
  return html;
}

export function openSearch(initial = "") {
  if ($(".ak-palette")) return;
  const wrap = document.createElement("div");
  wrap.className = "ak-palette";
  wrap.innerHTML = `<div class="ak-palette-box" role="dialog" aria-label="Search"><input placeholder="Search titles, decisions, tags, full text…" value="${esc(initial)}" aria-label="Search"><div class="ak-results" role="listbox"></div><div class="ak-palette-foot"><span>↑↓ move</span><span>↵ open</span><span>⇧↵ all results</span><span>esc close</span></div></div>`;
  document.body.append(wrap);
  const input = wrap.querySelector("input");
  const box = wrap.querySelector(".ak-results");
  let hits = [];
  let sel = 0;
  const paint = () => {
    const q = input.value;
    hits = q.trim() ? search(q, 30) : [...S.site.adrs].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8).map((item) => ({ item }));
    sel = Math.min(sel, Math.max(0, hits.length - 1));
    box.innerHTML = hits.length
      ? hits.map(({ item: a }, i) => `<a class="ak-result ak-st-${esc(a.statusKey)}${i === sel ? " on" : ""}" href="${href(a)}" role="option"><span class="mono">${esc(label(a))}</span><strong>${esc(a.title)}</strong>${pill(a)}<span class="snip">${snippet(a, q)}</span></a>`).join("")
      : `<div class="ak-empty">No match. Try fewer words.</div>`;
    box.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  };
  const close = () => wrap.remove();
  input.addEventListener("input", () => { sel = 0; paint(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, hits.length - 1); paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === "Enter") {
      if (e.shiftKey) location.hash = `#/search?q=${encodeURIComponent(input.value)}`;
      else if (hits[sel]) location.hash = href(hits[sel].item).slice(1);
      close();
    } else if (e.key === "Escape") close();
  });
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("a")) close(); });
  paint();
  input.focus();
}
