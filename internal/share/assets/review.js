// The page teammates open: /i/<slug>. Notes mode (meeting) and review mode share it.
import { renderAdr, themeCss } from "/assets/crux-render.js";
const SLUG = document.getElementById("app").dataset.slug;
document.head.insertAdjacentHTML("beforeend", "<style>" + themeCss() + "</style>");
function snapHtml(sn) {
  if (!sn) return "";
  const byId = new Map(Object.entries(sn.refs || {}).map(([id, r]) => [id, { id, ...r }]));
  return renderAdr({ id: item.adr?.id, statusKey: sn.statusKey, source: sn.source }, { byId }, { prefix: sn.prefix || "ADR", digits: sn.digits || 4 }, { forShare: true }).html;
}
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const color = (h) => "hsl(" + [...String(h)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7) + " 55% 40%)";
const av = (h, sm) => '<span class="sh-av' + (sm ? " sh-av--sm" : "") + '" style="background:' + color(h) + '" title="@' + esc(h) + '">' + esc(String(h).replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase()) + "</span>";
const ago = (t) => { const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? "now" : s < 3600 ? Math.floor(s / 60) + "m" : s < 86400 ? Math.floor(s / 3600) + "h" : Math.floor(s / 86400) + "d"; };
let item = null, me = localStorage.getItem("crux:me") || "", pick = null, conf = 60, argKind = "pro";
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2000); }

async function load() {
  const r = await fetch("/api/items/" + SLUG, { cache: "no-store" });
  if (r.status === 403) return location.reload();
  item = await r.json();
  const mine = item.entries.find((e) => e.kind === "pick" && e.by === me);
  if (mine && pick == null) { pick = mine.opt; conf = mine.conf; }
  render();
}

function ensureMe() {
  return new Promise((ok) => {
    if (me) return ok(me);
    const m = document.createElement("div");
    m.className = "sh-modal";
    m.innerHTML = '<form class="am-panel"><header class="am-panel-head"><span class="am-panel-id">@</span><h2>Who are you?</h2></header><div class="am-panel-body"><p class="muted" style="margin-top:0">Your git handle, so the owner knows who said what.</p><input class="sh-in" id="h" placeholder="e.g. sara-dev" autofocus><button class="ak-btn" style="margin-top:10px">Continue</button></div></form>';
    document.body.append(m);
    m.querySelector("form").onsubmit = (e) => { e.preventDefault(); const v = m.querySelector("#h").value.trim().replace(/^@/, ""); if (!v) return; me = v; localStorage.setItem("crux:me", v); m.remove(); renderWho(); ok(v); };
  });
}

async function post(entry) {
  await ensureMe();
  const r = await fetch("/api/items/" + SLUG + "/entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...entry, by: me }) });
  const j = await r.json();
  if (!r.ok) { toast(j.error || "Could not send"); return false; }
  toast("Sent to @" + item.owner);
  return true;
}

function renderWho() {
  $("#who").innerHTML = me ? av(me, 1) + " @" + esc(me) + ' <a href="#" id="chg" style="font-size:11px">change</a>' : '<a href="#" id="chg">set your name</a>';
  $("#chg").onclick = (e) => { e.preventDefault(); localStorage.removeItem("crux:me"); me = ""; ensureMe(); };
}

function entryHtml(e) {
  const opt = e.opt ? '<span class="ak-chip" style="padding:1px 5px">option ' + esc(e.opt) + "</span>" : "";
  const kind = e.kind === "pick" ? "picked " + esc(e.opt) + " · " + e.conf + "%" : e.kind;
  return '<div class="sh-entry k-' + e.kind + '"><div class="top">' + av(e.by, 1) + " @" + esc(e.by) + ' <span class="sh-kind">' + kind + "</span>" + (e.kind !== "pick" ? opt : "") + (e.target ? ' <span class="dim">on ' + esc(e.target) + "</span>" : "") + "<time>" + ago(e.at) + "</time></div>" +
    (e.text ? esc(e.text) : "") + (e.why ? '<div class="why">' + esc(e.why) + "</div>" : "") +
    (e.reply ? '<div class="reply"><b>@' + esc(item.owner) + "</b> · " + esc(e.reply.kind) + (e.reply.text ? " — " + esc(e.reply.text) : "") + "</div>" : "") + "</div>";
}

function picks() {
  const opts = item.snapshot?.options ?? [];
  const ps = item.entries.filter((e) => e.kind === "pick");
  if (!opts.length) return "";
  return '<div class="sh-pickbar">' + opts.map((o) => { const who = ps.filter((p) => p.opt === o.key); return '<div class="r"><span class="opt-key ak-opt-key-sm" style="font:700 12px var(--font-mono)">' + esc(o.key) + '</span><span class="bar">' + who.map((p) => av(p.by, 1)).join("") + '</span><span class="mono">' + who.length + "</span></div>"; }).join("") + "</div>";
}

function render() {
  $("#repo").textContent = item.repo || "decision";
  document.title = (item.adr?.id ? "ADR-" + item.adr.id + " · " : "") + (item.adr?.title || "Decision");
  renderWho();
  const mode = item.mode;
  const modeLabel = { notes: "◐ Open for notes", review: "◉ In review", final: "✓ Decided", closed: "Closed" }[mode] || mode;
  const head = '<div class="sh-head"><div><div class="mono" style="font-size:12px">ADR-' + esc(item.adr?.id) + " · owner " + av(item.owner, 1) + " @" + esc(item.owner) + '</div><h1>' + esc(item.adr?.title || item.question) + '</h1></div><span class="sh-mode sh-mode--' + mode + '">' + modeLabel + "</span></div>";
  const feed = item.entries.slice().reverse().map(entryHtml).join("") || '<div class="ak-empty">Nothing yet. Be the first.</div>';
  let html = head;
  if (mode === "notes" || (!item.snapshot && mode !== "final")) {
    html += '<div class="sh-cols"><div style="display:grid;gap:16px"><div class="sh-q"><small>QUESTION</small><div>' + esc(item.question) + "</div></div>" +
      (item.context ? '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">i</span><h2>What we know</h2></header><div class="am-panel-body sh-ctx">' + esc(item.context) + "</div></section>" : "") +
      '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">✎</span><h2>Notes</h2><span class="am-panel-meta">' + item.entries.length + " · live</span></header><div class=\"am-panel-body\">" + feed + "</div></section></div>" +
      '<aside class="sh-side"><section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">+</span><h2>Add a note</h2></header><div class="am-panel-body">' +
      (mode === "notes" ? '<textarea class="sh-ta" id="note" placeholder="A fact, a worry, an idea, a question… (⌘↵ to send)"></textarea><div class="sh-row" style="margin-top:8px;justify-content:flex-end"><button class="ak-btn" id="sendNote">Add note</button></div>' : '<p class="muted">Notes are closed.</p>') +
      '<p class="muted" style="font-size:12px;margin-bottom:0">The owner sees notes live and folds them into the draft.</p></div></section></aside></div>';
  } else {
    const opts = item.snapshot?.options ?? [];
    const myQs = (item.snapshot?.questions ?? []).map((q, i) => ({ ...q, i })).filter((q) => !q.to || q.to === me);
    const otherQs = (item.snapshot?.questions ?? []).filter((q) => q.to && q.to !== me);
    const final = item.final ? '<div class="sh-final"><small>DECIDED · OPTION ' + esc(item.final.option) + "</small><div>" + esc(item.final.decision) + "</div></div>" : "";
    const open = mode === "review";
    const side = open ? (
      (item.snapshot?.leaning ? '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">L</span><h2>Owner is leaning</h2></header><div class="am-panel-body"><b>' + esc(item.snapshot.leaning.opt) + " — " + esc(opts.find((o) => o.key === item.snapshot.leaning.opt)?.name) + '</b><div class="muted" style="font-size:13px;margin-top:4px">' + esc(item.snapshot.leaning.why) + "</div></div></section>" : "") +
      (!me && (item.snapshot?.questions ?? []).some((q) => q.to) ? '<section class="am-panel"><div class="am-panel-body"><b>Questions may be waiting for you.</b><p class="muted" style="margin:4px 0 8px;font-size:13px">Set your handle to see them.</p><button class="ak-btn" id="setMe">Set my handle</button></div></section>' : "") +
      (myQs.length ? '<section class="am-panel" style="border-color:var(--accent)"><header class="am-panel-head"><span class="am-panel-id" style="background:var(--accent)">?</span><h2>' + (me ? "Questions for you" : "Questions") + "</h2></header><div class=\"am-panel-body\" style=\"display:grid;gap:12px\">" + myQs.map((q) => '<div><div style="font-weight:600;font-size:13.5px">' + esc(q.text) + (q.to ? ' <span class="dim mono" style="font-weight:400">@' + esc(q.to) + "</span>" : "") + '</div><textarea class="sh-ta" data-answer="' + q.i + '" placeholder="Your answer" style="min-height:52px;margin-top:6px"></textarea><div class="sh-row" style="justify-content:flex-end;margin-top:6px"><button class="ak-btn" data-send-answer="' + q.i + '">Answer</button></div></div>').join("") + "</div></section>" : "") +
      '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">✓</span><h2>Your pick</h2></header><div class="am-panel-body"><div class="sh-opts">' + opts.map((o) => '<button class="' + (pick === o.key ? "on" : "") + '" data-pick="' + esc(o.key) + '"><b>' + esc(o.key) + "</b> " + esc(o.name) + "</button>").join("") + '</div><div class="sh-row" style="margin-top:8px;font-size:12.5px;color:var(--ink-2)">confidence <input type="range" min="0" max="100" value="' + conf + '" id="conf" style="flex:1"><span class="mono" id="confv">' + conf + '%</span></div><textarea class="sh-ta" id="pickWhy" placeholder="Why? (one or two sentences)" style="min-height:52px;margin-top:6px"></textarea><div class="sh-row" style="justify-content:flex-end;margin-top:6px"><button class="ak-btn" id="sendPick">Send pick</button></div></div></section>' +
      '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">±</span><h2>Add a pro or con</h2></header><div class="am-panel-body" style="display:grid;gap:8px"><div class="sh-row"><span class="sh-seg" id="argKind"><button data-k="pro" class="' + (argKind === "pro" ? "on" : "") + '">+ Pro</button><button data-k="con" class="' + (argKind === "con" ? "on" : "") + '">− Con</button></span><select class="sh-sel" id="argOpt" style="width:auto">' + opts.map((o) => '<option value="' + esc(o.key) + '">option ' + esc(o.key) + " — " + esc(o.name) + "</option>").join("") + '</select></div><input class="sh-in" id="argText" placeholder="The point, in one line"><textarea class="sh-ta" id="argWhy" placeholder="Reason — required: evidence, numbers, experience" style="min-height:52px"></textarea><div class="sh-row" style="justify-content:flex-end"><button class="ak-btn" id="sendArg">Add</button></div></div></section>' +
      '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">💬</span><h2>Comment</h2></header><div class="am-panel-body"><select class="sh-sel" id="cTarget" style="margin-bottom:6px"><option value="">whole decision</option></select><textarea class="sh-ta" id="cText" placeholder="Anything else"></textarea><div class="sh-row" style="justify-content:flex-end;margin-top:6px"><button class="ak-btn" id="sendC">Comment</button></div></div></section>'
    ) : '<section class="am-panel"><div class="am-panel-body muted">' + (mode === "final" ? "This decision is final. Thanks for your input." : "Review is closed.") + "</div></section>";
    html += final + '<div class="sh-cols"><div style="display:grid;gap:16px"><div class="sh-snap ak-body">' + snapHtml(item.snapshot) + "</div>" +
      '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">T</span><h2>Team input</h2><span class="am-panel-meta">' + item.entries.length + " · live</span></header><div class=\"am-panel-body\">" + picks() + (otherQs.length ? '<div class="sep" style="height:1px;background:var(--line-2);margin:12px 0"></div><div class="sh-lbl">Asked to others</div>' + otherQs.map((q) => '<div style="font-size:13px">@' + esc(q.to) + ": " + esc(q.text) + "</div>").join("") : "") + '<div style="height:12px"></div>' + feed + "</div></section></div>" +
      '<aside class="sh-side">' + side + "</aside></div>";
  }
  $("#app").innerHTML = html;
  const tsel = $("#cTarget");
  if (tsel) document.querySelectorAll(".sh-snap [data-title]").forEach((p) => tsel.insertAdjacentHTML("beforeend", '<option>' + esc(p.dataset.title) + "</option>"));
  const c = $("#conf");
  if (c) c.oninput = () => { conf = +c.value; $("#confv").textContent = conf + "%"; };
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button,[data-pick]");
  if (!t) return;
  if (t.id === "setMe") { await ensureMe(); return render(); }
  if (t.id === "sendNote") { const v = $("#note").value.trim(); if (v && (await post({ kind: "note", text: v }))) $("#note").value = ""; }
  if (t.dataset.pick) { pick = t.dataset.pick; document.querySelectorAll("[data-pick]").forEach((b) => b.classList.toggle("on", b === t)); }
  if (t.id === "sendPick") { if (!pick) return toast("Choose an option"); await post({ kind: "pick", opt: pick, conf, text: $("#pickWhy").value.trim() }); }
  if (t.closest("#argKind")) { argKind = t.dataset.k; document.querySelectorAll("#argKind button").forEach((b) => b.classList.toggle("on", b === t)); }
  if (t.id === "sendArg") { const text = $("#argText").value.trim(), why = $("#argWhy").value.trim(); if (!text) return toast("Write the point"); if (!why) return toast("Add a reason — it is what makes it weighable"); if (await post({ kind: argKind, opt: $("#argOpt").value, text, why })) { $("#argText").value = ""; $("#argWhy").value = ""; } }
  if (t.id === "sendC") { const v = $("#cText").value.trim(); if (v && (await post({ kind: "comment", text: v, target: $("#cTarget").value }))) $("#cText").value = ""; }
  if (t.dataset.sendAnswer != null) { const i = t.dataset.sendAnswer, ta = document.querySelector('[data-answer="' + i + '"]'), q = item.snapshot.questions[i]; if (ta.value.trim() && (await post({ kind: "answer", text: ta.value.trim(), target: q.text }))) ta.value = ""; }
});
document.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && document.activeElement?.id === "note") $("#sendNote").click(); });

// Live: re-render on changes, but keep what the user is typing.
const es = new EventSource("/api/items/" + SLUG + "/events");
es.onmessage = async () => {
  const keep = [...document.querySelectorAll("textarea,input[type=text],input:not([type])")].map((x) => [x.id || x.dataset.answer, x.value]);
  const focus = document.activeElement?.id;
  await load();
  for (const [k, v] of keep) { const el = document.getElementById(k) || document.querySelector('[data-answer="' + k + '"]'); if (el) el.value = v; }
  if (focus) document.getElementById(focus)?.focus();
};
load();
