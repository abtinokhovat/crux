// CSS from the answer-me-with-html blueprint theme (light)
// plus the base component CSS and syntax-highlight tokens.
import { BASE_CSS, THEMES } from "./am.js";

const block = (sel, vars) => `${sel} {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;

// Syntax colors that sit next to the blueprint palette.
const CODE = { "--hl-kw": "#a626a4", "--hl-str": "#2e7d32", "--hl-num": "#b35c00", "--hl-fn": "#1d5fbf", "--hl-type": "#00838f", "--hl-com": "#8b929e", "--hl-attr": "#9a6700", "--hl-meta": "#c62828" };

// One look only: the light blueprint theme.
export function themeCss() {
  const out = [];
  const t = THEMES.blueprint;
  out.push(block(`html[data-theme="blueprint"]`, { ...t.common, ...t.light, ...CODE }));
  out.push(BASE_CSS);
  out.push(`
.hljs-keyword, .hljs-selector-tag, .hljs-built_in.hljs-keyword, .hljs-literal { color: var(--hl-kw); }
.hljs-string, .hljs-regexp, .hljs-addition, .hljs-template-string { color: var(--hl-str); }
.hljs-number, .hljs-symbol, .hljs-bullet { color: var(--hl-num); }
.hljs-title, .hljs-title.function_, .hljs-section { color: var(--hl-fn); }
.hljs-type, .hljs-built_in, .hljs-title.class_, .hljs-class .hljs-title { color: var(--hl-type); }
.hljs-comment, .hljs-quote { color: var(--hl-com); font-style: italic; }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable, .hljs-property { color: var(--hl-attr); }
.hljs-meta, .hljs-deletion, .hljs-tag { color: var(--hl-meta); }
.hljs-emphasis { font-style: italic; } .hljs-strong { font-weight: 700; }`);
  return out.join("\n\n");
}
