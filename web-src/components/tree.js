// Tree: replaces the answer-me-with-html tree with
//  - node tones (+ ok, ! warn, - err, * highlight),
//  - a left-to-right layout (lr),
//  - cases: "? Case name => Node > Child" lines add buttons that walk a case to its outcome.
// Without "lr" it renders the same org chart / indented list as before.

const MARKS = { "*": "hi", "+": "ok", "!": "warn", "-": "err" };

function parseNode(t) {
  const m = MARKS[t[0]] && t.length > 1 ? t[0] : "";
  const body = m ? t.slice(1).trim() : t;
  const [label, ...rest] = body.split("|").map((s) => s.trim());
  return { label, sub: rest.join(" | "), tone: MARKS[m] ?? "" };
}

function buildTree(text) {
  const roots = [];
  const stack = [];
  const cases = [];
  let id = 0;
  String(text).split("\n").forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith("//")) return;
    if (t.startsWith("? ")) {
      const [name, path = ""] = t.slice(2).split(/\s*=>\s*/);
      cases.push({ name: name.trim(), path: path.split(/\s*>\s*/).filter(Boolean), line: i + 1 });
      return;
    }
    const indent = raw.replace(/\t/g, "  ").match(/^ */)[0].length;
    const node = { ...parseNode(t), indent, children: [], id: id++ };
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    node.parent = stack.at(-1) ?? null;
    (stack.length ? stack.at(-1).children : roots).push(node);
    stack.push(node);
  });
  return { roots, cases };
}

// Resolve "A > B > C" to node ids: each part matches the start of a label (case-insensitive),
// searching from the roots, or from the root's children when the path skips the root.
function resolvePath(roots, path) {
  const key = (s) => String(s).toLowerCase().replace(/[`*_]/g, "").trim();
  const find = (nodes, part) => nodes.find((n) => key(n.label).startsWith(key(part)));
  let level = roots;
  const out = [];
  for (const [i, part] of path.entries()) {
    let n = find(level, part);
    if (!n && i === 0 && roots.length === 1) {
      out.push(roots[0].id);
      n = find(roots[0].children, part);
    }
    if (!n) return null;
    out.push(n.id);
    level = n.children;
  }
  if (out.length && roots.length === 1 && out[0] !== roots[0].id && roots[0].children.some((c) => c.id === out[0])) out.unshift(roots[0].id);
  return out;
}

const depth = (n) => 1 + Math.max(0, ...n.children.map(depth));
const tone = (n) => (n.tone ? ` ak-tone-${n.tone}` : "");

export const tree = {
  name: "tree",
  summary: "Hierarchy: org chart, indented list, or left-to-right tree; colored nodes; walk cases",
  syntax: `\`\`\`tree [lr|list|td]
Root | subtitle
  Child | gray note
    Leaf
  *Highlighted   +Good (green)   !Risky (amber)   -Bad (red)
? Case name => Child > Leaf      ← button that walks this case to its outcome
\`\`\`
- Indent sets the level. "label | note" adds a gray note.
- Default: 1 root with 2–4 children → org chart; more children → list; 2–4 roots → columns.
- lr: left-to-right tree. Chosen automatically when the tree is 4+ levels deep (td forces the default).
- Case paths match the start of node labels; the root may be skipped.`,
  example: "```tree\nSend result\n  +Sent | message ID\n  !Unknown | duplicate possible\n    Echo in 30 s → sent\n  -Failed | permanent error\n? Timeout, echo arrives => Unknown > Echo\n```",
  render(text, { args, mdInline, esc, ComponentError }) {
    const { roots, cases } = buildTree(text);
    if (!roots.length) throw new ComponentError("tree needs at least one node", 1);
    const a = ` ${args} `;
    const list = /\slist\s/.test(a);
    const lr = /\slr\s/.test(a) || (!list && !/\std\s/.test(a) && Math.max(...roots.map(depth)) >= 4);

    const walks = cases.map((c) => {
      const ids = resolvePath(roots, c.path);
      if (!ids) throw new ComponentError(`tree case "${c.name}": no node path matches "${c.path.join(" > ")}"`, c.line);
      return { ...c, ids };
    });
    const tn = (n) => ` data-tn="${n.id}"`;
    const labelHtml = (label) => mdInline(label).replace(/^<code>([^<]*)<\/code>(?=\s*\S)/, '<span class="am-tree-tag">$1</span>');
    const boxInner = (n) => `${labelHtml(n.label)}${n.sub ? `<small>${mdInline(n.sub)}</small>` : ""}`;

    let body;
    if (lr) {
      const nodeHtml = (n, level) => {
        const kids = n.children.length ? `<div class="ak-lt-kids">${n.children.map((c) => nodeHtml(c, level + 1)).join("")}</div>` : "";
        const kind = level === 0 ? " ak-lt-box--root" : n.children.length ? "" : " ak-lt-box--leaf";
        return `<div class="ak-lt-node"><div class="ak-lt-box${kind}${tone(n)}"${tn(n)}>${boxInner(n)}</div>${kids}</div>`;
      };
      body = `<div class="ak-ltree">${roots.map((r) => nodeHtml(r, 0)).join("")}</div>`;
    } else {
      const liHtml = (n) => {
        const sub = n.sub ? `<span class="am-tree-sub">${mdInline(n.sub)}</span>` : "";
        const kids = n.children.length ? `<ul>${n.children.map(liHtml).join("")}</ul>` : "";
        const cls = [n.tone === "hi" ? "am-tree-hi" : "", n.tone ? `ak-tone-${n.tone}` : ""].filter(Boolean).join(" ");
        return `<li${cls ? ` class="${cls}"` : ""}><span class="am-tree-label"${tn(n)}>${labelHtml(n.label)}</span>${sub}${kids}</li>`;
      };
      const listHtml = (nodes) => `<ul class="am-tree-list">${nodes.map(liHtml).join("")}</ul>`;
      const rootBox = (r, solo = false) =>
        `<div class="am-tree-root${solo ? " am-tree-root--solo" : ""}"><div class="am-tree-box am-tree-box--root${tone(r)}"${tn(r)}>${boxInner(r)}</div></div>`;
      const colHtml = (n) =>
        `<div class="am-tree-col"><div class="am-tree-box${n.tone === "hi" ? " am-tree-box--hi" : ""}${tone(n)}"${tn(n)}>${boxInner(n)}</div>${n.children.length ? listHtml(n.children) : ""}</div>`;
      if (roots.length === 1) {
        const [root] = roots;
        const n = root.children.length;
        body = !list && n >= 2 && n <= 4
          ? `<div class="am-tree">${rootBox(root)}<div class="am-tree-cols" style="--n: ${n}">${root.children.map(colHtml).join("")}</div></div>`
          : `<div class="am-tree">${rootBox(root, true)}${listHtml(root.children)}</div>`;
      } else if (!list && roots.length <= 4) {
        body = `<div class="am-tree"><div class="am-tree-cols am-tree-cols--free" style="--n: ${roots.length}">${roots.map(colHtml).join("")}</div></div>`;
      } else body = `<div class="am-tree">${listHtml(roots)}</div>`;
    }
    if (!walks.length) return body;
    const buttons = walks.map((w, i) => `<button type="button" class="ak-tw-case" data-tw="${i}" data-tw-path="${w.ids.join(",")}">${esc(w.name)}</button>`).join("");
    return `<div class="ak-tw" data-tree-walk><div class="ak-tw-cases"><span class="ak-tw-label">Walk a case</span>${buttons}</div>${body}</div>`;
  },
};
