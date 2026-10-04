// Renders an ADR body to HTML panels. Reuses the answer-me-with-html components
// (flow, sequence, tree, timeline, kv, callout, limits, annot), adds decision-
// focused components, upgrades known panels (Decision, Options, Consequences…)
// into visual blocks, highlights code, and links ADR references.
import hljs from "highlight.js/lib/common";
import protobuf from "highlight.js/lib/languages/protobuf";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import nginx from "highlight.js/lib/languages/nginx";
import elixir from "highlight.js/lib/languages/elixir";
import scala from "highlight.js/lib/languages/scala";
import dart from "highlight.js/lib/languages/dart";
import powershell from "highlight.js/lib/languages/powershell";
import { COMPONENTS, ComponentError, HOOKS, esc, marked, md, mdInline, renderBlocks } from "./am.js";
import { optionsFromTable, parseAdr, parseTable, verdictOf } from "./parse.js";
import { BUILTIN } from "./components/index.js";
import { optionCards } from "./components/option-cards.js";

// ── code highlighting ────────────────────────────────────────────────
const LANG_ALIAS = { golang: "go", sh: "bash", shell: "bash", zsh: "bash", yml: "yaml", ts: "typescript", js: "javascript", py: "python", rs: "rust", kt: "kotlin", proto: "protobuf", tf: "hcl", dockerfile: "dockerfile" };
for (const [lang, mod] of Object.entries({ protobuf, dockerfile, nginx, elixir, scala, dart, powershell })) hljs.registerLanguage(lang, mod);

export function highlight(text, lang = "") {
  const name = LANG_ALIAS[lang] ?? lang;
  let html;
  if (name && hljs.getLanguage(name)) html = hljs.highlight(text, { language: name, ignoreIllegals: true }).value;
  else html = esc(text);
  const label = name || "text";
  return `<figure class="ak-code"><figcaption><span>${esc(label)}</span><button type="button" class="ak-copy" data-copy>Copy</button></figcaption><pre><code class="hljs language-${esc(label)}">${html}</code></pre></figure>`;
}

HOOKS.code = (text, lang) => highlight(text, lang);
marked.use({
  renderer: {
    code(token, maybeLang) {
      const text = typeof token === "object" ? token.text : token;
      const lang = (typeof token === "object" ? token.lang : maybeLang) ?? "";
      return highlight(text, String(lang).split(/\s+/)[0].toLowerCase());
    },
  },
});

// ── components: built-in + project ───────────────────────────────────
export const ctx = { adr: null, store: null, cfg: null };
const helpers = { md, mdInline, esc, highlight, ComponentError, ctx };

function register(c, origin) {
  if (!c?.name || typeof c.render !== "function") return false;
  const render = c.render;
  COMPONENTS.set(c.name, { summary: "", syntax: "", example: "", ...c, origin, render: (text, opts) => render(text, { ...opts, ...helpers }) });
  return true;
}
for (const c of BUILTIN) register(c, "builtin");

let projectCss = "";
export const projectComponents = [];

// Project components: [{ file, url }] served by crux from .crux/components/*.mjs. Loaded once per change.
export async function loadProjectComponents(list = []) {
  for (const c of projectComponents.splice(0)) COMPONENTS.delete(c.name);
  for (const c of BUILTIN) register(c, "builtin");
  const css = [];
  for (const { file, url } of list) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      const comps = [].concat(mod.default ?? [], ...Object.values(mod).filter((v) => v !== mod.default && v?.render));
      for (const c of comps) {
        if (register(c, file)) {
          projectComponents.push({ name: c.name, summary: c.summary ?? "", file });
          if (c.css) css.push(`/* ${file} · ${c.name} */\n${c.css}`);
        }
      }
    } catch (err) {
      projectComponents.push({ name: `(error in ${file})`, summary: err.message, file, error: true });
    }
  }
  projectCss = css.join("\n\n");
  return projectComponents;
}

export const componentsCss = () => projectCss;
// The bundled answer-me-with-html docs are Chinese; show English one-liners in the app/CLI.
const EN = {
  callout: ["Conclusion / note / warning bar", "```callout <info|ok|warn|err> [title]\nbody (markdown)\n```"],
  kv: ["Key-value grid / title block", "```kv [cols=2]\nKey: value\n* Wide key: value\n```"],
  timeline: ["Timeline of phases or history", "```timeline [v]\nwhen | title | text\n*when | highlighted | text\n```"],
  annot: ["Annotate parts of one sentence", "```annot\n# heading | note\n[fragment]{note} and [bad]{!red note}\n> caption\n```"],
  tree: ["Hierarchy: org chart or indented list", "```tree [list]\nRoot\n  Child | note\n    Leaf\n```"],
  limits: ["Values against limits as bars", "```limits\nLabel | 13 / 20 | unit\nLabel | max 20\n```"],
  sequence: ["Sequence diagram between participants", "```sequence [num]\nA -> B: request\nB --> A: response\nnote A, B: text\n== phase ==\n```"],
  flow: ["Flowchart / architecture diagram (auto layout)", "```flow [LR]\nA -> B: label\nA --> C\nA -> B & C\n{decision?} (start) [(database)] *highlight\ngroup Name: A, B\n```"],
};
export const listComponents = () =>
  [...COMPONENTS.values()].map((c) => {
    const en = !c.origin && EN[c.name];
    return { name: c.name, summary: en ? en[0] : c.summary, origin: c.origin ?? "answer-me-with-html", syntax: en ? en[1] : c.syntax, example: c.example };
  });

const UNDECIDED = new Set(["draft", "open", "review"]);

// ── panel enhancers ──────────────────────────────────────────────────
// One render context per page so diagram ids (SVG markers) stay unique.
let rctx = { seq: 0, stats: { components: {} } };
const rb = (blocks) => renderBlocks(blocks, rctx);
const mdBlocks = (p) => p.blocks.filter((b) => b.type === "md");
const firstFence = (p, lang) => p.blocks.find((b) => b.type === "fence" && b.lang === lang);
const rest = (p, ...skip) => p.blocks.filter((b) => !skip.includes(b));

function heroHtml(kind, label, callout, status) {
  const text = callout.text;
  const [head, ...more] = text.trim().split(/\n\s*\n/);
  const title = callout.args.replace(/^(info|ok|warn|err)\s*/, "").trim() || label;
  return `<div class="ak-hero ak-hero--${kind}${status && kind === "decision" ? ` ak-st-${status}` : ""}"><div class="ak-hero-label">${esc(title)}</div><div class="ak-hero-text">${md(head)}</div>${more.length ? `<div class="ak-hero-more am-md">${md(more.join("\n\n"))}</div>` : ""}</div>`;
}

const CONSEQ = [
  { re: /^(positive|pro|benefit|good|gains?)\b[^:]*:\s*/i, key: "pos", label: "Positive" },
  { re: /^(negative|cost|cons?|downside|trade-?off|risk)s?\b[^:]*:\s*/i, key: "neg", label: "Costs we accept" },
  { re: /^(follow-?ups?|next|todo|action)s?\b[^:]*:\s*/i, key: "next", label: "Follow-ups" },
];

function consequencesHtml(text) {
  const items = text.split("\n").map((l) => l.match(/^\s{0,3}[-*+]\s+(.*)$/)?.[1]).filter(Boolean);
  if (!items.length) return null;
  const groups = { pos: [], neg: [], next: [], other: [] };
  let hits = 0;
  for (const it of items) {
    const c = CONSEQ.find((c) => c.re.test(it));
    if (c) hits++;
    (c ? groups[c.key] : groups.other).push(c ? it.replace(c.re, "") : it);
  }
  if (hits < Math.ceil(items.length / 2)) return null;
  const col = (key, label, icon) =>
    groups[key].length ? `<div class="ak-cq ak-cq--${key}"><div class="ak-cq-head"><i>${icon}</i>${label}<b>${groups[key].length}</b></div><ul>${groups[key].map((s) => `<li>${mdInline(s)}</li>`).join("")}</ul></div>` : "";
  return `<div class="ak-cqs">${col("pos", "Positive", "+")}${col("neg", "Costs we accept", "−")}${col("next", "Follow-ups", "→")}${col("other", "Other", "·")}</div>`;
}

function numberedCards(text, cls, label) {
  const items = text.split("\n").map((l) => l.match(/^\s{0,3}(?:\d+[.)]|[-*+])\s+(.*)$/)?.[1]).filter(Boolean);
  if (!items.length) return null;
  return `<ol class="${cls}">${items.map((s, i) => `<li><span class="ak-n">${i + 1}</span><div>${mdInline(s)}</div>${label ? `<em>${label}</em>` : ""}</li>`).join("")}</ol>`;
}

function enhancePanel(p, adr) {
  const t = p.title.toLowerCase();
  const st = adr?.statusKey;
  const callout = firstFence(p, "callout");

  if (/^decision\b/.test(t) && callout) return heroHtml("decision", "Decision", callout, st) + rb(rest(p, callout));
  if (/^question\b/.test(t) && callout) return heroHtml("question", "Decision to make", callout, st) + rb(rest(p, callout));
  if (/^recommend/.test(t) && callout) return heroHtml("rec", "Recommendation", callout, st) + rb(rest(p, callout));

  if (/^options?\b/.test(t)) {
    const out = [];
    let done = false;
    for (const b of p.blocks) {
      if (b.type === "md" && !done) {
        const table = parseTable(b.text);
        const opts = optionsFromTable(table);
        if (opts) {
          done = true;
          const [before, after] = splitAroundTable(b.text);
          if (before.trim()) out.push(`<div class="am-md">${md(before)}</div>`);
          out.push(optionCards(opts, { decided: !UNDECIDED.has(adr?.statusKey) }));
          out.push(`<details class="ak-raw"><summary>Show as table</summary><div class="am-md">${md(labelVerdicts(tableText(b.text)))}</div></details>`);
          if (after.trim()) out.push(`<div class="am-md">${md(after)}</div>`);
          continue;
        }
      }
      out.push(rb([b]));
    }
    return out.join("\n");
  }

  if (/^consequences?/.test(t) && mdBlocks(p).length === 1) {
    const html = consequencesHtml(mdBlocks(p)[0].text);
    if (html) return rb(p.blocks.filter((b) => b.type !== "md")) + html;
  }
  if (/questions?\b.*(user|you)|^open questions/.test(t) && mdBlocks(p).length === 1) {
    const html = numberedCards(mdBlocks(p)[0].text, "ak-questions", "needs answer");
    if (html) return html;
  }
  if (/criteria/.test(t) && mdBlocks(p).length === 1) {
    const html = numberedCards(mdBlocks(p)[0].text, "ak-criteria");
    if (html) return html;
  }
  return null;
}

// "ok" alone in a cell becomes "ok Chosen" so the ✓ badge carries a word, like a spec table.
const VERDICT_WORD = { ok: "Chosen", no: "Rejected", warn: "Possible" };
function labelVerdicts(table) {
  return table.replace(/\|\s*(ok|no|warn)\s*(?=\|)/g, (m, w) => `| ${w} ${VERDICT_WORD[w]} `);
}

// Right-hand panel meta, computed from the content when the author gave none.
function autoMeta(p) {
  const t = p.title.toLowerCase();
  const text = p.blocks.filter((b) => b.type === "md").map((b) => b.text).join("\n");
  const items = (re) => text.split("\n").filter((l) => re.test(l)).length;
  if (/^options?\b/.test(t)) {
    const opts = optionsFromTable(parseTable(text));
    if (opts) {
      const n = (k) => opts.filter((o) => o.verdict.kind === k).length;
      return [`${opts.length} options`, n("ok") && `${n("ok")} chosen`, n("warn") && `${n("warn")} possible`, n("no") && `${n("no")} rejected`].filter(Boolean).join(" · ");
    }
  }
  if (/^consequences?/.test(t)) {
    const c = (re) => items(new RegExp(`^\\s*[-*+]\\s+${re}`, "i"));
    const pos = c("(positive|pro|benefit)"), neg = c("(negative|cost|cons?|risk|downside)"), next = c("(follow-?ups?|next|todo)");
    if (pos + neg + next) return [pos && `${pos} +`, neg && `${neg} −`, next && `${next} →`].filter(Boolean).join(" · ");
  }
  const n = items(/^\s*(\d+[.)]|[-*+])\s+/);
  if (!n) return "";
  if (/questions?\b.*(user|you)|^open questions/.test(t)) return `${n} to answer`;
  if (/criteria/.test(t)) return `${n} criteria`;
  if (/^context/.test(t)) return `${n} facts`;
  return "";
}

function splitAroundTable(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l, i) => l.trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? ""));
  let end = start;
  while (end < lines.length && lines[end].trim().startsWith("|")) end++;
  return [lines.slice(0, start).join("\n"), lines.slice(end).join("\n")];
}
function tableText(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l, i) => l.trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? ""));
  let end = start;
  while (end < lines.length && lines[end].trim().startsWith("|")) end++;
  return lines.slice(start, end).join("\n");
}

// ── reference linking ────────────────────────────────────────────────
function linkRefs(html, store, cfg) {
  const re = new RegExp(`\\b${cfg.prefix}[-\\s]?(\\d{1,6})\\b`, "g");
  let depth = { a: 0, svg: 0, code: 0 };
  return html.replace(/(<[^>]+>)|([^<]+)/g, (m, tag, text) => {
    if (tag) {
      const t = tag.match(/^<(\/?)(a|svg|code|pre|textarea)\b/i);
      if (t) depth[t[2].toLowerCase() === "pre" || t[2].toLowerCase() === "textarea" ? "code" : t[2].toLowerCase()] += t[1] ? -1 : 1;
      if (/^<a\s/i.test(tag)) return rewriteHref(tag, cfg);
      return tag;
    }
    if (depth.a > 0 || depth.svg > 0 || depth.code > 0) return text;
    const linked = text.replace(re, (all, n) => {
      const id = String(n).padStart(cfg.digits, "0");
      const a = store?.byId.get(id);
      if (!a) return all;
      return `<a class="ak-ref ak-st-${a.statusKey}" href="#/adr/${id}" data-ref="${id}" title="${esc(a.title)} · ${esc(a.status)}">${all}</a>`;
    });
    // Badges and glossary only touch text, never the attributes of the links just added.
    return linked.replace(/(<[^>]+>)|([^<]+)/g, (m, tag, t) => tag ?? badges(glossary(t, cfg)));
  });
}

// "(U)" / "(assumption)" / bare "[V]" in prose → small badges.
function badges(text) {
  return text
    .replace(/\(U\)/g, '<span class="ak-badge ak-badge--u" title="Unverified: confirm before relying on it">unverified</span>')
    .replace(/\(assumption\)/gi, '<span class="ak-badge ak-badge--u" title="Assumption: not measured or sourced">assumption</span>')
    .replace(/\[V\]/g, '<span class="ak-badge ak-badge--v" title="Verified in a primary source">✓ verified</span>');
}
// [V](url) → a linked "verified" badge.
function sourceBadges(html) {
  return html.replace(/<a ([^>]*)>V<\/a>/g, '<a $1 class="ak-badge ak-badge--v" title="Verified in a primary source — open it">✓ source</a>');
}
// cfg.glossary {term: definition}: first use of each term per document gets a hover definition.
let seenTerms = new Set();
function glossary(text, cfg) {
  const g = cfg?.glossary;
  if (!g) return text;
  for (const [term, def] of Object.entries(g)) {
    if (seenTerms.has(term)) continue;
    const re = new RegExp(`(^|[^\\w-])(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w-])`);
    if (!re.test(text)) continue;
    seenTerms.add(term);
    text = text.replace(re, (m, pre, t) => `${pre}<abbr class="ak-term" title="${esc(def)}">${t}</abbr>`);
  }
  return text;
}

function rewriteHref(tag, cfg) {
  return tag.replace(/href="([^"]*)"/, (m, href) => {
    if (/^(https?:|mailto:|#)/.test(href)) return m;
    const adr = href.match(/(?:^|\/)(\d{1,6})-[\w.-]+\.(?:md|html)(#.*)?$/);
    if (adr) return `href="#/adr/${adr[1].padStart(cfg.digits, "0")}" data-ref="${adr[1].padStart(cfg.digits, "0")}"`;
    return m;
  });
}

// "<svc>" or "v<N>" in prose is a placeholder, not HTML: show it as text.
const HTML_TAGS = new Set("a abbr b br code del details div em hr i img kbd li mark ol p pre s small span strong sub summary sup table tbody td th thead tr u ul blockquote h1 h2 h3 h4 h5 h6 figure figcaption iframe video audio source picture svg path g rect circle line text".split(" "));
function escapePlaceholders(text) {
  return String(text).replace(/(`+)[\s\S]*?\1|<\/?([A-Za-z][\w-]*)[^>]*>/g, (m, tick, tag) => (tick || HTML_TAGS.has(String(tag).toLowerCase()) ? m : m.replace(/</g, "&lt;").replace(/>/g, "&gt;")));
}
function escapeBlocks(blocks) {
  for (const b of blocks) if (b.type === "md" || (b.type === "fence" && ["callout", "decision"].includes(b.lang))) b.text = escapePlaceholders(b.text);
}

// ── public ───────────────────────────────────────────────────────────
// forShare: the snapshot reviewers see — no local-only controls, no "from Claude" marks.
export function renderAdr(adr, store, cfg, { forShare = false } = {}) {
  ctx.adr = adr;
  ctx.store = store;
  ctx.cfg = cfg;
  rctx = { seq: 0, stats: { components: {} } };
  const parsed = parseAdr(adr.source);
  escapeBlocks(parsed.intro);
  for (const p of parsed.panels) escapeBlocks(p.blocks);
  const intro = parsed.intro.length ? `<div class="am-intro am-md">${rb(parsed.intro)}</div>` : "";
  const errors = [];
  const built = parsed.panels.map((p) => {
    let body;
    try {
      body = enhancePanel(p, adr) ?? rb(p.blocks);
    } catch (err) {
      errors.push({ panel: p.title, message: err.message, line: (err.line ?? 0) + parsed.bodyLine });
      body = `<div class="ak-error"><b>Render error</b> in “${esc(p.title)}”: ${esc(err.message)}${err.example ? `<pre>${esc(err.example)}</pre>` : ""}</div>`;
    }
    // {fold}: collapsed by default; the header stays visible.
    if (p.attrs.fold) body = `<details class="ak-fold"><summary>Show ${esc(p.title.toLowerCase())}</summary>${body}</details>`;
    return { p, body };
  });
  const sectionHtml = ({ p, body }) => {
    const claude = !forShare && p.attrs.from === "claude";
    const cls = (/^(decision|question|recommend)/i.test(p.title) ? " ak-panel--hero" : "") + (claude ? " ak-panel--claude" : "");
    const span = Math.max(1, Math.min(Number(p.attrs.span) || 3, 3));
    return `<section class="am-panel ak-panel${cls}" id="panel-${esc(p.id)}" data-title="${esc(p.title)}" data-span="${span}"${Number(p.attrs.rows) > 1 ? ` data-rows="${Number(p.attrs.rows)}"` : ""}>
<header class="am-panel-head"><span class="am-panel-id">${esc(p.id)}</span><h2>${esc(p.title)}</h2>${(p.attrs.meta || autoMeta(p)) && !claude ? `<span class="am-panel-meta">${esc(p.attrs.meta || autoMeta(p))}</span>` : ""}${claude ? `<span class="ak-claude-bar">FROM YOUR CLAUDE <button type="button" data-keep="${esc(p.title)}">Keep</button><button type="button" class="drop" data-drop="${esc(p.title)}">Drop</button></span>` : ""}</header>
<div class="am-panel-body">${body}</div>
</section>`;
  };
  // {tab=Group}: consecutive panels with the same group become one panel with tabs (CSS only).
  const panels = [];
  for (let i = 0; i < built.length; ) {
    const group = built[i].p.attrs.tab;
    if (!group || group === true) { panels.push(sectionHtml(built[i++])); continue; }
    const run = [];
    while (i < built.length && built[i].p.attrs.tab === group) run.push(built[i++]);
    const name = `ak-tabs-${++rctx.seq}`;
    const first = run[0].p;
    const inputs = run.map((r, k) => `<input type="radio" name="${name}" id="${name}-${k}" class="ak-tab-input"${k === 0 ? " checked" : ""}>`).join("");
    const labels = run.map((r, k) => `<label for="${name}-${k}" class="ak-tab-label">${esc(r.p.title)}</label>`).join("");
    const bodies = run.map((r) => `<div class="ak-tab-body" id="panel-${esc(r.p.id)}" data-title="${esc(r.p.title)}">${r.body}</div>`).join("");
    panels.push(`<section class="am-panel ak-panel ak-tabs" data-title="${esc(String(group))}" data-span="3">
<header class="am-panel-head"><span class="am-panel-id">${esc(first.id)}</span><h2>${esc(String(group))}</h2></header>
<div class="am-panel-body">${inputs}<div class="ak-tab-bar">${labels}</div>${bodies}</div>
</section>`);
  }
  seenTerms = new Set();
  const html = linkRefs(sourceBadges(intro + panels.join("\n")), store, cfg);
  ctx.adr = null;
  return { html, errors };
}
