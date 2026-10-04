// Renders an ADR body to HTML panels. Reuses the answer-me-with-html components
// (flow, sequence, tree, timeline, kv, callout, limits, annot), adds decision-
// focused components, upgrades known panels (Decision, Options, Consequences…)
// into visual blocks, highlights code, and links ADR references.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import hljs from "highlight.js/lib/common";
import { COMPONENTS, ComponentError, HOOKS, esc, marked, md, mdInline, renderBlocks } from "./am.mjs";
import { optionsFromTable, parseAdr, parseTable, verdictOf } from "./parse.mjs";
import { BUILTIN } from "./components/index.mjs";
import { optionCards } from "./components/option-cards.mjs";

// ── code highlighting ────────────────────────────────────────────────
const LANG_ALIAS = { golang: "go", sh: "bash", shell: "bash", zsh: "bash", yml: "yaml", ts: "typescript", js: "javascript", py: "python", rs: "rust", kt: "kotlin", proto: "protobuf", tf: "hcl", dockerfile: "dockerfile" };
for (const [lang, mod] of Object.entries({ protobuf: "protobuf", dockerfile: "dockerfile", hcl: "hcl", nginx: "nginx", haskell: "haskell", elixir: "elixir", scala: "scala", clojure: "clojure", powershell: "powershell", erlang: "erlang", dart: "dart" })) {
  try {
    hljs.registerLanguage(lang, (await import(`highlight.js/lib/languages/${mod}`)).default);
  } catch {}
}

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

let projectSig = "";
let projectCss = "";
export const projectComponents = [];

export async function loadProjectComponents(cfg) {
  const dir = cfg.abs(cfg.components);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(m?js)$/.test(f)).sort() : [];
  const sig = files.map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`).join(",");
  if (sig === projectSig) return projectComponents;
  projectSig = sig;
  for (const c of projectComponents.splice(0)) COMPONENTS.delete(c.name);
  for (const c of BUILTIN) register(c, "builtin");
  const css = [];
  for (const f of files) {
    const url = `${pathToFileURL(join(dir, f)).href}?v=${statSync(join(dir, f)).mtimeMs}`;
    try {
      const mod = await import(url);
      const list = [].concat(mod.default ?? [], ...Object.values(mod).filter((v) => v !== mod.default && v?.render));
      for (const c of list) {
        if (register(c, f)) {
          projectComponents.push({ name: c.name, summary: c.summary ?? "", file: f });
          if (c.css) css.push(`/* ${f} · ${c.name} */\n${c.css}`);
        }
      }
    } catch (err) {
      projectComponents.push({ name: `(error in ${f})`, summary: err.message, file: f, error: true });
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
          out.push(optionCards(opts));
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
    return text.replace(re, (all, n) => {
      const id = String(n).padStart(cfg.digits, "0");
      const a = store?.byId.get(id);
      if (!a) return all;
      return `<a class="ak-ref ak-st-${a.statusKey}" href="#/adr/${id}" data-ref="${id}" title="${esc(a.title)} · ${esc(a.status)}">${all}</a>`;
    });
  });
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
export function renderAdr(adr, store, cfg) {
  ctx.adr = adr;
  ctx.store = store;
  ctx.cfg = cfg;
  rctx = { seq: 0, stats: { components: {} } };
  const parsed = parseAdr(adr.source);
  escapeBlocks(parsed.intro);
  for (const p of parsed.panels) escapeBlocks(p.blocks);
  const intro = parsed.intro.length ? `<div class="am-intro am-md">${rb(parsed.intro)}</div>` : "";
  const errors = [];
  const panels = parsed.panels.map((p) => {
    let body;
    try {
      body = enhancePanel(p, adr) ?? rb(p.blocks);
    } catch (err) {
      errors.push({ panel: p.title, message: err.message, line: (err.line ?? 0) + parsed.bodyLine });
      body = `<div class="ak-error"><b>Render error</b> in “${esc(p.title)}”: ${esc(err.message)}${err.example ? `<pre>${esc(err.example)}</pre>` : ""}</div>`;
    }
    const cls = /^(decision|question|recommend)/i.test(p.title) ? " ak-panel--hero" : "";
    const span = Math.max(1, Math.min(Number(p.attrs.span) || 3, 3));
    return `<section class="am-panel ak-panel${cls}" id="panel-${esc(p.id)}" data-title="${esc(p.title)}" data-span="${span}"${Number(p.attrs.rows) > 1 ? ` data-rows="${Number(p.attrs.rows)}"` : ""}>
<header class="am-panel-head"><span class="am-panel-id">${esc(p.id)}</span><h2>${esc(p.title)}</h2>${(p.attrs.meta || autoMeta(p)) ? `<span class="am-panel-meta">${esc(p.attrs.meta || autoMeta(p))}</span>` : ""}</header>
<div class="am-panel-body">${body}</div>
</section>`;
  });
  const html = linkRefs(intro + panels.join("\n"), store, cfg);
  ctx.adr = null;
  return { html, errors };
}
