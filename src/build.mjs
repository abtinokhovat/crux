// Static export: same SPA, with the API answers written as files.
// Host the output on any static server (GitHub Pages, S3, nginx).
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { siteData } from "./store.mjs";
import { componentsCss, listComponents, loadProjectComponents, renderAdr } from "./render.mjs";
import { loadStore } from "./store.mjs";
import { themeCss } from "./theme.mjs";

const WEB = fileURLToPath(new URL("../web/", import.meta.url));

export async function build(cfg, out) {
  const dir = resolve(out);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(WEB, dir, { recursive: true });
  await loadProjectComponents(cfg);
  const store = loadStore(cfg);
  const write = (rel, body) => {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  write("api/site", JSON.stringify({ ...siteData(cfg, store), components: listComponents(), static: true }));
  write("api/theme.css", themeCss() + "\n" + componentsCss());
  let errors = 0;
  for (const item of store.byId.values()) {
    const { html, errors: errs } = renderAdr(item, store, cfg);
    errors += errs.length;
    const { source, ...meta } = item;
    write(`api/doc/${item.id}`, JSON.stringify({ meta, html, errors: errs, source }));
  }
  return { dir, count: store.byId.size, errors, problems: store.problems };
}
