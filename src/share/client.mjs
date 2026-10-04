// Talks to the share server for one project: publish notes or a review snapshot, read team
// input, reply, close. Which ADR is shared where lives in .adr/share.json (local state).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { renderAdr } from "../render.mjs";
import { getFrontmatter, panelBody } from "../edit.mjs";

export class ShareError extends Error {}

const stateFile = (cfg) => join(cfg.root, ".adr", "share.json");
export function shareState(cfg) {
  try {
    return JSON.parse(readFileSync(stateFile(cfg), "utf8"));
  } catch {
    return {};
  }
}
function saveState(cfg, st) {
  mkdirSync(dirname(stateFile(cfg)), { recursive: true });
  // Share links and pulled reviews are personal working state, not project history.
  const gi = join(cfg.root, ".adr", ".gitignore");
  if (!existsSync(gi)) writeFileSync(gi, "share.json\nreviews/\n");
  writeFileSync(stateFile(cfg), JSON.stringify(st, null, 2));
}

function repoName(cfg) {
  try {
    const url = execFileSync("git", ["-C", cfg.root, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return url.replace(/\.git$/, "").replace(/^.*[:/]([^/:]+\/[^/]+)$/, "$1");
  } catch {
    return cfg.root.split(/[\\/]/).pop();
  }
}

async function call(cfg, method, path, body) {
  if (!cfg.share) throw new ShareError('No share server. Add `share: https://adr.example.com` to adr.config.yaml, then run `adr login`.');
  if (!cfg.shareToken && method !== "GET") throw new ShareError(`Not logged in to ${cfg.share}. Run: adr login ${cfg.share} --token <token>`);
  let res;
  try {
    res = await fetch(cfg.share.replace(/\/$/, "") + path, {
      method,
      headers: { "content-type": "application/json", ...(cfg.shareToken ? { authorization: `Bearer ${cfg.shareToken}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ShareError(`Cannot reach ${cfg.share}: ${err.cause?.code ?? err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ShareError(`${res.status} ${data.error ?? res.statusText}`);
  return data;
}

export async function whoami(server, token) {
  const res = await fetch(server.replace(/\/$/, "") + "/api/me", { headers: { authorization: `Bearer ${token}` } }).catch((e) => {
    throw new ShareError(`Cannot reach ${server}: ${e.cause?.code ?? e.message}`);
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ShareError(data.error ?? `HTTP ${res.status}`);
  return data.handle;
}

// "## Questions for the team" → [{ to, text }]. Lines like "- @sara-dev: …" or "1. … (@sara-dev)".
export function teamQuestions(source) {
  const body = panelBody(source, "Questions for the team") ?? panelBody(source, "Questions for the user") ?? "";
  return body
    .split("\n")
    .map((l) => l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)?.[1])
    .filter(Boolean)
    .map((t) => {
      const lead = t.match(/^@([\w.-]+)\s*[:—-]\s*(.*)$/);
      if (lead) return { to: lead[1], text: lead[2] };
      const tail = t.match(/^(.*?)\s*\(@([\w.-]+)\)\s*$/);
      return tail ? { to: tail[2], text: tail[1] } : { to: "", text: t };
    });
}

function snapshot(cfg, store, adr) {
  const { html } = renderAdr(adr, store, cfg, { forShare: true });
  const fm = getFrontmatter(adr.source);
  const opts = adr.facts.options.flatMap((o) => o.items).filter((o) => o.key || o.name);
  const options = opts.map((o, i) => ({ key: o.key ?? String.fromCharCode(65 + i), name: o.name }));
  const leanOpt = fm.leaning ?? opts.find((o) => o.verdict.kind === "ok")?.key ?? null;
  return {
    // links to other local ADRs don't resolve on the server; keep the text, drop the href
    html: html.replace(/<a ([^>]*?)href="#\/[^"]*"/g, '<a $1href="#"'),
    options,
    questions: teamQuestions(adr.source),
    leaning: leanOpt ? { opt: String(leanOpt), why: adr.facts.recommendation ?? "" } : null,
  };
}

async function publish(cfg, adr, fields) {
  const item = await call(cfg, "POST", "/api/items", { repo: repoName(cfg), adr: { id: adr.id, title: adr.title, status: adr.status }, ...fields });
  const st = shareState(cfg);
  st[adr.id] = { slug: item.slug, url: item.url, mode: item.mode, at: new Date().toISOString() };
  saveState(cfg, st);
  return item;
}

export function openNotes(cfg, adr) {
  return publish(cfg, adr, { mode: "notes", question: adr.facts.question ?? adr.subtitle ?? adr.title, context: panelBody(adr.source, "Notes") ?? "" });
}

export function shareReview(cfg, store, adr) {
  return publish(cfg, adr, { mode: "review", question: adr.facts.question ?? adr.title, snapshot: snapshot(cfg, store, adr) });
}

// After finalize: reviewers see the accepted ADR and the decision banner.
export function publishFinal(cfg, store, adr, final) {
  return publish(cfg, adr, { mode: "final", question: adr.facts.question ?? adr.title, snapshot: snapshot(cfg, store, adr), final });
}

export async function setMode(cfg, adr, mode, extra = {}) {
  const s = shareState(cfg)[adr.id];
  if (!s) throw new ShareError(`ADR-${adr.id} is not shared`);
  const item = await call(cfg, "PATCH", `/api/items/${s.slug}`, { mode, ...extra });
  const st = shareState(cfg);
  st[adr.id] = { ...s, mode: item.mode };
  saveState(cfg, st);
  return item;
}

export async function fetchItem(cfg, adr) {
  const s = shareState(cfg)[adr.id];
  if (!s) return null;
  return call(cfg, "GET", `/api/items/${s.slug}`);
}

export function reply(cfg, adr, entryId, kind, text = "") {
  const s = shareState(cfg)[adr.id];
  return call(cfg, "POST", `/api/items/${s.slug}/entries/${entryId}/reply`, { kind, text });
}

// Team input as markdown for your Claude: .adr/reviews/NNNN.md
export function digestMarkdown(adr, item) {
  const opts = Object.fromEntries((item.snapshot?.options ?? []).map((o) => [o.key, o.name]));
  const by = (k) => item.entries.filter((e) => e.kind === k);
  const line = (e) => `- @${e.by}${e.opt ? ` [${e.opt}]` : ""}${e.target ? ` (on: ${e.target})` : ""}: ${e.text}${e.why ? ` — because: ${e.why}` : ""}${e.reply ? `\n  - owner ${e.reply.kind}${e.reply.text ? `: ${e.reply.text}` : ""}` : ""}`;
  const picks = by("pick");
  return [
    `# Team input for ADR-${adr.id} — ${adr.title}`,
    `Mode: ${item.mode} · ${item.entries.length} entries · pulled ${new Date().toISOString().slice(0, 16)}`,
    "",
    "## Picks",
    ...(picks.length ? picks.map((p) => `- @${p.by}: ${p.opt} (${opts[p.opt] ?? ""}) · ${p.conf}%${p.text ? ` — ${p.text}` : ""}`) : ["- none"]),
    "",
    "## Pros", ...(by("pro").map(line).concat(by("pro").length ? [] : ["- none"])),
    "", "## Cons", ...(by("con").map(line).concat(by("con").length ? [] : ["- none"])),
    "", "## Answers", ...(by("answer").map(line).concat(by("answer").length ? [] : ["- none"])),
    "", "## Comments", ...(by("comment").map(line).concat(by("comment").length ? [] : ["- none"])),
    "", "## Meeting notes", ...(by("note").map(line).concat(by("note").length ? [] : ["- none"])),
    "",
    `Unanswered: ${item.entries.filter((e) => ["pro", "con", "comment", "answer"].includes(e.kind) && !e.reply).length}`,
  ].join("\n");
}

export function writeDigest(cfg, adr, item) {
  const file = join(cfg.root, ".adr", "reviews", `${adr.id}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, digestMarkdown(adr, item) + "\n");
  return file;
}

export const isShared = (cfg, id) => !!shareState(cfg)[id];
