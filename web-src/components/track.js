// Track: an animated flow scene (stations on a grid, a token riding rails, scenarios as tabs).
// The renderer only places the source; the app's web/track.js parses, lays out and plays it,
// so the engine can change without rebuilding this bundle.

export const track = {
  name: "track",
  summary: "Animated flow: stations on a grid, a token that travels, scenarios as tabs, a lanes view of the same beats.",
  syntax: `\`\`\`track
title: Purchase
token: 0200 purchase            ← what travels
state: status=new, rows=0       ← shown in the inspector, changed by beats
stations:                       ← grid map, "." is empty
  pos  session  parser
  .    .        domain
station pos "POS" kind=actor sub="PEP-ISO"   ← kinds: actor service store queue external hsm job state key gate hub terminal
scenario ok "Approved" tone=ok outcome="code 0"
scenario late "No answer" tone=fail
== Ingress ==                   ← phase (stage pill)
pos -> session : tcp 0200       ← sync hop; ~> async; <-> round trip
parser <-> domain : CreateTransaction | rows+=1
[late] at shaparak: no answer | fail, status=unknown
[!late] shaparak ~> session : 0210 | ok
note: narration for the beat above
wait 15m : settlement job      ← time passes
par … end · loop 3 "retry" … end · when a,b … end
\`\`\`
- Tags in [ ] pick the scenarios a beat plays in; [!x] leaves it out of x. Untagged beats play everywhere.
- Ops after |: ok, fail, warn, key=value, key+=1, token "new label".`,
  example: "```track\ntitle: Hello\nstations:\n  client  api  db\nstation client kind=actor\nstation db kind=store\nclient -> api : GET /hello\napi <-> db : select | rows=1\napi -> client : 200 | ok\n```",
  render(text, { esc }) {
    const src = esc(text).replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
    return `<figure class="ak-track" data-track data-src="${src}"><div class="tk-err" style="padding:12px;color:#888;font:12px ui-monospace,monospace">loading track…</div></figure>`;
  },
};
