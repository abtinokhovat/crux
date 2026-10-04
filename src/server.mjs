// Local web app: serves the SPA, a JSON API over the project's markdown,
// and pushes reloads over SSE when files change.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStore, siteData } from "./store.mjs";
import { componentsCss, listComponents, loadProjectComponents, renderAdr } from "./render.mjs";
import { themeCss } from "./theme.mjs";

const WEB = fileURLToPath(new URL("../web/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".md": "text/markdown; charset=utf-8" };

export async function createApp(cfg) {
  let store;
  const reload = async () => {
    await loadProjectComponents(cfg);
    store = loadStore(cfg);
    return store;
  };
  await reload();

  const docPayload = (item) => {
    const { html, errors } = renderAdr(item, store, cfg);
    const { source, ...meta } = item;
    return { meta, html, errors, source };
  };

  const api = {
    "/api/site": () => ({ ...siteData(cfg, store), components: listComponents() }),
    "/api/theme.css": () => [themeCss() + "\n" + componentsCss(), "text/css; charset=utf-8"],
  };

  return {
    get store() { return store; },
    reload,
    async handle(req, res, clients) {
      const url = new URL(req.url, "http://x");
      const path = decodeURIComponent(url.pathname);
      try {
        if (path === "/api/events") {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          res.write("retry: 1000\n\n");
          clients.add(res);
          req.on("close", () => clients.delete(res));
          return;
        }
        if (api[path]) {
          const out = api[path]();
          if (Array.isArray(out)) return send(res, 200, out[0], out[1]);
          return json(res, out);
        }
        const doc = path.match(/^\/api\/doc\/(.+)$/);
        if (doc) {
          const item = store.byId.get(doc[1]);
          return item ? json(res, docPayload(item)) : json(res, { error: "not found" }, 404);
        }
        if (path.startsWith("/files/")) return file(res, cfg.root, path.slice(7));
        if (path === "/" || path === "/index.html") return file(res, WEB, "index.html");
        return file(res, WEB, path.slice(1));
      } catch (err) {
        json(res, { error: err.message }, 500);
      }
    },
  };
}

function send(res, code, body, type) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}
const json = (res, data, code = 200) => send(res, code, JSON.stringify(data), "application/json");

function file(res, base, rel) {
  const full = resolve(base, normalize(rel));
  if (!full.startsWith(resolve(base) + sep) && full !== resolve(base)) return send(res, 403, "forbidden", "text/plain");
  if (!existsSync(full) || statSync(full).isDirectory()) return send(res, 404, "not found", "text/plain");
  send(res, 200, readFileSync(full), TYPES[extname(full)] ?? "application/octet-stream");
}

export async function serve(cfg, { port = 4321, host = "127.0.0.1" } = {}) {
  const app = await createApp(cfg);
  const clients = new Set();
  const server = createServer((req, res) => app.handle(req, res, clients));

  let timer;
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await app.reload();
        for (const c of clients) c.write(`data: ${JSON.stringify({ type: "reload", at: Date.now() })}\n\n`);
      } catch (err) {
        process.stderr.write(`reload failed: ${err.message}\n`);
      }
    }, 120);
  };
  const watchDirs = [cfg.dir, cfg.components, ...cfg.docs, cfg.architecture.split(/[\\/]/).slice(0, -1).join("/") || "."].map((d) => cfg.abs(d));
  for (const d of new Set(watchDirs)) {
    if (!existsSync(d)) continue;
    try {
      watch(d, { recursive: true }, (_e, f) => f && /\.(md|ya?ml|m?js|json)$/.test(f) && onChange());
    } catch {}
  }
  if (cfg.file) watch(cfg.file, onChange);

  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, host, ok);
  });
  return { server, app, url: `http://${host === "0.0.0.0" ? "localhost" : host}:${server.address().port}/` };
}
