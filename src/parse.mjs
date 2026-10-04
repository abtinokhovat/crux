// Parses one ADR markdown file into metadata + panels + extracted facts
// (decision, options, questions, consequences) used by the index and the UI.
import YAML from "yaml";
import { parseDoc } from "./am.mjs";

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(source) {
  const m = String(source).match(FM);
  if (!m) return { meta: {}, body: String(source), bodyLine: 0 };
  let meta;
  try {
    meta = YAML.parse(m[1]) ?? {};
    if (typeof meta !== "object" || Array.isArray(meta)) throw new Error("not a map");
  } catch {
    meta = looseFrontmatter(m[1]);
  }
  return { meta, body: source.slice(m[0].length), bodyLine: m[0].split("\n").length - 1 };
}

// key: value per line; tolerant of unquoted colons that strict YAML rejects.
function looseFrontmatter(text) {
  const meta = {};
  let listKey = null;
  for (const line of text.split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) { meta[listKey].push(item[1].trim()); continue; }
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === "") { meta[key] = []; listKey = key; continue; }
    listKey = null;
    const list = value.match(/^\[(.*)\]$/);
    meta[key] = list ? list[1].split(",").map((s) => s.trim()).filter(Boolean) : value.replace(/^(["'])(.*)\1$/, "$2");
  }
  return meta;
}

export const asList = (v) =>
  v == null || v === "" ? [] : Array.isArray(v) ? v.map(String) : String(v).split(",").map((s) => s.trim()).filter(Boolean);

export function refId(value, digits = 4) {
  const m = String(value).match(/(\d+)/);
  return m ? m[1].padStart(digits, "0").slice(-Math.max(digits, m[1].length)) : null;
}

export function statusKey(status = "") {
  const s = String(status).trim().toLowerCase();
  if (!s) return "proposed";
  if (s.startsWith("superseded")) return "superseded";
  if (s.startsWith("in review") || s === "review") return "review";
  return s.split(/\s+/)[0];
}

const plain = (s) =>
  String(s ?? "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*?([^*]+)\*\*?/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();

// Markdown table → { head: [...], rows: [[...]] }. Returns the first table in text.
export function parseTable(text) {
  const lines = String(text).split("\n").map((l) => l.trim());
  const start = lines.findIndex((l, i) => l.startsWith("|") && /^\|?\s*:?-{2,}/.test(lines[i + 1] ?? ""));
  if (start === -1) return null;
  const cells = (l) => l.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
  const head = cells(lines[start]);
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith("|"); i++) rows.push(cells(lines[i]));
  return { head, rows };
}

const VERDICT = /^(ok|no|warn|✓|✔|✗|✘|⚠)\b\s*(.*)$/i;
const VERDICT_ALIAS = { "✓": "ok", "✔": "ok", "✗": "no", "✘": "no", "⚠": "warn" };

export function verdictOf(cell) {
  const m = String(cell ?? "").trim().match(VERDICT);
  if (!m) return null;
  const word = m[1].toLowerCase();
  return { kind: VERDICT_ALIAS[word] ?? word, label: m[2].trim() };
}

// Options table → structured options. The verdict column is the last column
// whose cells are mostly ok/no/warn words.
export function optionsFromTable(table) {
  if (!table || !table.rows.length) return null;
  const { head, rows } = table;
  let vcol = -1;
  for (let c = head.length - 1; c >= 0; c--) {
    const hits = rows.filter((r) => verdictOf(r[c])).length;
    if (hits >= Math.ceil(rows.length / 2)) { vcol = c; break; }
  }
  if (vcol === -1) return null;
  const lower = head.map((h) => h.toLowerCase());
  const topicCol = lower.findIndex((h) => /^(topic|area|question|aspect)$/.test(h));
  let nameCol = lower.findIndex((h) => /^(option|choice|alternative|approach|candidate)s?$/.test(h));
  if (nameCol === -1) nameCol = head.findIndex((_, i) => i !== topicCol && i !== vcol);
  const fields = head
    .map((h, i) => ({ h, i }))
    .filter(({ i }) => i !== vcol && i !== nameCol && i !== topicCol)
    .map(({ h, i }) => ({ label: h, col: i, role: /^pros?$|advantage|benefit|strength/i.test(h) ? "pro" : /^cons?$|disadvantage|drawback|weakness|risk/i.test(h) ? "con" : "info" }));
  return rows.map((r) => {
    const name = r[nameCol] ?? "";
    const letter = name.match(/^([A-Z])\s*[—–-]\s*(.+)$/);
    return {
      key: letter ? letter[1] : null,
      name: letter ? letter[2] : name,
      topic: topicCol >= 0 ? r[topicCol] : null,
      verdict: verdictOf(r[vcol]) ?? { kind: "info", label: r[vcol] ?? "" },
      verdictHead: head[vcol],
      fields: fields.map((f) => ({ label: f.label, role: f.role, text: r[f.col] ?? "" })).filter((f) => f.text),
    };
  });
}

function listItems(text) {
  return String(text)
    .split("\n")
    .map((l) => l.match(/^\s{0,3}(?:[-*+]|\d+[.)])\s+(.*)$/)?.[1])
    .filter(Boolean);
}

const fenceText = (blocks, lang) => blocks.find((b) => b.type === "fence" && (!lang || b.lang === lang));
const mdText = (blocks) => blocks.filter((b) => b.type === "md").map((b) => b.text).join("\n");

// Pulls the decision-shaped facts out of the panels.
export function extractFacts(panels) {
  const facts = { decision: null, question: null, recommendation: null, options: [], questions: [], consequences: [], criteria: [] };
  for (const p of panels) {
    const t = p.title.toLowerCase();
    const callout = fenceText(p.blocks, "callout") ?? fenceText(p.blocks, "decision");
    const firstText = callout ? callout.text : mdText(p.blocks).split(/\n\s*\n/)[0];
    if (/^decision\b/.test(t) && !facts.decision) facts.decision = plain(firstText);
    else if (/^question\b/.test(t) && !facts.question) facts.question = plain(firstText);
    else if (/^recommend/.test(t) && !facts.recommendation) facts.recommendation = plain(firstText);
    else if (/^options?\b/.test(t)) {
      const opts = optionsFromTable(parseTable(mdText(p.blocks)));
      if (opts) facts.options.push({ panel: p.id, title: p.title.replace(/^options?\s*:?\s*/i, "") || null, items: opts });
    } else if (/questions?\b.*(user|you|open)|^open questions/.test(t)) facts.questions = listItems(mdText(p.blocks)).map(plain);
    else if (/^consequences?/.test(t)) facts.consequences = listItems(mdText(p.blocks)).map(plain);
    else if (/criteria/.test(t)) facts.criteria = listItems(mdText(p.blocks)).map(plain);
  }
  return facts;
}

export function parseAdr(source) {
  const { meta, body, bodyLine } = splitFrontmatter(source);
  const doc = parseDoc(body, { defaults: { template: "doc", title: "" } });
  return { meta, body, bodyLine, intro: doc.intro, panels: doc.panels, facts: extractFacts(doc.panels) };
}

export function plainText(body) {
  return String(body)
    .replace(/^```.*$/gm, " ")
    .replace(/[#>*_`|{}[\]]/g, " ")
    .replace(/\(([^)]*\.(?:md|html))\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
