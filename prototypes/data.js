// One story shared by the three prototypes: the x team decides the v1 message broker.
// Plain script (no modules) so the files open straight from disk.
window.STORY = {
  repo: "abtinokhovat/x",
  branch: "adr/0020-broker-v1",
  pr: 42,
  adr: {
    id: "0020",
    title: "Message broker for v1",
    question: "Which broker carries inbound buffering and domain events in v1: Redpanda, NATS JetStream, or no broker (PostgreSQL only)?",
    why: "ADR-0004 picked a Kafka-protocol log, but ADR-0007 found no managed Kafka on our host. Ingestion work (ADR-0016) starts next sprint and needs an answer.",
    tags: ["messaging", "kafka", "infrastructure"],
    components: ["Message broker / Kafka / Redpanda"],
    related: [
      { id: "0004", title: "Kafka-protocol event log", status: "proposed", rel: "may supersede" },
      { id: "0007", title: "Tech stack and infrastructure", status: "open", rel: "answers part of" },
      { id: "0016", title: "Message ingestion and storage", status: "open", rel: "blocks" },
      { id: "0019", title: "Hosting: Hamravesh, bare metal or hybrid", status: "open", rel: "depends on" },
    ],
    due: "Oct 11",
  },
  people: {
    abtinokhovat: { name: "Abtin Okhovat", role: "Tech lead · decider", color: "#1d5fbf", init: "AO" },
    "sara-dev": { name: "Sara Karimi", role: "Backend", color: "#1f7a3d", init: "SK" },
    "mehdi-ops": { name: "Mehdi Rahimi", role: "Ops / SRE", color: "#a8620a", init: "MR" },
    "lena-fe": { name: "Lena Moradi", role: "Frontend", color: "#b4307a", init: "LM" },
    "reza-data": { name: "Reza Ahmadi", role: "Data / CDP", color: "#00838f", init: "RA" },
    architect: { name: "architect", role: "Agent · drafts options from the codebase", agent: true, init: "AR" },
    advisor: { name: "advisor", role: "Agent · checks claims, merges, cleans up", agent: true, init: "AD" },
  },
  options: [
    { key: "A", name: "Redpanda (Kafka API)", by: "architect", sub: "Single binary, Kafka protocol, keeps ADR-0004 as is" },
    { key: "B", name: "NATS JetStream", by: "sara-dev", sub: "Light, listed on Darkube marketplace" },
    { key: "C", name: "PostgreSQL only", by: "architect", sub: "Raw table + job tables + outbox read in-process; Kafka later" },
  ],
  criteria: [
    { name: "Ops load for a small team", w: 3 },
    { name: "Order per conversation", w: 3 },
    { name: "Replay after a parser bug", w: 2 },
    { name: "Managed offer on our host", w: 2 },
    { name: "Path to scale (3k writes/s)", w: 1 },
  ],
  // scores[person][criterion][option] 1..5
  scores: {
    abtinokhovat: [[2, 3, 5], [5, 3, 4], [5, 4, 3], [1, 3, 5], [5, 4, 2]],
    "sara-dev": [[3, 4, 4], [5, 2, 4], [5, 4, 2], [1, 3, 5], [5, 3, 2]],
    "mehdi-ops": [[1, 3, 5], [5, 3, 4], [4, 4, 3], [1, 2, 5], [4, 4, 2]],
    "reza-data": [[2, 3, 4], [5, 3, 4], [5, 4, 2], [1, 3, 5], [5, 3, 2]],
  },
  args: [
    { id: 1, opt: "A", kind: "pro", by: "sara-dev", text: "Ordered partitions keyed by conversation_id", why: "Order per conversation is a hard requirement (ADR-0004 context).", plus: ["abtinokhovat", "reza-data"] },
    { id: 2, opt: "A", kind: "pro", by: "reza-data", text: "Replay for CDP backfills", why: "CDP will rebuild profiles from inbox.events.v1; 7-day retention covers a bad deploy.", plus: ["sara-dev"] },
    { id: 3, opt: "A", kind: "con", by: "mehdi-ops", text: "We would run 3 brokers ourselves", why: "No managed Kafka/Redpanda on Hamravesh or ArvanCloud (checked 2026-10-03).", plus: ["abtinokhovat", "sara-dev"], flag: { kind: "ok", text: "verified · ADR-0007" } },
    { id: 4, opt: "A", kind: "con", by: "lena-fe", text: "Another cluster to watch for lag and disk", why: "", plus: [], flag: { kind: "dup", text: "duplicate of #3" } },
    { id: 5, opt: "B", kind: "pro", by: "sara-dev", text: "One binary, small footprint", why: "Fits a two-VM setup in ADR-0019 option A.", plus: ["mehdi-ops"] },
    { id: 6, opt: "B", kind: "con", by: "architect", text: "Order per key across parallel consumers needs manual subject sharding", why: "We would hand-build partitioning that Kafka gives us.", plus: ["sara-dev", "abtinokhovat"] },
    { id: 7, opt: "B", kind: "pro", by: "mehdi-ops", text: "Listed on the Darkube marketplace", why: "Not managed: marketplace installs still run in our namespace.", plus: [], flag: { kind: "warn", text: "unverified: is it managed?" } },
    { id: 8, opt: "C", kind: "pro", by: "architect", text: "No new system to run, back up or upgrade", why: "500 msg/s fits one PostgreSQL primary with headroom.", plus: ["mehdi-ops", "abtinokhovat", "reza-data"] },
    { id: 9, opt: "C", kind: "pro", by: "mehdi-ops", text: "Managed PostgreSQL with PITR on Hamravesh", why: "Failover and backups are bought, not built.", plus: ["abtinokhovat"] },
    { id: 10, opt: "C", kind: "con", by: "reza-data", text: "Replay only as far back as we keep raw rows", why: "CDP backfills older than retention need a separate export.", plus: ["sara-dev"] },
    { id: 11, opt: "C", kind: "con", by: "sara-dev", text: "Ingest depends on DB uptime", why: "Mitigated by the relay spool from ADR-0019.", plus: [], flag: { kind: "agent", text: "mitigation linked · ADR-0019" } },
  ],
  asks: [
    { id: "q1", from: "abtinokhovat", to: "mehdi-ops", text: "Can ops run a 3-node Redpanda cluster in v1, including upgrades and lag alerts?", opt: "A", state: "answered", answer: "No", why: "Not with one person on call. A managed offer would change this." },
    { id: "q2", from: "advisor", to: "mehdi-ops", text: "Is NATS on the Darkube marketplace managed, or only installed into our namespace?", opt: "B", state: "open" },
    { id: "q3", from: "abtinokhovat", to: "reza-data", text: "How far back must CDP replay events?", opt: "C", state: "answered", answer: "14 days", why: "Profile rebuilds after a bad merge rule; older than that we re-import from source." },
  ],
  picks: {
    abtinokhovat: { opt: "C", conf: 0.7, why: "Smallest ops load now; ADR-0004 stays the scale path." },
    "sara-dev": { opt: "A", conf: 0.55, why: "We will need replay soon; I'd rather not migrate later." },
    "mehdi-ops": { opt: "C", conf: 0.9, why: "We cannot run brokers safely with current staffing." },
    "reza-data": { opt: "C", conf: 0.6, why: "OK if raw rows are kept 14 days." },
    "lena-fe": null,
  },
};

window.H = {
  esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]),
  av(handle, size = "") {
    const p = STORY.people[handle] ?? { init: "?", color: "#888" };
    return `<span class="av ${size ? `av--${size}` : ""} ${p.agent ? "av--agent" : ""}" style="background:${p.color ?? "#6b46c1"}" title="@${handle} · ${H.esc(p.role ?? "")}">${p.init}</span>`;
  },
  who(handle) {
    const p = STORY.people[handle];
    return `<span class="handle ${p?.agent ? "handle--agent" : ""}">@${handle}</span>${p?.agent ? `<span class="bot">AGENT</span>` : ""}`;
  },
  ref: (id) => `<span class="chip chip--ref">ADR-${id}</span>`,
  // ADR-#### mentions inside plain text → ref chips
  linkify: (s) => H.esc(s).replace(/ADR-(\d{4})/g, (m, id) => `<span class="chip chip--ref" style="padding:0 4px">ADR-${id}</span>`),
  toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) document.body.append((t = Object.assign(document.createElement("div"), { className: "toast" })));
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(H.toast.t);
    H.toast.t = setTimeout(() => t.classList.remove("on"), 2200);
  },
  // weighted score 0..100 per option from all scorers
  totals() {
    const C = STORY.criteria, W = C.reduce((s, c) => s + c.w, 0);
    const people = Object.values(STORY.scores);
    return STORY.options.map((_, j) => Math.round((people.reduce((s, m) => s + C.reduce((a, c, i) => a + c.w * m[i][j], 0) / (W * 5), 0) / people.length) * 100));
  },
  finalMd(choice = "C") {
    return `---
title: ADR-0020 — Message broker for v1
subtitle: v1 runs without a broker; PostgreSQL holds the raw buffer, jobs and outbox
status: Accepted
date: 2026-10-11
deciders: [abtinokhovat]
consulted: [sara-dev, mehdi-ops, reza-data]
tags: [messaging, kafka, infrastructure]
components: [kafka]
relates: [0004, 0016]
depends_on: [0019]
---

## Decision {span=3}
\`\`\`callout ok Decision
Run v1 without a broker (option ${choice}). PostgreSQL holds the raw update table, job tables and the outbox. Keep raw rows 14 days. ADR-0004 stays the scale path.
\`\`\`

## Options {span=3}
| Option | Pros | Cons | Verdict |
|---|---|---|---|
| A — Redpanda | Ordered partitions. Replay for CDP. | We run 3 brokers; no managed offer. | no |
| B — NATS JetStream | One binary. | Order per key needs manual sharding. | no |
| C — PostgreSQL only | No new system. Managed with PITR. | Replay limited to 14 days. | ok |

## Dissent {span=3}
- @sara-dev prefers A: replay will be needed soon. Trigger to revisit: any consumer needs replay > 14 days.

## Consequences {span=3}
- Positive: one stateful system to run in v1.
- Cost we accept: ingest depends on DB uptime; the relay spool (ADR-0019) covers outages.
- Follow-ups: raw table retention job; revisit at 3,000 writes/s.`;
  },
};
