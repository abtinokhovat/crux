// adr-kit single-page app: router, overview, decision list, ADR page, tags, components.
import { $, $$, S, ancestors, esc, gist, href, index, label, nodeChip, optionStats, pill, refChip, statusLabel, statusOrder, tagChip, toast } from "./util.js";
import { renderGraph } from "./graph.js";
import { renderMap } from "./map.js";
import { openSearch, search } from "./search.js";
import { archTree, areaBars, history, panel, register, sheet, statusCell, titleBlock } from "./blueprint.js";
import { bindFlow, finalizeHtml, flowStrip, openNewQuestion, privacy, sharePanel, shareOf, teamHtml } from "./flow.js";

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
  return site;
}

async function loadDoc(id) {
  if (!S.docCache.has(id)) S.docCache.set(id, fetch(`api/doc/${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)));
  return S.docCache.get(id);
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
  const order = statusOrder();
  let items = kind === "all" ? [...S.site.adrs, ...S.site.docs] : kind === "doc" ? S.site.docs : S.site.adrs;
  if (status) items = items.filter((a) => a.statusKey === status);
  if (tag) items = items.filter((a) => a.tags.includes(tag));
  if (text) {
    const hits = new Set(search(text, 200).map((r) => r.item.id));
    items = items.filter((a) => hits.has(a.id));
  }
  const link = (patch) => {
    const p = new URLSearchParams({ status, tag, q: text, kind, ...patch });
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

  return `<div class="ak-page-head"><div><h1>Decisions</h1><p>${items.length} shown</p></div><input class="ak-input" id="list-q" placeholder="Filter by text…" value="${esc(text)}"></div>
<div class="ak-filters"><span class="ak-label">Status</span><div class="ak-chips">${statusChips}</div>${kinds}</div>
${tagChips ? `<div class="ak-filters"><span class="ak-label">Tags</span><div class="ak-chips">${tagChips}</div></div>` : ""}
${items.length ? `<div class="ak-deck">${items.map(decisionCard).join("")}</div>` : `<div class="ak-empty">No decisions match.</div>`}`;
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
  if (a.components.length) rows.push(`<div><dt>Architecture</dt><dd>${a.components.map((c) => `<div class="ak-crumbs">${ancestors(c).map((n) => `<a href="#/map/${encodeURIComponent(n.parent ?? "")}?sel=${encodeURIComponent(n.id)}">${esc(n.label)}</a>`).join("<i>›</i>")}</div>`).join("")}</dd></div>`);
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
  const groups = { builtin: "Decision components (adr-kit)", "answer-me-with-html": "Diagram + layout components (answer-me-with-html)" };
  const by = new Map();
  for (const c of S.site.components) {
    const g = groups[c.origin] ?? `Project · ${c.origin}`;
    if (!by.has(g)) by.set(g, []);
    by.get(g).push(c);
  }
  return `<div class="ak-page-head"><div><h1>Components</h1><p>Fenced blocks you can use in any ADR. Add your own in <code>.adr/components/*.mjs</code>.</p></div></div>
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
    return JSON.parse(localStorage.getItem("adr-kit:prefs") || "{}");
  } catch {
    return {};
  }
}
function savePrefs(patch) {
  try {
    localStorage.setItem("adr-kit:prefs", JSON.stringify({ ...prefs(), ...patch }));
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
setupLive(site);
route();
