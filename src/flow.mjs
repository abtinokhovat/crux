// The decision flow on disk: capture a draft, keep links both ways, bring team notes in,
// finalize, and answer "which decisions apply here?" for agents.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { appendToPanel, getFrontmatter, panelBody, setFrontmatter, setPanel, setVerdicts, readText, writeText } from "./edit.mjs";
import { nextNumber } from "./store.mjs";
import { asList, refId } from "./parse.mjs";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const today = () => new Date().toISOString().slice(0, 10);
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "question";

export function titleFromQuestion(q) {
  let t = String(q).trim().replace(/\?+\s*$/, "");
  // "Which broker do we use for v1" → "Broker for v1"; "Should we cache X" → "Cache X"
  const m = t.match(/^(?:which|what)\s+(.+?)\s+(?:do|does|should|will|can|to)\s+(?:we|i|you|they)?\s*(?:use|pick|choose|run|adopt|need|want)?\s*(.*)$/i);
  if (m) t = `${m[1]} ${m[2]}`;
  else t = t.replace(/^(?:should|do|does|can|how do|how should)\s+(?:we|i|you)\s+/i, "");
  return t.replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 70);
}

// Capture: a private draft with the question and rough notes.
export function createDraft(cfg, store, { question, notes = "", title, due = "", owner }) {
  if (!question?.trim()) throw new Error("A question is required");
  const id = String(nextNumber(store)).padStart(cfg.digits, "0");
  const t = (title || titleFromQuestion(question)).trim();
  const file = join(cfg.abs(cfg.dir), `${id}-${slugify(t)}.md`);
  const tpl = readFileSync(join(PKG, "templates/adr-draft.md"), "utf8");
  const vars = {
    prefix: cfg.prefix, id, title: t, question: question.trim(), date: today(), due, owner: owner || cfg.me || "",
    notes: String(notes).trim() ? String(notes).trim().split(/\r?\n/).map((l) => (/^\s*[-*]/.test(l) ? l : `- ${l}`)).join("\n") : "- (none yet)",
  };
  const body = tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
  mkdirSync(dirname(file), { recursive: true });
  writeText(file, setFrontmatter(body, { due: due || null }));
  return { id, file: relative(cfg.root, file) };
}

const INVERSE = { relates: "relates", supersedes: "superseded_by", superseded_by: "supersedes", amends: null, depends_on: null };
export const LINK_TYPES = Object.keys(INVERSE);

// Link a → b, and write the other side where the relation has one.
export function link(cfg, store, a, rel, b) {
  rel = rel.replace(/-/g, "_");
  if (!LINK_TYPES.includes(rel)) throw new Error(`relation must be one of: ${LINK_TYPES.join(", ")}`);
  const A = store.byId.get(refId(a, cfg.digits)), B = store.byId.get(refId(b, cfg.digits));
  if (!A || !B) throw new Error(`unknown ADR: ${!A ? a : b}`);
  const changed = [];
  const add = (doc, key, id) => {
    const file = cfg.abs(doc.file);
    const text = readText(file);
    const cur = asList(getFrontmatter(text)[key]).map((x) => refId(x, cfg.digits));
    if (cur.includes(id)) return;
    let next = setFrontmatter(text, { [key]: [...cur, id] });
    if (key === "superseded_by") next = setFrontmatter(next, { status: `Superseded by ${id}` });
    writeText(file, next);
    changed.push(doc.file);
  };
  add(A, rel, B.id);
  if (INVERSE[rel]) add(B, INVERSE[rel], A.id);
  return changed;
}

// Notes from the share server → "## Notes" in the draft, tagged, without duplicates.
export function importNotes(cfg, adr, entries) {
  const file = cfg.abs(adr.file);
  let text = readText(file);
  const existing = panelBody(text, "Notes") ?? "";
  const lines = entries
    .map((e) => `- ${e.tag ? `**${e.tag}** · ` : ""}${e.text.replace(/\s+/g, " ").trim()} — @${e.by}${e.at ? ` (${e.at.slice(0, 16).replace("T", " ")})` : ""}`)
    .filter((l) => !existing.includes(l.split(" — @")[0].slice(2)));
  if (!lines.length) return 0;
  if (/^- \(none yet\)$/m.test(existing)) text = setPanel(text, "Notes", "");
  writeText(file, appendToPanel(text, "Notes", lines, { after: "Question" }));
  return lines.length;
}

// Finalize: decision callout on top, verdicts, dissent, status Accepted.
export function finalize(cfg, adr, { option, decision, dissent = [], reopen = [], deciders }) {
  const file = cfg.abs(adr.file);
  let text = readText(file);
  if (option) text = setVerdicts(text, option);
  const body = `\`\`\`callout ok Decision\n${String(decision || `Chose option ${option}.`).trim()}\n\`\`\``;
  const firstPanel = text.match(/^##\s+(.+?)\s*(\{[^{}]*\})?\s*$/m)?.[1];
  text = setPanel(text, "Decision", body, firstPanel && firstPanel.toLowerCase() !== "decision" ? { before: firstPanel } : {});
  if (dissent.length) text = setPanel(text, "Dissent", dissent.map((d) => `- @${d.by} prefers ${d.opt}${d.why ? `: ${d.why}` : ""}`).join("\n"), { after: "Decision" });
  const fm = getFrontmatter(text);
  text = setFrontmatter(text, {
    status: "Accepted",
    decided: today(),
    deciders: deciders ?? (fm.owner ? [fm.owner] : null),
    reopen_when: reopen.length ? reopen : fm.reopen_when ?? null,
  });
  writeText(file, text);
  return adr.file;
}

export function setStatus(cfg, adr, status) {
  const file = cfg.abs(adr.file);
  writeText(file, setFrontmatter(readText(file), { status }));
}

// ── context for agents ──────────────────────────────────────────────
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}`);

export function context(cfg, store, inputs = []) {
  const paths = inputs.filter((x) => x.includes("/") || x.includes("."));
  const terms = inputs.filter((x) => !paths.includes(x)).map((t) => t.toLowerCase());
  const arch = store.architecture?.nodes ?? {};
  const scored = [];
  for (const a of store.adrs) {
    const fm = getFrontmatter(a.source);
    const applies = asList(fm.applies_to);
    const nodePaths = a.components.flatMap((c) => asList(arch[c]?.paths));
    const why = [];
    for (const p of paths) {
      const rp = p.replace(/^\.\//, "");
      const hit = [...applies, ...nodePaths].find((g) => globRe(g).test(rp) || rp.startsWith(g.replace(/\*.*$/, "")) || g.replace(/\*.*$/, "").startsWith(rp));
      if (hit) why.push(`path ${rp} ~ ${hit}`);
    }
    for (const t of terms) {
      if (a.tags.includes(t)) why.push(`tag ${t}`);
      else if (a.components.some((c) => c.toLowerCase().includes(t) || arch[c]?.label?.toLowerCase().includes(t))) why.push(`component ${t}`);
      else if (a.title.toLowerCase().includes(t)) why.push(`title ${t}`);
    }
    if (!inputs.length || why.length) scored.push({ a, fm, applies, why });
  }
  const order = { accepted: 0, review: 1, proposed: 2, open: 3, draft: 4 };
  scored.sort((x, y) => (order[x.a.statusKey] ?? 5) - (order[y.a.statusKey] ?? 5) || y.why.length - x.why.length);
  return scored.map(({ a, fm, applies, why }) => {
    const opts = a.facts.options.flatMap((o) => o.items);
    return {
      id: a.id,
      title: a.title,
      status: a.status,
      binding: a.statusKey === "accepted",
      decision: a.facts.decision ?? null,
      question: a.facts.decision ? null : a.facts.question,
      leaning: a.facts.decision ? null : a.facts.recommendation,
      chosen: opts.filter((o) => o.verdict.kind === "ok").map((o) => o.name),
      rejected: opts.filter((o) => o.verdict.kind === "no").map((o) => ({ name: o.name, why: o.fields.find((f) => f.role === "con")?.text ?? "" })),
      reopen_when: asList(fm.reopen_when),
      applies_to: applies,
      components: a.components,
      links: store.edges.filter((e) => e.type !== "mentions" && (e.from === a.id || e.to === a.id)).map((e) => (e.from === a.id ? `${e.type} ${e.to}` : `${e.type}← ${e.from}`)),
      file: a.file,
      matched: why,
    };
  });
}
