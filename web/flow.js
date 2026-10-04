// The decision flow inside the local app: where a decision is, who can see it, what the
// team said, and the actions that move it on. Write actions only exist when served locally.
import { $, $$, S, esc, href, optionStats, toast } from "./util.js";

export const api = async (path, body) => {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-adr": "1" }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
};

const STAGES = [
  ["Capture", "question + notes", "you"],
  ["Enrich", "your Claude Code", "you"],
  ["Shape", "options, scenarios", "you"],
  ["Review", "team input", "team"],
  ["Final", "you decide", "you"],
];

export function shareOf(a) {
  return S.site.share?.items?.[a.id] ?? null;
}

function stageOf(a) {
  const sh = shareOf(a);
  if (["accepted", "rejected", "superseded", "deprecated"].includes(a.statusKey)) return 4;
  if (a.statusKey === "review" || sh?.mode === "review") return 3;
  if (a.facts.options.length || a.sections.some((s) => /^options?|^scenarios/i.test(s.title))) return 2;
  if (a.sections.length > 2) return 1;
  return 0;
}

export function privacy(a) {
  const sh = shareOf(a);
  if (["accepted"].includes(a.statusKey)) return `<span class="ak-priv ak-priv--done">✓ Decided</span>`;
  if (sh?.mode === "review") return `<span class="ak-priv ak-priv--shared">◉ Shared for review</span>`;
  if (sh?.mode === "notes") return `<span class="ak-priv ak-priv--notes">◐ Question open for notes · draft stays local</span>`;
  if (a.statusKey === "draft") return `<span class="ak-priv ak-priv--local">● Private draft · only on your laptop</span>`;
  return "";
}

export function flowStrip(a) {
  if (!S.site.local || !["draft", "open", "review", "accepted"].includes(a.statusKey)) return "";
  const cur = stageOf(a);
  return `<nav class="ak-flow" aria-label="Decision flow">${STAGES.map(([t, s, w], i) => `<div class="ak-flow-step ${i < cur ? "done" : ""} ${i === cur ? "now" : ""}"><b>${i < cur ? "✓" : i + 1}</b><span>${t}<small>${s}</small></span><em class="ak-flow-who ak-flow-who--${w}">${w === "you" ? "YOU" : "TEAM"}</em></div>`).join("")}</nav>`;
}

// ── rail: sharing controls ──────────────────────────────────────────
export function sharePanel(a) {
  if (!S.site.local || !["draft", "open", "review", "proposed", "accepted"].includes(a.statusKey)) return "";
  const s = S.site.share ?? {};
  const sh = shareOf(a);
  let body;
  if (!s.url) body = `<p class="muted" style="margin:0 0 8px;font-size:13px">No share server set. To collect notes and reviews from the team:</p><pre class="ak-mini-code">share: https://adr.your-domain.com</pre><p class="muted" style="font-size:12px;margin:6px 0 0">in adr.config.yaml, then <span class="mono">adr login &lt;url&gt; --token …</span></p>`;
  else if (!s.loggedIn) body = `<p class="muted" style="margin:0;font-size:13px">Log in to <span class="mono">${esc(s.url)}</span>:</p><pre class="ak-mini-code">adr login ${esc(s.url)} --token …</pre>`;
  else if (!sh)
    body = `<p class="muted" style="margin:0 0 10px;font-size:13px">Only you can see this. Share when you want input.</p><div class="ak-share-acts"><button class="ak-btn" data-flow="notes">◐ Open for notes</button>${a.facts.options.length ? `<button class="ak-btn ak-btn--primary" data-flow="share">◉ Share for review</button>` : ""}</div><p class="muted" style="font-size:11.5px;margin:8px 0 0">Notes: the room sees only the question. Review: the team sees this page and gives picks, pros, cons and answers.</p>`;
  else
    body = `<div class="ak-share-url"><span class="mono">${esc(sh.url)}</span><button class="ak-btn ak-btn--ghost" data-copy-text="${esc(sh.url)}">Copy</button></div>
    <div class="muted" style="font-size:12px;margin:6px 0 10px">${sh.mode === "notes" ? "Open for notes" : sh.mode === "review" ? "Open for review" : sh.mode === "final" ? "Showing the decision" : "Closed"} · <span id="team-count">…</span></div>
    <div class="ak-share-acts">${sh.mode === "notes" && a.facts.options.length ? `<button class="ak-btn ak-btn--primary" data-flow="share">◉ Share for review</button>` : ""}${sh.mode === "review" ? `<button class="ak-btn" data-flow="share" title="Send your latest edits to reviewers">↻ Update review</button>` : ""}${["notes", "review"].includes(sh.mode) ? `<button class="ak-btn ak-btn--ghost" data-flow="close">Close</button>` : ""}<button class="ak-btn ak-btn--ghost" data-flow="pull" title="Write team input to .adr/reviews for your Claude">⇣ For my Claude</button></div>`;
  return `<section class="ak-box"><header class="am-panel-head"><span class="am-panel-id">⇄</span><h2>Sharing</h2></header><div class="ak-box-body">${body}</div></section>`;
}

// ── body: team input, live ──────────────────────────────────────────
const KIND_LABEL = { note: "note", pro: "pro", con: "con", answer: "answer", comment: "comment", pick: "pick" };
const REPLIES = [["agreed", "Agree"], ["added to ADR", "Added"], ["noted", "Noted"]];
let tagState = {};

function entryHtml(e, owner) {
  const head = `<div class="ak-te-top"><span class="mono">@${esc(e.by)}</span><span class="ak-te-kind ak-te-kind--${e.kind}">${e.kind === "pick" ? `picked ${esc(e.opt)} · ${e.conf}%` : KIND_LABEL[e.kind]}${e.opt && e.kind !== "pick" ? ` · ${esc(e.opt)}` : ""}</span>${e.target ? `<span class="dim">on ${esc(e.target)}</span>` : ""}<time>${esc(e.at.slice(5, 16).replace("T", " "))}</time></div>`;
  const body = `${e.text ? `<div>${esc(e.text)}</div>` : ""}${e.why ? `<div class="ak-te-why">${esc(e.why)}</div>` : ""}`;
  let foot = "";
  if (e.kind === "note") {
    foot = `<div class="ak-te-acts"><span class="dim">add to draft as</span>${["context", "option", "pro", "con", "question"].map((t) => `<button class="${tagState[e.id] === t ? "on" : ""}" data-tag="${e.id}:${t}">${t}</button>`).join("")}<button class="ak-te-go" data-import="${e.id}">Add →</button></div>`;
  } else if (e.kind !== "pick") {
    foot = e.reply
      ? `<div class="ak-te-reply"><b>you</b> · ${esc(e.reply.kind)}${e.reply.text ? ` — ${esc(e.reply.text)}` : ""}</div>`
      : `<div class="ak-te-acts">${REPLIES.map(([k, l]) => `<button data-reply="${e.id}:${k}">${l}</button>`).join("")}<button data-reply="${e.id}:replied:ask">Reply…</button></div>`;
  }
  return `<div class="ak-te ak-te--${e.kind}">${head}${body}${foot}</div>`;
}

export function teamHtml(a, data) {
  if (!data?.shared) return "";
  if (data.error) return `<section class="am-panel ak-team"><header class="am-panel-head"><span class="am-panel-id">T</span><h2>Team input</h2></header><div class="am-panel-body"><div class="ak-error">Share server: ${esc(data.error)}</div></div></section>`;
  const item = data.item;
  const opts = item.snapshot?.options ?? [];
  const picks = item.entries.filter((e) => e.kind === "pick");
  const open = item.entries.filter((e) => !["note", "pick"].includes(e.kind) && !e.reply).length;
  const bar = opts.length
    ? `<div class="ak-team-picks">${opts.map((o) => { const who = picks.filter((p) => p.opt === o.key); return `<div><span class="mono"><b>${esc(o.key)}</b> ${esc(o.name)}</span><span class="ak-team-bar">${who.map((p) => `<i title="@${esc(p.by)} ${p.conf}% — ${esc(p.text)}" style="width:${(Math.max(15, p.conf) / Math.max(4, picks.length)).toFixed(1)}%">@${esc(p.by)}</i>`).join("")}</span><span class="mono">${who.length}</span></div>`; }).join("")}</div>`
    : "";
  const notes = item.entries.filter((e) => e.kind === "note");
  const rest = item.entries.filter((e) => e.kind !== "note" && e.kind !== "pick").concat(picks).reverse();
  return `<section class="am-panel ak-team" id="team"><header class="am-panel-head"><span class="am-panel-id">T</span><h2>Team input</h2><span class="am-panel-meta">${item.entries.length} · ${open ? `<b style="color:var(--warn)">${open} to answer</b>` : "all answered"} · live</span></header><div class="am-panel-body">
  ${bar}
  ${rest.length ? `<div class="ak-te-list">${rest.map((e) => entryHtml(e)).join("")}</div>` : `<div class="muted" style="font-size:13px">${item.mode === "review" ? "No reviews yet." : ""}</div>`}
  ${notes.length ? `<div class="ak-mini-label" style="margin-top:14px">Notes from the room · ${notes.length} <button class="ak-btn ak-btn--ghost" style="margin-left:8px;padding:3px 8px" data-import="all">Add all to draft</button></div><div class="ak-te-list">${notes.slice().reverse().map((e) => entryHtml(e)).join("")}</div>` : ""}
  </div></section>`;
}

// ── body: finalize ──────────────────────────────────────────────────
export function finalizeHtml(a) {
  if (!S.site.local || !["draft", "open", "review", "proposed"].includes(a.statusKey)) return "";
  const os = optionStats(a);
  if (!os.items.length) return "";
  const lean = os.ok[0];
  return `<section class="am-panel ak-final" id="finalize"><header class="am-panel-head"><span class="am-panel-id">✓</span><h2>Finalize</h2><span class="am-panel-meta">you decide · edits the markdown, you commit</span></header><div class="am-panel-body">
  <div class="ak-final-opts">${os.items.map((o, i) => { const k = o.key ?? String.fromCharCode(65 + i); return `<button class="${lean === o ? "on" : ""}" data-final-opt="${esc(k)}"><b>${esc(k)}</b> ${esc(o.name)}</button>`; }).join("")}</div>
  <div class="ak-mini-label" style="margin-top:12px">Decision — one to three sentences</div>
  <textarea class="ak-ta" id="final-text">${esc(a.facts.recommendation ?? "")}</textarea>
  <div class="ak-mini-label" style="margin-top:10px">Reopen when — one per line (agents check these)</div>
  <textarea class="ak-ta" id="final-reopen" style="min-height:52px" placeholder="writes > 3,000/s&#10;a consumer needs replay > 14 days"></textarea>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:10px;flex-wrap:wrap"><span class="muted" style="font-size:12px">Picks that differ are recorded as dissent. Reviewers see the decision.</span><button class="ak-btn ak-btn--green" data-flow="finalize">Accept</button></div>
  </div></section>`;
}

// ── new question ────────────────────────────────────────────────────
export function openNewQuestion() {
  if ($(".ak-modal")) return;
  const m = document.createElement("div");
  m.className = "ak-modal";
  const canShare = S.site.share?.url && S.site.share?.loggedIn;
  m.innerHTML = `<form class="am-panel ak-modal-box"><header class="am-panel-head"><span class="am-panel-id">?</span><h2>New question</h2><span class="am-panel-meta">private draft</span></header><div class="am-panel-body" style="display:grid;gap:10px">
    <div><div class="ak-mini-label">The question</div><input class="ak-in ak-in--big" name="question" placeholder="Which broker do we use for v1?" required autofocus></div>
    <div><div class="ak-mini-label">What we know — rough is fine</div><textarea class="ak-ta" name="notes" placeholder="- one line per thought"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end"><div><div class="ak-mini-label">Needed by</div><input class="ak-in" name="due" placeholder="Oct 11"></div>
    ${canShare ? `<label style="display:flex;gap:6px;align-items:center;font-size:13px;padding-bottom:8px"><input type="checkbox" name="openNotes"> open for notes now</label>` : ""}</div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" class="ak-btn ak-btn--ghost" data-close>Cancel</button><button class="ak-btn ak-btn--primary">Create draft</button></div>
    <p class="muted" style="margin:0;font-size:12px">Then in Claude Code: <span class="mono">/adr enrich &lt;id&gt;</span> — it researches options and links related ADRs.</p>
  </div></form>`;
  document.body.append(m);
  m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) m.remove(); });
  m.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api("/api/new", { question: f.get("question"), notes: f.get("notes"), due: f.get("due"), openNotes: f.get("openNotes") === "on" });
      m.remove();
      if (r.url) { try { await navigator.clipboard.writeText(r.url); } catch {} toast("Open for notes — link copied"); }
      location.hash = `#/adr/${r.id}`;
    } catch (err) {
      toast(err.message);
    }
  };
}

// ── actions ─────────────────────────────────────────────────────────
export function bindFlow(a, rerender) {
  const handler = async (e) => {
    const t = e.target.closest("[data-flow],[data-keep],[data-drop],[data-reply],[data-tag],[data-import],[data-final-opt]");
    if (!t) return;
    e.preventDefault();
    const id = a.id;
    try {
      if (t.dataset.keep) { await api(`/api/doc/${id}/keep`, { title: t.dataset.keep }); toast("Kept"); }
      else if (t.dataset.drop) { await api(`/api/doc/${id}/drop`, { title: t.dataset.drop }); toast("Dropped"); }
      else if (t.dataset.tag) { const [eid, tag] = t.dataset.tag.split(":"); tagState[eid] = tagState[eid] === tag ? null : tag; return rerender(false); }
      else if (t.dataset.import) {
        const all = t.dataset.import === "all";
        const r = await api(`/api/doc/${id}/import`, all ? { tags: tagState } : { entries: [t.dataset.import], tags: tagState });
        toast(r.added ? `${r.added} note(s) added to ## Notes` : "Already in the draft");
      } else if (t.dataset.reply) {
        const [eid, kind, ask] = t.dataset.reply.split(":");
        const text = ask ? prompt("Your reply") : "";
        if (ask && !text) return;
        await api(`/api/doc/${id}/reply`, { entry: eid, kind, text });
        toast("Reply sent");
        return rerender(false);
      } else if (t.dataset.finalOpt) { $$("[data-final-opt]").forEach((b) => b.classList.toggle("on", b === t)); return; }
      else {
        const f = t.dataset.flow;
        if (f === "notes") { const r = await api(`/api/doc/${id}/notes`); try { await navigator.clipboard.writeText(r.url); } catch {} toast("Open for notes — link copied"); }
        if (f === "share") { const r = await api(`/api/doc/${id}/share`); try { await navigator.clipboard.writeText(r.url); } catch {} toast("Shared for review — link copied"); }
        if (f === "close") { await api(`/api/doc/${id}/close`); toast("Closed"); }
        if (f === "pull") { const r = await api(`/api/doc/${id}/pull`); toast(`Wrote ${r.file} — run /adr digest ${id}`); }
        if (f === "finalize") {
          const opt = $("[data-final-opt].on")?.dataset.finalOpt;
          if (!opt) return toast("Pick the option you chose");
          const decision = $("#final-text").value.trim();
          if (!decision) return toast("Write the decision in a sentence or two");
          if (!confirm(`Accept option ${opt} for ADR-${id}?`)) return;
          const r = await api(`/api/doc/${id}/finalize`, { option: opt, decision, reopen: $("#final-reopen").value.split("\n").map((x) => x.trim()).filter(Boolean) });
          toast(`Accepted${r.dissent ? ` · ${r.dissent} dissent recorded` : ""} — commit when ready`);
        }
      }
      rerender(true);
    } catch (err) {
      toast(err.message);
    }
  };
  document.addEventListener("click", handler);
  return () => document.removeEventListener("click", handler);
}
