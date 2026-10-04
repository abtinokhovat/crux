// Small, line-based edits to ADR markdown. Each edit touches only what it changes so the
// file stays readable in a diff and authors keep their formatting.
import { readFileSync, writeFileSync } from "node:fs";
import YAML from "yaml";

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function yamlValue(v) {
  if (Array.isArray(v)) return `[${v.map((x) => yamlScalar(String(x))).join(", ")}]`;
  if (v && typeof v === "object") return JSON.stringify(v);
  return yamlScalar(String(v));
}
function yamlScalar(s) {
  return /^[\w./@+-][\w ./@+()–—'-]*$/.test(s) && !/:\s|\s#|^(true|false|null|yes|no|\d+)$/i.test(s) ? s : JSON.stringify(s);
}

// patch: { key: value | null }. null removes the key. New keys go before the closing ---.
export function setFrontmatter(text, patch) {
  const m = text.match(FM);
  const lines = m ? m[1].split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(patch)) {
    const i = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
    // drop continuation lines of a block list under the key
    let j = i + 1;
    if (i >= 0) while (j < lines.length && /^\s+-\s/.test(lines[j])) j++;
    if (value == null) {
      if (i >= 0) lines.splice(i, j - i);
      continue;
    }
    const line = `${key}: ${yamlValue(value)}`;
    if (i >= 0) lines.splice(i, j - i, line);
    else lines.push(line);
  }
  const fm = `---\n${lines.join("\n")}\n---\n`;
  return m ? fm + text.slice(m[0].length) : fm + text;
}

export function getFrontmatter(text) {
  const m = text.match(FM);
  if (!m) return {};
  try {
    return YAML.parse(m[1]) ?? {};
  } catch {
    return {};
  }
}

// Panels = "## Title {attrs}" sections outside code fences.
export function panels(text) {
  const lines = text.split("\n");
  const out = [];
  let fence = null;
  lines.forEach((l, i) => {
    const f = l.match(/^(`{3,}|~{3,})/);
    if (f) fence = fence ? (l.startsWith(fence) ? null : fence) : f[1];
    if (fence && !f) return;
    const h = !fence && l.match(/^##\s+(.+?)\s*(\{[^{}]*\})?\s*$/);
    if (h) out.push({ title: h[1].trim(), attrs: h[2] ?? "", line: i });
  });
  out.forEach((p, k) => (p.end = k + 1 < out.length ? out[k + 1].line : lines.length));
  return out;
}

const norm = (s) => s.trim().toLowerCase();
const findPanel = (text, title) => panels(text).find((p) => norm(p.title) === norm(title));

export function panelBody(text, title) {
  const p = findPanel(text, title);
  if (!p) return null;
  return text.split("\n").slice(p.line + 1, p.end).join("\n").trim();
}

// Replace a panel's body, or insert the panel. where: { after: "Title" } | { before: "Title" } | end.
export function setPanel(text, title, body, { attrs = "{span=3}", after, before } = {}) {
  const lines = text.split("\n");
  const p = findPanel(text, title);
  const block = [`## ${title} ${attrs}`.trim(), body.trim(), ""];
  if (p) {
    lines.splice(p.line, p.end - p.line, `## ${p.title}${p.attrs ? ` ${p.attrs}` : ""}`, body.trim(), "");
    return lines.join("\n");
  }
  const anchor = after ? findPanel(text, after) : before ? findPanel(text, before) : null;
  const at = anchor ? (after ? anchor.end : anchor.line) : lines.length;
  if (!anchor && lines[lines.length - 1] !== "") block.unshift("");
  lines.splice(at, 0, ...block);
  return lines.join("\n");
}

export function appendToPanel(text, title, addLines, opts) {
  const body = panelBody(text, title);
  return setPanel(text, title, [body, ...addLines].filter((x) => x != null && x !== "").join("\n"), opts);
}

export function removePanel(text, title) {
  const p = findPanel(text, title);
  if (!p) return text;
  const lines = text.split("\n");
  lines.splice(p.line, p.end - p.line);
  return lines.join("\n");
}

// Keep a block your Claude wrote: drop the {from=claude} marker from its heading.
export function keepPanel(text, title) {
  const p = findPanel(text, title);
  if (!p) return text;
  const lines = text.split("\n");
  const attrs = p.attrs.replace(/\s*from=claude\s*/, " ").replace(/\{\s*\}/, "").replace(/\{\s+/, "{").replace(/\s+\}/, "}").trim();
  lines[p.line] = `## ${p.title}${attrs ? ` ${attrs}` : ""}`;
  return lines.join("\n");
}

// Set the verdict column of an Options table: chosen → ok, the rest → no (warn rows stay warn
// only when keepPossible is true).
export function setVerdicts(text, chosenKey) {
  const lines = text.split("\n");
  let inOptions = false;
  return lines
    .map((l) => {
      const h = l.match(/^##\s+(.+)/);
      if (h) inOptions = /^options?\b/i.test(h[1].trim());
      if (!inOptions || !/^\|/.test(l) || /^\|\s*:?-{2,}/.test(l)) return l;
      const cells = l.replace(/^\||\|$/g, "").split("|");
      const last = cells[cells.length - 1].trim();
      if (!/^(ok|no|warn)\b/i.test(last)) return l;
      const key = cells[0].trim().match(/^([A-Z])\s*[—–-]/)?.[1] ?? cells[0].trim();
      const chosen = key === chosenKey || cells[0].trim().toLowerCase().startsWith(String(chosenKey).toLowerCase());
      cells[cells.length - 1] = ` ${chosen ? "ok" : "no"} `;
      return `|${cells.join("|")}|`;
    })
    .join("\n");
}

export function readText(file) {
  return readFileSync(file, "utf8");
}
export function writeText(file, text) {
  writeFileSync(file, text.replace(/\n{3,}/g, "\n\n"));
}
