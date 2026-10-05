// Tree: replaces the answer-me-with-html tree with two additions —
// node tones (+ ok, ! warn, - err, * highlight) and a left-to-right layout (lr).
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
  for (const raw of String(text).split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("//")) continue;
    const indent = raw.replace(/\t/g, "  ").match(/^ */)[0].length;
    const node = { ...parseNode(raw.trim()), indent, children: [] };
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    (stack.length ? stack.at(-1).children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

const depth = (n) => 1 + Math.max(0, ...n.children.map(depth));
const tone = (n) => (n.tone ? ` ak-tone-${n.tone}` : "");

export const tree = {
  name: "tree",
  summary: "Hierarchy: org chart, indented list, or left-to-right tree; colored nodes",
  syntax: `\`\`\`tree [lr|list|td]
Root | subtitle
  Child | gray note
    Leaf
  *Highlighted   +Good (green)   !Risky (amber)   -Bad (red)
\`\`\`
- Indent sets the level. "label | note" adds a gray note.
- Default: 1 root with 2–4 children → org chart; more children → list; 2–4 roots → columns.
- lr: left-to-right tree. Chosen automatically when the tree is 4+ levels deep (td forces the default).`,
  example: "```tree lr\nSend result\n  +Sent | message ID\n  !Unknown | duplicate possible\n    Echo in 30 s → sent\n    No echo → send again\n  -Failed | permanent error\n```",
  render(text, { args, mdInline, ComponentError }) {
    const roots = buildTree(text);
    if (!roots.length) throw new ComponentError("tree needs at least one node", 1);
    const a = ` ${args} `;
    const list = /\slist\s/.test(a);
    const lr = /\slr\s/.test(a) || (!list && !/\std\s/.test(a) && Math.max(...roots.map(depth)) >= 4);

    const labelHtml = (label) => mdInline(label).replace(/^<code>([^<]*)<\/code>(?=\s*\S)/, '<span class="am-tree-tag">$1</span>');
    const boxInner = (n) => `${labelHtml(n.label)}${n.sub ? `<small>${mdInline(n.sub)}</small>` : ""}`;

    if (lr) {
      const nodeHtml = (n, level) => {
        const kids = n.children.length ? `<div class="ak-lt-kids">${n.children.map((c) => nodeHtml(c, level + 1)).join("")}</div>` : "";
        const kind = level === 0 ? " ak-lt-box--root" : n.children.length ? "" : " ak-lt-box--leaf";
        return `<div class="ak-lt-node"><div class="ak-lt-box${kind}${tone(n)}">${boxInner(n)}</div>${kids}</div>`;
      };
      return `<div class="ak-ltree">${roots.map((r) => nodeHtml(r, 0)).join("")}</div>`;
    }

    const liHtml = (n) => {
      const sub = n.sub ? `<span class="am-tree-sub">${mdInline(n.sub)}</span>` : "";
      const kids = n.children.length ? `<ul>${n.children.map(liHtml).join("")}</ul>` : "";
      const cls = [n.tone === "hi" ? "am-tree-hi" : "", n.tone ? `ak-tone-${n.tone}` : ""].filter(Boolean).join(" ");
      return `<li${cls ? ` class="${cls}"` : ""}><span class="am-tree-label">${labelHtml(n.label)}</span>${sub}${kids}</li>`;
    };
    const listHtml = (nodes) => `<ul class="am-tree-list">${nodes.map(liHtml).join("")}</ul>`;
    const rootBox = (r, solo = false) =>
      `<div class="am-tree-root${solo ? " am-tree-root--solo" : ""}"><div class="am-tree-box am-tree-box--root${tone(r)}">${boxInner(r)}</div></div>`;
    const colHtml = (n) =>
      `<div class="am-tree-col"><div class="am-tree-box${n.tone === "hi" ? " am-tree-box--hi" : ""}${tone(n)}">${boxInner(n)}</div>${n.children.length ? listHtml(n.children) : ""}</div>`;

    if (roots.length === 1) {
      const [root] = roots;
      const n = root.children.length;
      if (!list && n >= 2 && n <= 4)
        return `<div class="am-tree">${rootBox(root)}<div class="am-tree-cols" style="--n: ${n}">${root.children.map(colHtml).join("")}</div></div>`;
      return `<div class="am-tree">${rootBox(root, true)}${listHtml(root.children)}</div>`;
    }
    if (!list && roots.length <= 4)
      return `<div class="am-tree"><div class="am-tree-cols am-tree-cols--free" style="--n: ${roots.length}">${roots.map(colHtml).join("")}</div></div>`;
    return `<div class="am-tree">${listHtml(roots)}</div>`;
  },
};
