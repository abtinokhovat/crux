// crux single-page app: router, overview, decision list, ADR page, tags, components.
import { $, $$, S, ancestors, esc, gist, href, index, label, nodeChip, optionStats, pill, refChip, statusLabel, statusOrder, tagChip, toast } from "./util.js";
import { renderGraph } from "./graph.js";
import { renderMap } from "./map.js";
import { openSearch, search } from "./search.js";
import { archTree, areaBars, history, panel, register, sheet, statusCell, titleBlock } from "./blueprint.js";
import { bindFlow, finalizeHtml, flowStrip, openNewQuestion, privacy, sharePanel, shareOf, teamHtml } from "./flow.js";
import { componentsCss, listComponents, loadProjectComponents, renderAdr, themeCss } from "./vendor/crux-render.js";

// Theme tokens come from the renderer (answer-me-with-html themes), so the page and the
// rendered ADRs always agree.
document.head.insertAdjacentHTML("afterbegin", `<style id="crux-theme">${themeCss()}</style>`);

const view = $("#view");
let cleanup = null;

// ── data ─────────────────────────────────────────────────
async function loadSite() {
  const site = await (await fetch("api/site", { cache: "no-store" })).json();
  index(site);
  S.docCache.clear();
  document.title = site.title;
  $("#brand-title").textContent = site.title;
  $("#nav-count").textContent = site.adrs.length;
  injectStatusCss(site.statuses);
  $("#new-q")?.classList.toggle("hidden", !site.local);
  // project components (.crux/components/*.mjs) run in the browser, next to the built-in ones
  const sig = JSON.stringify(site.projectComponents ?? []);
  if (sig !== loadSite.sig) {
    loadSite.sig = sig;
    await loadProjectComponents(site.projectComponents ?? []);
    let el = $("#crux-components");
    if (!el) document.head.append((el = Object.assign(document.createElement("style"), { id: "crux-components" })));
    el.textContent = componentsCss();
  }
  site.components = listComponents();
  return site;
}

// The backend sends markdown; the page renders it with the same renderer reviewers use.
async function loadDoc(id) {
  if (!S.docCache.has(id)) S.docCache.set(id, fetch(`api/doc/${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)));
  const doc = await S.docCache.get(id);
  if (!doc) return null;
  const { html, errors } = renderAdr({ ...doc.meta, source: doc.source }, { byId: S.byId }, { prefix: S.site.prefix, digits: S.site.digits ?? 4, statuses: S.site.statuses, glossary: S.site.glossary, arch: S.site.architecture });
  return { ...doc, html, errors };
}

// Statuses are configurable; map each to a palette color.
function injectStatusCss(statuses) {
  const color = { ok: ["--ak-green", "--ak-green-bg"], info: ["--accent", "--accent-bg"], warn: ["--warn", "--warn-bg"], err: ["--err", "--err-bg"], mute: ["--ak-mute", "--ak-mute-bg"], purple: ["--ak-purple", "--ak-purple-bg"] };
  const css = Object.entries(statuses)
    .map(([k, s]) => {
      const [c, bg] = color[s.color] ?? [];
      return c ? `.ak-st-${k}{--st:var(${c});--st-bg:var(${bg})}` : s.color ? `.ak-st-${k}{--st:${s.color};--st-bg:color-mix(in srgb, ${s.color} 14%, var(--paper))}` : "";
    })
    .join("\n");
  let el = $("#ak-status-css");
  if (!el) document.head.append((el = Object.assign(document.createElement("style"), { id: "ak-status-css" })));
  el.textContent = css;
}

// ── router ───────────────────────────────────────────────
function parseHash() {
  const h = location.hash.slice(1) || "/";
  const [path, qs = ""] = h.split("?");
  return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs) };
}

const ROUTES = {
  "": home,
  list,
  adr: (p, q) => docPage(p[1], q),
  doc: (p, q) => docPage(p.slice(1).join("/"), q),
  graph: (p, q) => mountCanvas("graph", q),
  map: (p, q) => mountCanvas("map", q, p[1]),
  tags,
  tag: (p) => tagPage(p[1]),
  components,
  search: (p, q) => searchPage(q.get("q") ?? ""),
};

async function route({ keepScroll = false } = {}) {
  const { parts, q } = parseHash();
  const name = parts[0] ?? "";
  const fn = ROUTES[name] ?? notFound;
  for (const a of $$("#nav a")) a.toggleAttribute("aria-current", a.dataset.route === (name || "home") || (name === "adr" && a.dataset.route === "list") || (name === "tag" && a.dataset.route === "tags"));
  for (const a of $$("#nav a[aria-current]")) a.setAttribute("aria-current", "page");
  cleanup?.();
  cleanup = null;
  const y = scrollY;
  const out = await fn(parts, q);
  if (typeof out === "string") view.innerHTML = out;
  if (keepScroll) scrollTo(0, y);
  else if (!location.hash.includes("#panel-")) scrollTo(0, 0);
}

const notFound = () => `<div class="ak-empty">Nothing here. <a href="#/">Back to overview</a></div>`;

// ── overview ─────────────────────────────────────────────
function home() {
  const { adrs, docs, tags, problems } = S.site;
  const order = statusOrder();
  const counts = Object.fromEntries(order.map((k) => [k, adrs.filter((a) => a.statusKey === k).length]));
  const open = adrs.filter((a) => ["draft", "open", "review"].includes(a.statusKey)).sort((a, b) => ["review", "open", "draft"].indexOf(a.statusKey) - ["review", "open", "draft"].indexOf(b.statusKey));
  const qs = open.reduce((n, a) => n + (a.facts.questions?.length ?? 0), 0);

  const kpis = [`<a class="ak-kpi ak-kpi--total" href="#/list"><div class="ak-kpi-v">${adrs.length}</div><div class="ak-kpi-l">Decisions</div></a>`]
    .concat(order.filter((k) => counts[k]).map((k) => `<a class="ak-kpi ak-st-${k}" href="#/list?status=${k}"><div class="ak-kpi-v">${counts[k]}</div><div class="ak-kpi-l">${esc(statusLabel(k))}</div></a>`))
    .join("");
  const stack = order.filter((k) => counts[k]).map((k) => `<span class="ak-st-${k}" style="flex:${counts[k]}" title="${esc(statusLabel(k))}: ${counts[k]}"></span>`).join("");
  const legend = order.filter((k) => counts[k]).map((k) => `<span><i class="ak-dot ak-st-${k}"></i>${esc(statusLabel(k))} · ${Math.round((counts[k] / adrs.length) * 100)}%</span>`).join("");

  const needs = open.length
    ? open
        .slice(0, 6)
        .map((a) => {
          const g = gist(a);
          const n = a.facts.questions.length;
          return `<a class="ak-need ak-st-${a.statusKey}" href="${href(a)}"><div class="ak-need-top"><span class="mono">${esc(label(a))}</span>${a.statusKey !== "open" ? pill(a) : ""}${a.due ? `<span class="mono dim" style="font-size:11px">due ${esc(a.due)}</span>` : ""}${n ? `<span class="ak-qcount">${n} question${n > 1 ? "s" : ""}</span>` : ""}</div><h3>${esc(a.title)}</h3><p>${g.kind === "recommendation" ? "<b>Leaning:</b> " : ""}${esc(g.text)}</p></a>`;
        })
        .join("") + (open.length > 6 ? `<a class="ak-more" href="#/list?status=open">+${open.length - 6} more open decisions →</a>` : "")
    : `<div class="ak-empty">No open questions. Every decision has an owner.</div>`;

  const latest = [...adrs].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const tblock = titleBlock(
    [
      { label: "Title", value: S.site.title, wide: true },
      { label: "Records", value: `${adrs.length} ADRs${docs.length ? ` · ${docs.length} docs` : ""}` },
      { label: "Waiting", value: `${open.length} open · ${qs} questions` },
      { label: "Links", value: `${S.site.edges.length} connections` },
      { label: "Tags", value: `${Object.keys(tags).length}` },
      { label: "Components", value: S.site.architecture ? `${Object.keys(S.site.architecture.nodes).length}` : "—" },
      { label: "Last change", value: latest?.date || "—" },
    ],
    2,
  );

  const tagEntries = Object.entries(tags).filter(([, ids]) => ids.length).sort((a, b) => b[1].length - a[1].length);
  const max = Math.max(1, ...tagEntries.map(([, ids]) => ids.length));
  const cloud = tagEntries.length
    ? `<div class="ak-cloud">${tagEntries.map(([t, ids]) => `<a href="#/tag/${encodeURIComponent(t)}" style="font-size:${(12 + (ids.length / max) * 11).toFixed(1)}px">#${esc(t)}<sup>${ids.length}</sup></a>`).join("")}</div>`
    : `<div class="ak-empty">No tags yet. Add <code>tags: [kafka, messaging]</code> to an ADR's frontmatter.</div>`;

  const probs = problems.length ? panel("!", `Problems (${problems.length})`, `<ul class="ak-problems">${problems.map((p) => `<li><code>${esc(p.file)}</code> — ${esc(p.message)}</li>`).join("")}</ul>`, { meta: "adr lint", span: 3, flush: true }) : "";
  const byNum = [...adrs].sort((a, b) => a.num - b.num);

  const grid = [
    panel("A", "Needs a decision", needs, { meta: `${open.length} open · ${qs} questions`, span: 2, flush: true }),
    `<div class="ak-stackcol">${panel("B", "Title block", tblock, { cls: "am-panel--bare" })}${panel("C", "Decisions by area", areaBars(order) || `<div class="ak-empty">Link ADRs to components to see this.</div>`, { meta: "status mix" })}</div>`,
    panel("D", "Decision register", register(byNum), { meta: `${adrs.length} records`, span: 3, flush: true }),
    panel("E", "Architecture", archTree(), { meta: `<a href="#/map">open map →</a>`, span: 2 }),
    panel("F", "History", history(adrs, 3), { meta: "by date" }),
    panel("G", "Tags", cloud, { meta: `${tagEntries.length} tags`, span: 3 }),
    probs,
  ].join("\n");

  return `<div class="ak-page-head"><div><h1>${esc(S.site.title)}</h1><p>${adrs.length} decisions${docs.length ? ` · ${docs.length} docs` : ""} · ${open.length} waiting for a decision</p></div><a class="ak-btn" href="#/graph">Open graph →</a></div>
<section style="margin-bottom:22px"><div class="ak-kpis">${kpis}</div><div class="ak-stack">${stack}</div><div class="ak-legend">${legend}</div></section>
${sheet(`<div class="ak-sheet-grid">${grid}</div>`)}`;
}

// ── decision list ────────────────────────────────────────
function decisionCard(a) {
  const g = gist(a);
  const os = optionStats(a);
  const optbar = os.items.length ? `<span class="ak-optbar" title="${os.ok.length} chosen · ${os.warn.length} possible · ${os.no.length} rejected">${os.items.map((o) => `<i class="${o.verdict.kind}"></i>`).join("")}</span>` : "";
  const q = a.facts?.questions?.length ? `<span class="ak-qcount">${a.facts.questions.length} q</span>` : "";
  return `<a class="ak-dcard ak-st-${esc(a.statusKey)}" href="${href(a)}">
<div class="ak-dcard-top"><span class="ak-dcard-id">${esc(label(a))}${a.date ? ` · ${esc(a.date)}` : ""}</span>${pill(a)}</div>
<h3>${esc(a.title)}</h3>
${g.text ? `<div class="ak-gist ak-gist--${g.kind}"><span class="ak-gist-k">${g.kind === "decision" ? "Decided" : g.kind === "question" ? "Question" : g.kind === "recommendation" ? "Leaning" : ""}</span>${esc(g.text)}</div>` : ""}
<div class="ak-dcard-foot">${optbar}${q}${a.tags.slice(0, 4).map((t) => `<span class="mono">#${esc(t)}</span>`).join("")}</div>
</a>`;
}

function list(parts, q) {
  const status = q.get("status") ?? "";
  const tag = q.get("tag") ?? "";
  const text = q.get("q") ?? "";
  const kind = q.get("kind") ?? "adr";
  const folder = q.get("in") ?? "";
  const order = statusOrder();
  let items = kind === "all" ? [...S.site.adrs, ...S.site.docs] : kind === "doc" ? S.site.docs : S.site.adrs;
  if (status) items = items.filter((a) => a.statusKey === status);
  if (tag) items = items.filter((a) => a.tags.includes(tag));
  if (text) {
    const hits = new Set(search(text, 200).map((r) => r.item.id));
    items = items.filter((a) => hits.has(a.id));
  }
  // Folders: the architecture tree. Counts follow the other filters; the folder filter applies last.
  const matching = new Set(items.map((a) => a.id));
  const inFolder = folderIds(folder);
  if (inFolder) items = items.filter((a) => inFolder.has(a.id));
  const link = (patch) => {
    const p = new URLSearchParams({ status, tag, q: text, kind, in: folder, ...patch });
    for (const [k, v] of [...p]) if (!v || (k === "kind" && v === "adr")) p.delete(k);
    return `#/list${p.toString() ? `?${p}` : ""}`;
  };
  const counts = (k) => S.site.adrs.filter((a) => a.statusKey === k).length;
  const statusChips = [`<a class="ak-chip${!status ? " on" : ""}" href="${link({ status: "" })}">All</a>`]
    .concat(order.filter(counts).map((k) => `<a class="ak-chip${status === k ? " on" : ""}" href="${link({ status: status === k ? "" : k })}"><i class="ak-dot ak-st-${k}"></i>${esc(statusLabel(k))} <b>${counts(k)}</b></a>`))
    .join("");
  const tagList = Object.entries(S.site.tags).filter(([, ids]) => ids.length).sort((a, b) => b[1].length - a[1].length);
  const tagChips = tagList.map(([t, ids]) => `<a class="ak-chip ak-chip--tag${tag === t ? " on" : ""}" href="${link({ tag: tag === t ? "" : t })}">${esc(t)} <b>${ids.length}</b></a>`).join("");
  const kinds = S.site.docs.length ? `<span class="ak-label">Show</span><div class="ak-chips">${["adr", "doc", "all"].map((k) => `<a class="ak-chip${kind === k ? " on" : ""}" href="${link({ kind: k })}">${{ adr: "ADRs", doc: "Docs", all: "All" }[k]}</a>`).join("")}</div>` : "";

  setTimeout(() => {
    const input = $("#list-q");
    input?.addEventListener("input", () => {
      clearTimeout(input.t);
      input.t = setTimeout(() => {
        history.replaceState(null, "", link({ q: input.value }));
        route({ keepScroll: true }).then(() => {
          const i = $("#list-q");
          i.focus();
          i.setSelectionRange(i.value.length, i.value.length);
        });
      }, 180);
    });
  });

  const tree = folderTree(folder, matching, link);
  const cards = items.length ? `<div class="ak-deck">${items.map(decisionCard).join("")}</div>` : `<div class="ak-empty">No decisions match.</div>`;
  return `<div class="ak-page-head"><div><h1>Decisions</h1><p>${items.length} shown</p></div><input class="ak-input" id="list-q" placeholder="Filter by text…" value="${esc(text)}"></div>
<div class="ak-filters"><span class="ak-label">Status</span><div class="ak-chips">${statusChips}</div>${kinds}</div>
${tree ? `<div class="ak-folders"><aside class="ak-fside"><div class="ak-ftree" aria-label="Folders">${tree}</div>${tagChips ? `<div class="ak-ftags"><div class="ak-label">Tags</div><div class="ak-ftags-list">${tagChips}</div></div>` : ""}</aside><div class="ak-fmain">${folderHead(folder, link)}${cards}</div></div>`
  : `${tagChips ? `<div class="ak-filters"><span class="ak-label">Tags</span><div class="ak-chips">${tagChips}</div></div>` : ""}${cards}`}`;
}

// ── folders: the architecture tree as a folder view of decisions ──────
const UNFILED = "_unfiled";
const archNodes = () => S.site.architecture?.nodes ?? {};

// Decision ids in a folder: its own plus its whole subtree. null = no folder chosen.
function folderIds(id) {
  if (!id) return null;
  if (id === UNFILED) return new Set(S.site.adrs.filter((a) => !a.components?.length).map((a) => a.id));
  const n = archNodes()[id];
  if (!n) return new Set();
  return new Set(n.deep);
}

function folderPath(id) {
  const out = [];
  for (let n = archNodes()[id]; n; n = archNodes()[n.parent]) out.unshift(n);
  return out;
}

function folderTree(current, matching, link) {
  const arch = S.site.architecture;
  if (!arch?.roots?.length) return "";
  const open = new Set(current ? folderPath(current).map((n) => n.id) : []);
  const count = (ids) => ids.filter((x) => matching.has(x)).length;
  const marker = (n) => `<i class="ak-fk ak-fk--${esc(n.kind)}${n.tech ? ` tech tech-${esc(n.tech.replace(/[^a-z0-9-]/g, ""))}` : ""}"></i>`;
  const row = (n, depth) => {
    const kids = n.children.map((c) => arch.nodes[c]).filter((c) => c && c.deep.length);
    const c = count(n.deep);
    const a = `<a class="ak-frow${n.id === current ? " on" : ""}${c ? "" : " zero"}" href="${link({ in: n.id === current ? "" : n.id })}" title="${esc(n.sub || n.label)}">${marker(n)}<span class="ak-fname">${esc(n.label)}</span><b>${c}</b></a>`;
    if (!kids.length) return `<li>${a}</li>`;
    const isOpen = open.has(n.id) || depth < 2;
    return `<li><details${isOpen ? " open" : ""}><summary>${a}</summary><ul>${kids.map((k) => row(k, depth + 1)).join("")}</ul></details></li>`;
  };
  const roots = arch.roots.map((r) => arch.nodes[r]).filter((n) => n && n.deep.length);
  const unfiled = S.site.adrs.filter((a) => !a.components?.length).map((a) => a.id);
  const all = `<li><a class="ak-frow${!current ? " on" : ""}" href="${link({ in: "" })}"><i class="ak-fk ak-fk--all"></i><span class="ak-fname">${esc(arch.title || "All")}</span><b>${matching.size}</b></a></li>`;
  const un = unfiled.length ? `<li class="ak-funfiled"><a class="ak-frow${current === UNFILED ? " on" : ""}" href="${link({ in: current === UNFILED ? "" : UNFILED })}" title="Decisions linked to no component"><i class="ak-fk ak-fk--unfiled"></i><span class="ak-fname">Unfiled</span><b>${count(unfiled)}</b></a></li>` : "";
  return `<div class="ak-label">Folders</div><ul class="ak-ftree-list">${all}${roots.map((n) => row(n, 0)).join("")}${un}</ul>`;
}

function folderHead(id, link) {
  if (!id) return "";
  if (id === UNFILED) return `<div class="ak-fhead"><nav class="ak-fcrumbs"><a href="${link({ in: "" })}">All</a><i>/</i><b>Unfiled</b></nav><span class="muted">Add <code>components:</code> to file these.</span></div>`;
  const path = folderPath(id);
  const n = path.at(-1);
  if (!n) return "";
  const crumbs = [`<a href="${link({ in: "" })}">All</a>`]
    .concat(path.map((p, i) => (i === path.length - 1 ? `<b>${esc(p.label)}</b>` : `<a href="${link({ in: p.id })}">${esc(p.label)}</a>`)))
    .join("<i>/</i>");
  const mapHref = n.children.length ? `#/map/${encodeURIComponent(n.id)}` : `#/map/${encodeURIComponent(n.parent ?? "")}?sel=${encodeURIComponent(n.id)}`;
  return `<div class="ak-fhead"><nav class="ak-fcrumbs">${crumbs}</nav><div class="ak-fhead-tools"><a class="ak-chip" href="${mapHref}">Open on map ›</a></div></div>`;
}

// ── ADR / doc page ───────────────────────────────────────
function relationsHtml(a) {
  const R = S.site.relations;
  const groups = new Map();
  for (const n of S.adj.get(a.id) ?? []) {
    const name = n.dir === "out" ? R[n.type]?.label ?? n.type : R[n.type]?.inverse ?? n.type;
    if (!groups.has(name)) groups.set(name, []);
    const other = S.byId.get(n.id);
    if (other && !groups.get(name).includes(other)) groups.get(name).push(other);
  }
  const order = ["supersedes", "superseded by", "depends on", "required by", "amends", "amended by", "relates to", "mentions", "mentioned by"];
  const keys = [...groups.keys()].sort((x, y) => order.indexOf(x) - order.indexOf(y));
  if (!keys.length) return "";
  return `<div class="ak-rels">${keys.map((k) => `<div class="ak-rel"><span>${esc(k)}</span>${groups.get(k).map(refChip).join("")}</div>`).join("")}</div>`;
}

function egoGraph(a) {
  const ns = [...new Map((S.adj.get(a.id) ?? []).map((n) => [n.id, n])).values()].map((n) => ({ ...n, a: S.byId.get(n.id) })).filter((n) => n.a);
  if (!ns.length) return `<div class="ak-empty">No connections yet.</div>`;
  const W = 300, H = 240, cx = W / 2, cy = H / 2, r = Math.min(98, 40 + ns.length * 8);
  const pos = ns.map((n, i) => {
    const t = (i / ns.length) * Math.PI * 2 - Math.PI / 2;
    return { ...n, x: cx + Math.cos(t) * r * 1.25, y: cy + Math.sin(t) * r * 0.85 };
  });
  const edges = pos.map((p) => `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" class="g-edge t-${p.type}"/>`).join("");
  const nodes = pos
    .map((p) => `<a href="${href(p.a)}" data-ref="${esc(p.a.id)}"><g class="ak-st-${esc(p.a.statusKey)}"><circle cx="${p.x}" cy="${p.y}" r="9" style="fill:var(--st)" stroke="var(--paper)" stroke-width="2"/><text x="${p.x}" y="${p.y + (p.y > cy ? 22 : -14)}" text-anchor="middle">${esc(p.a.kind === "adr" ? p.a.id : "doc")}</text></g></a>`)
    .join("");
  return `<svg class="ak-ego" viewBox="0 0 ${W} ${H}" role="img" aria-label="Connections">${edges}${nodes}<g class="ak-st-${esc(a.statusKey)}"><circle cx="${cx}" cy="${cy}" r="15" style="fill:var(--st)" stroke="var(--ink)" stroke-width="2"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" style="fill:var(--paper);stroke:none">${esc(a.kind === "adr" ? a.id : "•")}</text></g></svg>`;
}

function glance(a) {
  const os = optionStats(a);
  const rows = [];
  if (os.items.length) {
    const nm = (o) => esc(o.key ? `${o.key} — ${o.name}` : o.name);
    const undecided = ["draft", "open", "review"].includes(a.statusKey);
    rows.push(`<div><dt>Options · ${os.items.length}${undecided ? " · undecided" : ""}</dt><dd>${os.ok.map((o) => `<div class="ok">${undecided ? "→ leaning:" : "✓"} ${nm(o)}</div>`).join("")}${os.warn.map((o) => `<div class="warn">~ ${nm(o)}</div>`).join("")}${os.no.map((o) => `<div class="no">✗ ${nm(o)}</div>`).join("")}</dd></div>`);
  }
  if (a.facts.questions?.length) rows.push(`<div><dt>Open questions</dt><dd><a href="#${location.hash.slice(1).split("#")[0]}" data-jump="questions">${a.facts.questions.length} need an answer →</a></dd></div>`);
  if (a.components.length) rows.push(`<div><dt>Architecture · <a class="ak-impact-link" href="${impactHref(a)}">impact on map ›</a></dt><dd>${a.components.map((c) => `<div class="ak-crumbs">${ancestors(c).map((n) => `<a href="#/map/${encodeURIComponent(n.parent ?? "")}?sel=${encodeURIComponent(n.id)}">${esc(n.label)}</a>`).join("<i>›</i>")}</div>`).join("")}</dd></div>`);
  if (a.facts.criteria?.length) rows.push(`<div><dt>Criteria</dt><dd>${a.facts.criteria.length} evaluation criteria</dd></div>`);
  return rows.length ? `<dl class="ak-glance">${rows.join("")}</dl>` : `<div class="muted" style="font-size:13px">Add an <b>Options</b> table with a verdict column and a <b>Decision</b> callout to light this up.</div>`;
}

async function docPage(id, q) {
  const a = S.byId.get(id);
  if (!a) return notFound();
  view.innerHTML = `<div class="ak-empty">Loading ${esc(label(a))}…</div>`;
  const doc = await loadDoc(id);
  if (!doc) return notFound();
  const showSource = q.get("source") === "1";
  const list = a.kind === "adr" ? S.site.adrs : S.site.docs;
  const i = list.indexOf(a);
  const prev = list[i - 1], next = list[i + 1];
  const toc = a.sections.map((s) => `<a href="#panel-${esc(s.id)}" data-panel="${esc(s.id)}" class="${/^(decision|question|recommend)/i.test(s.title) ? "hero" : ""}"><span>${esc(s.id)}</span>${esc(s.title)}</a>`).join("");
  const errors = doc.errors.length ? `<div class="ak-error" style="margin-bottom:16px"><b>${doc.errors.length} render error(s)</b>${doc.errors.map((e) => `<div>${esc(e.panel)} (line ${e.line}): ${esc(e.message)}</div>`).join("")}</div>` : "";
  const base = `${href(a)}`;
  const grid = prefs().grid ?? false;
  const crumbs = a.components.map((c) => `<span class="ak-crumbs">${ancestors(c).map((n) => `<a href="#/map/${encodeURIComponent(n.parent ?? "")}?sel=${encodeURIComponent(n.id)}">${esc(n.label)}</a>`).join("<i>/</i>")}</span>`).join("");
  const block = titleBlock(
    [
      { label: "Status", value: a.status || "Doc", html: statusCell(a) },
      { label: "Date", value: a.date },
      { label: a.owner ? "Owner" : "Author", value: a.owner ? `@${a.owner}` : a.author ? String(a.author) : "" },
      { label: "Due", value: a.statusKey === "accepted" ? "" : a.due },
      { label: "Sheet", value: `${i + 1} of ${list.length}` },
      { label: "Tags", value: a.tags.length ? "x" : "", html: `<span class="ak-chips">${a.tags.map((t) => tagChip(t)).join("")}</span>`, span: 2 },
      { label: "Architecture", value: crumbs ? "x" : "", html: crumbs, span: 2 },
      { label: "Reopen when", value: a.reopen?.length ? "x" : "", html: a.reopen?.map((r) => `<div>${esc(r)}</div>`).join(""), span: 2 },
      { label: "Applies to", value: a.applies?.length ? "x" : "", html: a.applies?.map((r) => `<span class="mono" style="font-size:12px">${esc(r)}</span>`).join(" · "), span: 2 },
    ],
    4,
  );
  const html = `<article class="ak-st-${esc(a.statusKey)}">
<header class="ak-adr-head ak-st-${esc(a.statusKey)}">
  <div class="ak-adr-actions"><button class="ak-btn ak-btn--ghost" type="button" data-grid title="Lay panels out on a grid using their span">${grid ? "▤ Doc" : "▦ Grid"}</button><a class="ak-btn ak-btn--ghost" href="${base}${showSource ? "" : "?source=1"}">${showSource ? "Rendered" : "Markdown"}</a><button class="ak-btn ak-btn--ghost" type="button" data-copy-text="${esc(a.file)}" title="Copy file path">⧉ ${esc(a.file.split("/").pop())}</button></div>
  <div class="ak-adr-id"><span>${esc(label(a))}</span>${pill(a, true)}${privacy(a)}</div>
  <h1>${esc(a.title)}</h1>
  ${a.subtitle ? `<p class="ak-sub">${esc(a.subtitle)}</p>` : ""}
  ${block}
  ${relationsHtml(a)}
</header>
${flowStrip(a)}
${errors}
${sheet(`<div class="ak-adr-layout${grid ? " ak-adr-layout--grid" : ""}">
  <nav class="ak-toc" aria-label="Sections">${toc}</nav>
  <div class="ak-body${grid ? " ak-body--grid" : ""}"><div id="team-slot"></div>${showSource ? `<figure class="ak-code"><figcaption><span>${esc(a.file)}</span><button class="ak-copy" data-copy>Copy</button></figcaption><pre class="ak-source"><code>${esc(doc.source)}</code></pre></figure>` : doc.html}${showSource ? "" : finalizeHtml(a)}</div>
  <aside class="ak-rail">
    ${sharePanel(a)}
    <section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">i</span><h2>At a glance</h2></header><div class="am-panel-body">${glance(a)}</div></section>
    <section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">↔</span><h2>Connections</h2><span class="am-panel-meta"><a href="#/graph?focus=${encodeURIComponent(a.id)}">graph →</a></span></header><div class="am-panel-body">${egoGraph(a)}</div></section>
  </aside>
</div>`, { rows: 6 })}
<nav class="ak-pn">${prev ? `<a href="${href(prev)}"><span>← ${esc(label(prev))}</span>${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a class="next" href="${href(next)}"><span>${esc(label(next))} →</span>${esc(next.title)}</a>` : "<span></span>"}</nav>
</article>`;
  view.innerHTML = html;

  // Section links scroll inside the page instead of changing the route.
  const jump = (pid) => document.getElementById(`panel-${pid}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const onClick = (e) => {
    if (e.target.closest("[data-grid]")) {
      savePrefs({ grid: !grid });
      return route({ keepScroll: true });
    }
    const t = e.target.closest("a[data-panel], .ak-toc a, a[data-jump]");
    if (!t) return;
    e.preventDefault();
    if (t.dataset.jump) {
      const p = $$(".ak-body .am-panel").find((p) => /questions?/i.test(p.dataset.title));
      p?.scrollIntoView({ behavior: "smooth" });
    } else jump(t.dataset.panel ?? t.getAttribute("href").replace("#panel-", ""));
  };
  view.addEventListener("click", onClick);
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) for (const l of $$(".ak-toc a")) l.classList.toggle("on", l.dataset.panel === en.target.id.replace("panel-", ""));
  }, { rootMargin: "-80px 0px -65% 0px" });
  $$(".ak-body .am-panel").forEach((p) => io.observe(p));
  // Team input from the share server, refreshed while the page is open.
  let timer = 0;
  const loadTeam = async () => {
    if (!S.site.local || !shareOf(a)) return;
    try {
      const data = await (await fetch(`api/team/${a.id}`, { cache: "no-store" })).json();
      const slot = document.getElementById("team-slot");
      if (!slot) return;
      const active = document.activeElement;
      if (!slot.contains(active)) slot.innerHTML = teamHtml(a, data);
      const c = document.getElementById("team-count");
      if (c && data.item) c.textContent = `${data.item.entries.length} entries`;
      if (c && data.error) c.textContent = "server unreachable";
    } catch {}
    timer = setTimeout(loadTeam, 6000);
  };
  loadTeam();
  const unbindFlow = bindFlow(a, async (full) => {
    if (full) {
      await loadSite();
      await route({ keepScroll: true });
    } else {
      clearTimeout(timer);
      loadTeam();
    }
  });
  cleanup = () => {
    io.disconnect();
    view.removeEventListener("click", onClick);
    clearTimeout(timer);
    unbindFlow();
  };
  return null;
}

// ── tags ─────────────────────────────────────────────────
function tags() {
  const entries = Object.entries(S.site.tags).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (!entries.length) return `<div class="ak-page-head"><div><h1>Tags</h1></div></div><div class="ak-empty">No tags yet. Add <code>tags: [kafka, messaging]</code> to frontmatter, or tag nodes in architecture.yaml.</div>`;
  return `<div class="ak-page-head"><div><h1>Tags</h1><p>${entries.length} tags</p></div></div>
<div class="ak-deck">${entries
    .map(([t, ids]) => {
      const items = ids.map((id) => S.byId.get(id)).filter(Boolean);
      const dots = items.map((a) => `<i class="ak-dot ak-st-${a.statusKey}" title="${esc(label(a))} ${esc(a.title)}"></i>`).join("");
      const info = S.site.tagInfo?.[t]?.desc;
      return `<a class="ak-dcard" href="#/tag/${encodeURIComponent(t)}" style="--st:var(--accent)"><div class="ak-dcard-top"><h3 class="mono">#${esc(t)}</h3><b class="mono">${items.length}</b></div>${info ? `<div class="ak-gist">${esc(info)}</div>` : ""}<div class="ak-chips" style="gap:4px">${dots}</div><div class="ak-gist muted" style="font-size:12.5px">${items.slice(0, 4).map((a) => esc(a.title)).join(" · ")}</div></a>`;
    })
    .join("")}</div>`;
}

function tagPage(t) {
  const items = (S.site.tags[t] ?? []).map((id) => S.byId.get(id)).filter(Boolean);
  const co = new Map();
  for (const a of items) for (const x of a.tags) if (x !== t) co.set(x, (co.get(x) ?? 0) + 1);
  const nodes = S.site.architecture ? Object.values(S.site.architecture.nodes).filter((n) => n.tags.includes(t)) : [];
  return `<div class="ak-page-head"><div><h1 class="mono">#${esc(t)}</h1><p>${items.length} records${S.site.tagInfo?.[t]?.desc ? ` · ${esc(S.site.tagInfo[t].desc)}` : ""}</p></div><a class="ak-btn" href="#/graph?tag=${encodeURIComponent(t)}">See in graph →</a></div>
${co.size ? `<div class="ak-filters"><span class="ak-label">Related tags</span><div class="ak-chips">${[...co].sort((a, b) => b[1] - a[1]).map(([x, n]) => tagChip(x, false, n)).join("")}</div></div>` : ""}
${nodes.length ? `<div class="ak-filters"><span class="ak-label">Components</span><div class="ak-chips">${nodes.map((n) => nodeChip(n.id)).join("")}</div></div>` : ""}
<div class="ak-deck">${items.map(decisionCard).join("") || `<div class="ak-empty">Nothing tagged #${esc(t)} yet.</div>`}</div>`;
}

// ── components gallery ───────────────────────────────────
function components() {
  const groups = { builtin: "Decision components (crux)", "answer-me-with-html": "Diagram + layout components (answer-me-with-html)" };
  const by = new Map();
  for (const c of S.site.components) {
    const g = groups[c.origin] ?? `Project · ${c.origin}`;
    if (!by.has(g)) by.set(g, []);
    by.get(g).push(c);
  }
  return `<div class="ak-page-head"><div><h1>Components</h1><p>Fenced blocks you can use in any ADR. Add your own in <code>.crux/components/*.mjs</code>.</p></div></div>
<div class="ak-grid">${[...by]
    .map(([g, cs]) => `<section class="ak-box s12"><header class="am-panel-head"><span class="am-panel-id">${cs.length}</span><h2>${esc(g)}</h2></header>${cs.map((c) => `<div class="ak-comp"><div><h3>${esc(c.name)}</h3><small>${esc(c.summary)}</small></div><div>${c.syntax ? `<pre>${esc(c.syntax)}</pre>` : ""}${c.example ? `<pre>${esc(c.example)}</pre>` : ""}</div></div>`).join("")}</section>`)
    .join("")}
<section class="ak-box s12"><header class="am-panel-head"><span class="am-panel-id">+</span><h2>Code blocks</h2></header><div class="ak-box-body am-md"><p>Any other fence language is syntax-highlighted: <code>go</code>, <code>ts</code>, <code>sql</code>, <code>yaml</code>, <code>proto</code>, <code>bash</code>, <code>rust</code>, <code>python</code>, <code>java</code>, <code>kotlin</code>, <code>json</code>, <code>dockerfile</code>, <code>hcl</code> and more.</p></div></section></div>`;
}

function searchPage(text) {
  const hits = search(text, 60);
  return `<div class="ak-page-head"><div><h1>Search</h1><p>${hits.length} results for “${esc(text)}”</p></div></div><div class="ak-deck">${hits.map((h) => decisionCard(h.item)).join("")}</div>`;
}

// ── canvases ─────────────────────────────────────────────
function mountCanvas(kind, q, nodeId) {
  view.innerHTML = "";
  cleanup = kind === "graph" ? renderGraph(view, q) : renderMap(view, nodeId ?? "", q);
  return null;
}

// ── global behavior ──────────────────────────────────────
function setupPopovers() {
  let pop;
  // Anchor to the visible box (a sequence participant's group also spans its whole lifeline),
  // below it if it fits, else above, and always inside the viewport.
  const place = (t) => {
    document.body.append(pop);
    const r = (t.querySelector?.("rect.am-actor") ?? t).getBoundingClientRect();
    const h = pop.offsetHeight;
    const top = r.bottom + 8 + h <= innerHeight ? r.bottom + 8 : r.top - h - 8 >= 8 ? r.top - h - 8 : innerHeight - h - 8;
    pop.style.top = `${Math.max(8, top)}px`;
    pop.style.left = `${Math.min(innerWidth - pop.offsetWidth - 12, Math.max(8, r.left))}px`;
  };
  // Architecture components (sequence participants, anything with data-node): a preview of the
  // component's map page — kind and tech, description, decisions inside, children.
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest(".ak-part[data-node], [data-node-pop]");
    if (!t || t.closest(".ak-pop")) return;
    const n = S.site.architecture?.nodes?.[t.dataset.node ?? t.dataset.nodePop];
    if (!n || pop?.dataset.for === n.id) return;
    pop?.remove();
    const nodes = S.site.architecture.nodes;
    const tech = n.tech ? ` tech tech-${n.tech.replace(/[^a-z0-9-]/g, "")}` : "";
    const where = [];
    for (let p = nodes[n.parent]; p; p = nodes[p.parent]) where.unshift(p.label);
    const desc = String(n.desc ?? "").split("\n").filter((l) => l.trim() && !/^\s*-/.test(l)).join(" ").trim();
    const adrs = n.deep.map((id) => S.byId.get(id)).filter(Boolean);
    const kids = n.children.map((c) => nodes[c]?.label).filter(Boolean);
    pop = document.createElement("div");
    pop.className = `ak-pop ak-npop${tech}`;
    pop.dataset.for = n.id;
    pop.innerHTML = `<div class="ak-npop-tag">${esc([n.kind, n.tech].filter(Boolean).join(" · ").toUpperCase())}${where.length ? `<span>in ${esc(where.join(" / "))}</span>` : ""}</div>
<strong>${esc(n.label)}</strong>${n.sub ? `<div class="ak-npop-sub">${esc(n.sub)}</div>` : ""}${desc ? `<p>${esc(desc.length > 220 ? desc.slice(0, 219) + "…" : desc)}</p>` : ""}
${adrs.length ? `<div class="ak-npop-h">Decisions · ${adrs.length}</div><ul class="ak-npop-adrs">${adrs.slice(0, 5).map((a) => `<li><span class="mono">${esc(a.id)}</span><span class="t">${esc(a.title)}</span>${pill(a)}</li>`).join("")}${adrs.length > 5 ? `<li class="more">+${adrs.length - 5} more</li>` : ""}</ul>` : ""}
${kids.length ? `<div class="ak-npop-h">Inside · ${kids.length}</div><div class="ak-npop-kids">${esc(kids.slice(0, 6).join(" · "))}${kids.length > 6 ? ` +${kids.length - 6}` : ""}</div>` : ""}
<div class="ak-npop-foot">Click to open on the map ›</div>`;
    place(t);
  });
  document.addEventListener("mouseout", (e) => {
    const from = e.target.closest?.(".ak-part[data-node], [data-node-pop]");
    if (from && !e.relatedTarget?.closest?.(".ak-part[data-node], [data-node-pop]")) {
      pop?.remove();
      pop = null;
    }
  });
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-ref]");
    if (!t || t.closest(".ak-pop")) return;
    const a = S.byId.get(t.dataset.ref);
    if (!a) return;
    pop?.remove();
    const g = gist(a);
    pop = document.createElement("div");
    pop.className = `ak-pop ak-st-${a.statusKey}`;
    pop.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px"><span class="mono" style="color:var(--ink-3);font-size:12px">${esc(label(a))}</span>${pill(a)}</div><strong>${esc(a.title)}</strong>${g.text ? `<p class="${g.kind === "decision" ? "d" : ""}">${esc(g.text)}</p>` : ""}`;
    document.body.append(pop);
    const r = t.getBoundingClientRect();
    const top = r.bottom + 8 + pop.offsetHeight > innerHeight ? r.top - pop.offsetHeight - 8 : r.bottom + 8;
    pop.style.top = `${Math.max(8, top)}px`;
    pop.style.left = `${Math.min(innerWidth - pop.offsetWidth - 12, Math.max(8, r.left))}px`;
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest("[data-ref]") && !e.relatedTarget?.closest?.("[data-ref]")) {
      pop?.remove();
      pop = null;
    }
  });
  addEventListener("hashchange", () => {
    pop?.remove();
    pop = null;
  });
}

// ── sequence playback ────────────────────────────────────
// Figures marked data-sq-player autoplay at 1.5× when visible, loop (hold 2 s on the full
// diagram, then replay), and pause when scrolled away. Steps before the cursor are done, the
// current one is lit with a dot running along its arrow, later ones are faded. Segments jump.
function setupSequencePlayers() {
  const SPEEDS = [1, 1.5, 2];
  const STEP_MS = 1500, HOLD_MS = 2000;
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = new WeakMap();
  const get = (fig) => {
    let s = state.get(fig);
    if (!s) {
      s = { fig, steps: [...fig.querySelectorAll(".ak-sq-step")], k: 0, timer: 0, raf: 0, speed: 1.5, playing: false, user: false, passes: 0, peek: null };
      state.set(fig, s);
    }
    return s;
  };
  const render = (s) => {
    const n = s.steps.length;
    // Dim and highlight only while something is shown on purpose: playing, a hover preview, or a
    // keyboard step. Paused or stopped = the plain, undimmed diagram.
    const live = s.k > 0 && s.k <= n && (s.playing || !!s.peek || s.hold);
    const cur = live ? s.steps[s.k - 1] : null;
    s.fig.classList.toggle("is-stepping", live);
    s.steps.forEach((g, i) => {
      g.classList.toggle("is-done", live && i < s.k - 1);
      g.classList.toggle("is-current", live && i === s.k - 1);
      g.classList.toggle("is-future", live && i >= s.k);
    });
    for (const p of s.fig.querySelectorAll(".ak-part")) p.classList.toggle("is-active", !!cur && (p.dataset.p === cur.dataset.from || p.dataset.p === cur.dataset.to));
    s.fig.querySelectorAll(".ak-sq-seg").forEach((seg, i) => {
      seg.classList.toggle("done", i < s.k - 1 || s.k > n);
      seg.classList.toggle("cur", live && i === s.k - 1);
      seg.style.setProperty("--dur", `${STEP_MS / s.speed}ms`);
      if (live && i === s.k - 1) { const bar = seg.firstElementChild; bar.style.animation = "none"; bar.offsetWidth; bar.style.animation = ""; }
    });
    s.fig.classList.toggle("is-paused", !s.playing);
    s.fig.querySelector(".ak-sq-count").textContent = `${Math.min(s.k, n)}/${n}`;
    const btn = s.fig.querySelector('[data-sq="play"]');
    btn.setAttribute("aria-label", s.playing ? "Pause" : "Play");
    s.fig.querySelector(".ak-sq-caption").innerHTML = caption(s, cur, n);
    runDot(s, cur);
  };
  // Caption: sender and receiver as chips styled like their components, then what happens on a
  // black label.
  const chip = (s, name) => {
    const part = [...s.fig.querySelectorAll(".ak-part")].find((p) => p.dataset.p === name);
    const cls = part ? [...part.classList].filter((c) => /^(k-|tech)/.test(c) || c === "ak-part--linked").join(" ") : "";
    return `<span class="ak-sq-chip ${cls}">${esc(name)}</span>`;
  };
  const caption = (s, cur, n) => {
    if (!cur) return s.k > n ? `<span class="ak-sq-what">Full flow</span>` : "&nbsp;";
    const what = cur.dataset.label ? `<span class="ak-sq-what">${esc(cur.dataset.label)}</span>` : "";
    if (cur.dataset.kind === "msg") return `${chip(s, cur.dataset.from)}<span class="ak-sq-to">→</span>${chip(s, cur.dataset.to)}${what}`;
    return `<span class="ak-sq-chip">${cur.dataset.kind === "note" ? "Note" : "Phase"}</span>${what}`;
  };
  // The current arrow is drawn in the sender's color (its box stroke color), complete with its
  // head; a small square travels along it. No fill or arrow animation.
  const NS = "http://www.w3.org/2000/svg";
  const partColor = (s, name) => {
    const part = [...s.fig.querySelectorAll(".ak-part")].find((p) => p.dataset.p === name);
    const rect = part?.querySelector("rect.am-actor");
    const c = rect ? getComputedStyle(rect).stroke : "";
    return !c || c === "none" ? getComputedStyle(s.fig).getPropertyValue("--accent") || "rgb(29,95,191)" : c;
  };
  const runDot = (s, g) => {
    cancelAnimationFrame(s.raf);
    s.fig.querySelectorAll(".ak-sq-dot, .ak-sq-flow").forEach((el) => el.remove());
    const path = g?.querySelector("path.am-edge");
    if (!path) return;
    const svg = s.fig.querySelector(":scope > svg");
    const color = partColor(s, g.dataset.from);
    const id = (s.gid ??= `sqg${Math.random().toString(36).slice(2, 8)}`);
    if (!svg.querySelector(`#${id}-head`)) svg.querySelector("defs").insertAdjacentHTML("beforeend", `<marker id="${id}-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker>`);
    svg.querySelector(`#${id}-head path`).setAttribute("fill", color);
    const flow = document.createElementNS(NS, "path");
    flow.setAttribute("class", "ak-sq-flow");
    flow.setAttribute("d", path.getAttribute("d"));
    flow.setAttribute("stroke", color);
    flow.setAttribute("marker-end", `url(#${id}-head)`);
    path.after(flow);
    if (reduce()) return;
    const sq = document.createElementNS(NS, "rect");
    sq.setAttribute("class", "ak-sq-dot");
    sq.setAttribute("width", "18");
    sq.setAttribute("height", "8");
    sq.setAttribute("stroke", color);
    const start = path.getPointAtLength(0);
    sq.setAttribute("x", start.x - 9);
    sq.setAttribute("y", start.y - 4);
    svg.appendChild(sq);
    const len = path.getTotalLength();
    const dur = (STEP_MS * 0.6) / s.speed;
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const pt = path.getPointAtLength(len * (1 - Math.pow(1 - t, 2)));
      sq.setAttribute("x", pt.x - 9);
      sq.setAttribute("y", pt.y - 4);
      if (t < 1) s.raf = requestAnimationFrame(tick);
      else sq.remove();
    };
    s.raf = requestAnimationFrame(tick);
  };
  // One tick per step; after the last step, hold the full diagram, then start over.
  const schedule = (s) => {
    clearTimeout(s.timer);
    if (!s.playing) return;
    const n = s.steps.length;
    s.timer = setTimeout(() => {
      if (s.k === n) s.passes++;
      if (s.k > n && s.passes >= 2) { s.playing = false; render(s); return; } // two full passes, then rest on the full flow
      s.k = s.k > n ? 1 : s.k + 1;
      render(s);
      schedule(s);
    }, s.k > n ? HOLD_MS / s.speed : STEP_MS / s.speed);
  };
  const setPlaying = (s, on) => {
    s.playing = on;
    s.hold = false;
    if (on && (s.k === 0 || s.k > s.steps.length)) { s.k = 1; s.passes = 0; }
    render(s);
    schedule(s);
  };
  // Step number under a pointer target: a progress segment or a step group in the diagram.
  const stepAt = (s, el) => {
    if (!el?.closest || !s.fig.contains(el)) return 0;
    const seg = el.closest("[data-sq-seg]");
    if (seg) return Number(seg.dataset.sqSeg);
    const g = el.closest(".ak-sq-step");
    return g ? Number(g.dataset.step) + 1 : 0;
  };
  const jump = (s, k) => {
    s.user = true;
    s.hold = true;
    s.k = Math.max(1, Math.min(k, s.steps.length));
    setPlaying(s, false);
  };
  document.addEventListener("click", (ev) => {
    const fig = ev.target.closest("[data-sq-player]");
    if (!fig) return;
    const s = get(fig);
    const at = stepAt(s, ev.target);
    if (at) {
      s.peek = null;
      s.user = true;
      s.k = at;
      s.passes = 0;
      return setPlaying(s, true);
    }
    const b = ev.target.closest("[data-sq]");
    if (b?.dataset.sq === "play") { s.user = true; setPlaying(s, !s.playing); }
    else if (b?.dataset.sq === "map") {
      // Hand the messages to the map and open the level that holds all of them.
      const steps = s.steps.filter((g) => g.dataset.kind === "msg").map((g) => ({ from: g.dataset.from, to: g.dataset.to, fromNode: g.dataset.fromNode, toNode: g.dataset.toNode, label: g.dataset.label }));
      // Pick the map level where the most messages join two different boxes: a node inside the
      // level shows as its child box there, a node outside as its own (outside) box. Ties → deeper.
      const nodes = [...new Set(steps.flatMap((x) => [x.fromNode, x.toNode]).filter(Boolean))];
      const path = new Map(nodes.map((id) => [id, ancestors(id).map((n) => n.id)]));
      const levels = new Set([""]);
      for (const p of path.values()) p.slice(0, -1).forEach((id) => levels.add(id));
      const boxAt = (lvl, id) => {
        if (!id) return null;
        const p = path.get(id);
        const i = lvl ? p.indexOf(lvl) : -1;
        return lvl && i < 0 ? id : p[i + 1] ?? id;
      };
      let lvl = "", best = -1, bestDepth = -1;
      for (const L of levels) {
        const score = steps.filter((x) => { const a = boxAt(L, x.fromNode), b = boxAt(L, x.toNode); return a && b && a !== b; }).length;
        const depth = L ? ancestors(L).length : 0;
        if (score > best || (score === best && depth > bestDepth)) { lvl = L; best = score; bestDepth = depth; }
      }
      S.replay = { steps, back: location.hash, speed: s.speed };
      setPlaying(s, false);
      location.hash = `#/map/${encodeURIComponent(lvl)}?replay=1`;
    }
    else if (b?.dataset.sq === "speed") {
      s.speed = SPEEDS[(SPEEDS.indexOf(s.speed) + 1) % SPEEDS.length];
      b.textContent = `${s.speed}×`;
      render(s);
      schedule(s);
    }
  });
  // Hover a segment or a step in the diagram: replay just that step; leaving restores playback.
  document.addEventListener("mouseover", (ev) => {
    const fig = ev.target.closest?.("[data-sq-player]");
    if (!fig) return;
    const s = get(fig);
    const at = stepAt(s, ev.target);
    if (!at || (s.peek && s.k === at)) return;
    if (!s.peek) s.peek = { k: s.k, playing: s.playing };
    clearTimeout(s.timer);
    s.playing = false;
    s.k = at;
    render(s);
  });
  document.addEventListener("mouseout", (ev) => {
    const fig = ev.target.closest?.("[data-sq-player]");
    if (!fig) return;
    const s = get(fig);
    if (!s.peek || stepAt(s, ev.relatedTarget)) return;
    const { k, playing } = s.peek;
    s.peek = null;
    s.k = k;
    s.playing = playing;
    render(s);
    schedule(s);
  });
  document.addEventListener("keydown", (ev) => {
    const fig = ev.target.closest?.("[data-sq-player]");
    if (!fig || /input|select/i.test(ev.target.tagName)) return;
    const s = get(fig);
    if (ev.key === "ArrowRight") { ev.preventDefault(); jump(s, s.k + 1); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); jump(s, s.k - 1); }
    else if (ev.key === " ") { ev.preventDefault(); s.user = true; setPlaying(s, !s.playing); }
  });
  // Autoplay while visible (also when a tab containing it is opened). A user pause sticks.
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const s = get(en.target);
      if (s.user || s.peek || reduce()) continue;
      if (en.isIntersecting && !s.playing) setPlaying(s, true);
      else if (!en.isIntersecting && s.playing) { s.playing = false; clearTimeout(s.timer); render(s); }
    }
  }, { threshold: 0.35 });
  const watch = (root) => root.querySelectorAll?.("[data-sq-player]:not([data-sq-watched])").forEach((fig) => { fig.dataset.sqWatched = ""; io.observe(fig); });
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && (n.matches?.("[data-sq-player]") ? watch(n.parentNode) : watch(n))))).observe(document.body, { childList: true, subtree: true });
  watch(document);
}

// Map level that shows all components of a decision: their lowest common ancestor's level.
function impactHref(a) {
  const paths = a.components.map((c) => ancestors(c).map((n) => n.id));
  let common = paths[0] ?? [];
  for (const p of paths.slice(1)) common = common.filter((id, i) => p[i] === id);
  // show the level that contains the components: the common ancestor, or its parent when the
  // common ancestor is itself one of the components
  let lvl = common.at(-1) ?? "";
  if (lvl && a.components.includes(lvl)) lvl = S.site.architecture.nodes[lvl]?.parent ?? "";
  return `#/map/${encodeURIComponent(lvl)}?impact=${encodeURIComponent(a.id)}`;
}

function setupCopy() {
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy], [data-copy-text]");
    if (!b) return;
    const text = b.dataset.copyText ?? b.closest("figure")?.querySelector("code")?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Copy failed");
    }
  });
}

function prefs() {
  try {
    return JSON.parse(localStorage.getItem("crux:prefs") || "{}");
  } catch {
    return {};
  }
}
function savePrefs(patch) {
  try {
    localStorage.setItem("crux:prefs", JSON.stringify({ ...prefs(), ...patch }));
  } catch {}
}

function setupLive(site) {
  if (site.static || new URLSearchParams(location.search).has("nolive")) return;
  const dot = $("#live");
  const es = new EventSource("api/events");
  es.onopen = () => dot.classList.remove("off");
  es.onerror = () => dot.classList.add("off");
  es.onmessage = async () => {
    await loadSite();
    await route({ keepScroll: true });
    toast("Reloaded from disk");
  };
}

addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openSearch();
  } else if (e.key === "/" && !/input|textarea/i.test(document.activeElement?.tagName)) {
    e.preventDefault();
    openSearch();
  }
});
$("#open-search").addEventListener("click", () => openSearch());
$("#new-q").addEventListener("click", () => openNewQuestion());

addEventListener("hashchange", () => {
  if (location.hash.startsWith("#panel-")) return;
  route();
});

const site = await loadSite();
setupPopovers();
setupCopy();
setupSequencePlayers();
setupLive(site);
route();
