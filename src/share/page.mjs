// The page teammates open: /i/<slug>. Notes mode (meeting) and review mode share one page.
export function pageHtml({ slug = "", needPass = false, landing = false, missing = false } = {}) {
  const shell = (body, script = "") => `<!doctype html>
<html lang="en" data-theme="blueprint"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Decision</title><link rel="stylesheet" href="/assets/app.css"><style>${CSS}</style></head>
<body>${body}<div class="ak-toast" id="toast"></div>${script ? `<script>${script}</script>` : ""}</body></html>`;
  if (landing) return shell(`<main class="sh-wrap"><div class="sh-empty"><h1>ADR share server</h1><p class="muted">Open a link someone sent you. Owners publish with <code>adr notes</code> and <code>adr share</code>.</p></div></main>`);
  if (missing) return shell(`<main class="sh-wrap"><div class="sh-empty"><h1>Not found</h1><p class="muted">This link is wrong or the question was removed.</p></div></main>`);
  if (needPass)
    return shell(
      `<main class="sh-wrap"><form class="sh-gate am-panel" id="gate"><header class="am-panel-head"><span class="am-panel-id">#</span><h2>Team passcode</h2></header><div class="am-panel-body"><p class="muted">Ask the person who shared this link.</p><input class="sh-in" type="password" id="pc" autofocus placeholder="passcode"><button class="ak-btn" style="margin-top:10px">Enter</button><div id="err" class="sh-err"></div></div></form></main>`,
      `document.getElementById("gate").onsubmit=async(e)=>{e.preventDefault();const r=await fetch("/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({passcode:document.getElementById("pc").value})});if(r.ok)location.reload();else document.getElementById("err").textContent="Wrong passcode";};`,
    );
  return shell(`<header class="ak-top"><div class="ak-top-in"><span class="ak-brand"><i>ADR</i><span id="repo"></span></span><div class="sh-who" id="who"></div></div></header><main class="sh-wrap" id="app"><div class="ak-empty">Loading…</div></main>`, APP.replace("__SLUG__", slug));
}

const CSS = `
.sh-wrap { max-width: 1320px; margin: 0 auto; padding: 22px 20px 80px; }
.sh-empty { text-align: center; padding: 80px 20px; }
.sh-gate { max-width: 380px; margin: 80px auto; }
.sh-in, .sh-ta, .sh-sel { width: 100%; font: 14px var(--font-sans); padding: 8px 10px; border: 1.5px solid var(--line-2); background: var(--paper); color: var(--ink); }
.sh-in:focus, .sh-ta:focus, .sh-sel:focus { outline: none; border-color: var(--accent); }
.sh-ta { min-height: 70px; resize: vertical; }
.sh-err { color: var(--err); font-size: 13px; margin-top: 6px; }
.sh-who { margin-left: auto; display: flex; align-items: center; gap: 8px; font: 12.5px var(--font-mono); }
.sh-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 10px 20px; margin-bottom: 16px; }
.sh-head h1 { margin: 4px 0 0; font-size: 25px; letter-spacing: -0.015em; }
.sh-head .mono { color: var(--ink-3); }
.sh-mode { display: inline-flex; align-items: center; gap: 6px; font: 600 11.5px var(--font-mono); padding: 5px 10px; border: 1.5px solid; }
.sh-mode--notes { color: var(--warn); background: var(--warn-bg); }
.sh-mode--review { color: var(--accent); background: var(--accent-bg); }
.sh-mode--final { color: var(--ak-green); background: var(--ak-green-bg); }
.sh-mode--closed { color: var(--ink-2); background: var(--fill); }
.sh-cols { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: start; }
@media (max-width: 1000px) { .sh-cols { grid-template-columns: minmax(0, 1fr); } }
.sh-side { position: sticky; top: 64px; display: grid; gap: 14px; max-height: calc(100vh - 80px); overflow-y: auto; }
@media (max-width: 1000px) { .sh-side { position: static; max-height: none; } }
.sh-q { border: 2px solid var(--warn); background: var(--warn-bg); padding: 14px 16px; }
.sh-q small { font: 700 10.5px var(--font-mono); letter-spacing: .08em; color: #fff; background: var(--warn); padding: 3px 7px; }
.sh-q div { margin-top: 8px; font-size: 19px; font-weight: 600; line-height: 1.4; }
.sh-ctx { white-space: pre-wrap; font-size: 14px; }
.sh-lbl { font: 600 10.5px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 6px; }
.sh-av { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; color: #fff; font: 700 10px var(--font-sans); flex: none; }
.sh-av--sm { width: 18px; height: 18px; font-size: 8px; }
.sh-entry { border: 1px solid var(--line-2); border-left: 4px solid var(--c, var(--line-2)); background: var(--paper); padding: 9px 12px; font-size: 13.5px; }
.sh-entry + .sh-entry { margin-top: 8px; }
.sh-entry .top { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-3); margin-bottom: 4px; flex-wrap: wrap; }
.sh-entry .top time { margin-left: auto; font: 11px var(--font-mono); }
.sh-entry .why { margin-top: 4px; font-size: 12.5px; color: var(--ink-2); padding-left: 8px; border-left: 2px solid var(--line-2); }
.sh-entry .reply { margin-top: 8px; padding: 6px 10px; background: var(--fill); font-size: 12.5px; border-left: 3px solid var(--ink); }
.k-pro { --c: var(--ak-green); } .k-con { --c: var(--err); } .k-answer { --c: var(--accent); } .k-pick { --c: var(--ink); } .k-note { --c: var(--warn); } .k-comment { --c: var(--line-2); }
.sh-kind { font: 600 10px var(--font-mono); text-transform: uppercase; letter-spacing: .05em; padding: 1px 5px; border: 1px solid currentColor; }
.sh-opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px; }
.sh-opts button { text-align: left; padding: 8px 10px; border: 1.5px solid var(--line-2); background: var(--paper); cursor: pointer; font-size: 13px; }
.sh-opts button.on { border: 2.5px solid var(--ak-green); background: var(--ak-green-bg); font-weight: 600; }
.sh-seg { display: inline-flex; border: 1.5px solid var(--line-2); }
.sh-seg button { border: 0; background: var(--paper); padding: 5px 10px; cursor: pointer; font-size: 12.5px; }
.sh-seg button + button { border-left: 1px solid var(--line-2); }
.sh-seg button.on { background: var(--ink); color: #fff; }
.sh-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.sh-pickbar { display: grid; gap: 6px; }
.sh-pickbar .r { display: grid; grid-template-columns: 22px minmax(0, 1fr) 30px; gap: 8px; align-items: center; font-size: 13px; }
.sh-pickbar .bar { height: 20px; background: var(--fill); border: 1px solid var(--line-2); display: flex; align-items: center; gap: 2px; padding: 0 3px; }
.sh-final { border: 2px solid var(--ak-green); background: var(--ak-green-bg); padding: 14px 16px; margin-bottom: 16px; }
.sh-final small { font: 700 10.5px var(--font-mono); letter-spacing: .08em; color: #fff; background: var(--ak-green); padding: 3px 7px; }
.sh-final div { margin-top: 8px; font-size: 17px; font-weight: 600; }
.sh-snap a[href^="#"] { pointer-events: none; }
.sh-modal { position: fixed; inset: 0; background: rgba(15,18,24,.45); display: grid; place-items: center; z-index: 90; padding: 16px; }
.sh-modal form { width: min(380px, 100%); }
`;

const APP = `
const SLUG = "__SLUG__";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const color = (h) => "hsl(" + [...String(h)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7) + " 55% 40%)";
const av = (h, sm) => '<span class="sh-av' + (sm ? " sh-av--sm" : "") + '" style="background:' + color(h) + '" title="@' + esc(h) + '">' + esc(String(h).replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase()) + "</span>";
const ago = (t) => { const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? "now" : s < 3600 ? Math.floor(s / 60) + "m" : s < 86400 ? Math.floor(s / 3600) + "h" : Math.floor(s / 86400) + "d"; };
let item = null, me = localStorage.getItem("adr-share:me") || "", pick = null, conf = 60, argKind = "pro";
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
    m.querySelector("form").onsubmit = (e) => { e.preventDefault(); const v = m.querySelector("#h").value.trim().replace(/^@/, ""); if (!v) return; me = v; localStorage.setItem("adr-share:me", v); m.remove(); renderWho(); ok(v); };
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
  $("#chg").onclick = (e) => { e.preventDefault(); localStorage.removeItem("adr-share:me"); me = ""; ensureMe(); };
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
      '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">✎</span><h2>Notes</h2><span class="am-panel-meta">' + item.entries.length + " · live</span></header><div class=\\"am-panel-body\\">" + feed + "</div></section></div>" +
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
      (myQs.length ? '<section class="am-panel" style="border-color:var(--accent)"><header class="am-panel-head"><span class="am-panel-id" style="background:var(--accent)">?</span><h2>' + (me ? "Questions for you" : "Questions") + "</h2></header><div class=\\"am-panel-body\\" style=\\"display:grid;gap:12px\\">" + myQs.map((q) => '<div><div style="font-weight:600;font-size:13.5px">' + esc(q.text) + (q.to ? ' <span class="dim mono" style="font-weight:400">@' + esc(q.to) + "</span>" : "") + '</div><textarea class="sh-ta" data-answer="' + q.i + '" placeholder="Your answer" style="min-height:52px;margin-top:6px"></textarea><div class="sh-row" style="justify-content:flex-end;margin-top:6px"><button class="ak-btn" data-send-answer="' + q.i + '">Answer</button></div></div>').join("") + "</div></section>" : "") +
      '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">✓</span><h2>Your pick</h2></header><div class="am-panel-body"><div class="sh-opts">' + opts.map((o) => '<button class="' + (pick === o.key ? "on" : "") + '" data-pick="' + esc(o.key) + '"><b>' + esc(o.key) + "</b> " + esc(o.name) + "</button>").join("") + '</div><div class="sh-row" style="margin-top:8px;font-size:12.5px;color:var(--ink-2)">confidence <input type="range" min="0" max="100" value="' + conf + '" id="conf" style="flex:1"><span class="mono" id="confv">' + conf + '%</span></div><textarea class="sh-ta" id="pickWhy" placeholder="Why? (one or two sentences)" style="min-height:52px;margin-top:6px"></textarea><div class="sh-row" style="justify-content:flex-end;margin-top:6px"><button class="ak-btn" id="sendPick">Send pick</button></div></div></section>' +
      '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">±</span><h2>Add a pro or con</h2></header><div class="am-panel-body" style="display:grid;gap:8px"><div class="sh-row"><span class="sh-seg" id="argKind"><button data-k="pro" class="' + (argKind === "pro" ? "on" : "") + '">+ Pro</button><button data-k="con" class="' + (argKind === "con" ? "on" : "") + '">− Con</button></span><select class="sh-sel" id="argOpt" style="width:auto">' + opts.map((o) => '<option value="' + esc(o.key) + '">option ' + esc(o.key) + " — " + esc(o.name) + "</option>").join("") + '</select></div><input class="sh-in" id="argText" placeholder="The point, in one line"><textarea class="sh-ta" id="argWhy" placeholder="Reason — required: evidence, numbers, experience" style="min-height:52px"></textarea><div class="sh-row" style="justify-content:flex-end"><button class="ak-btn" id="sendArg">Add</button></div></div></section>' +
      '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">💬</span><h2>Comment</h2></header><div class="am-panel-body"><select class="sh-sel" id="cTarget" style="margin-bottom:6px"><option value="">whole decision</option></select><textarea class="sh-ta" id="cText" placeholder="Anything else"></textarea><div class="sh-row" style="justify-content:flex-end;margin-top:6px"><button class="ak-btn" id="sendC">Comment</button></div></div></section>'
    ) : '<section class="am-panel"><div class="am-panel-body muted">' + (mode === "final" ? "This decision is final. Thanks for your input." : "Review is closed.") + "</div></section>";
    html += final + '<div class="sh-cols"><div style="display:grid;gap:16px"><div class="sh-snap ak-body">' + (item.snapshot?.html || "") + "</div>" +
      '<section class="am-panel"><header class="am-panel-head"><span class="am-panel-id">T</span><h2>Team input</h2><span class="am-panel-meta">' + item.entries.length + " · live</span></header><div class=\\"am-panel-body\\">" + picks() + (otherQs.length ? '<div class="sep" style="height:1px;background:var(--line-2);margin:12px 0"></div><div class="sh-lbl">Asked to others</div>' + otherQs.map((q) => '<div style="font-size:13px">@' + esc(q.to) + ": " + esc(q.text) + "</div>").join("") : "") + '<div style="height:12px"></div>' + feed + "</div></section></div>" +
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
`;
