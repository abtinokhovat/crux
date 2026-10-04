// Local web app: serves the SPA, a JSON API over the project's markdown,
// and pushes reloads over SSE when files change.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStore, siteData } from "./store.mjs";
import { componentsCss, listComponents, loadProjectComponents, renderAdr } from "./render.mjs";
import { themeCss } from "./theme.mjs";
import * as edit from "./edit.mjs";
import * as flow from "./flow.mjs";
import * as share from "./share/client.mjs";

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
    "/api/site": () => ({ ...siteData(cfg, store), components: listComponents(), local: true, me: cfg.me, share: { url: cfg.share, loggedIn: !!cfg.shareToken, items: share.shareState(cfg) } }),
    "/api/theme.css": () => [themeCss() + "\n" + componentsCss(), "text/css; charset=utf-8"],
  };

  // Local write actions. Only from this app: the custom header forces a CORS preflight,
  // which other websites cannot pass.
  async function action(req, res, path) {
    if (req.headers["x-adr"] !== "1") return json(res, { error: "forbidden" }, 403);
    const body = await readJson(req);
    const m = path.match(/^\/api\/(new|doc\/(\d+)\/(keep|drop|notes|share|close|reply|import|pull|finalize|status))$/);
    if (!m) return json(res, { error: "unknown action" }, 404);
    const [, kind, id, verb] = m;
    try {
      if (kind === "new") {
        const r = flow.createDraft(cfg, store, { question: body.question, notes: body.notes, due: body.due });
        await reload();
        let url = null;
        if (body.openNotes) url = (await share.openNotes(cfg, store.byId.get(r.id))).url;
        return json(res, { ...r, url });
      }
      const adr = store.byId.get(id);
      if (!adr) return json(res, { error: "not found" }, 404);
      const file = cfg.abs(adr.file);
      let out = { ok: true };
      if (verb === "keep") edit.writeText(file, edit.keepPanel(edit.readText(file), body.title));
      else if (verb === "drop") edit.writeText(file, edit.removePanel(edit.readText(file), body.title));
      else if (verb === "status") flow.setStatus(cfg, adr, body.status);
      else if (verb === "notes") out = { url: (await share.openNotes(cfg, adr)).url };
      else if (verb === "share") {
        if (["draft", "open", "proposed"].includes(adr.statusKey)) flow.setStatus(cfg, adr, "In review");
        await reload();
        out = { url: (await share.shareReview(cfg, store, store.byId.get(id))).url };
      } else if (verb === "close") out = await share.setMode(cfg, adr, "closed");
      else if (verb === "reply") out = await share.reply(cfg, adr, body.entry, body.kind, body.text ?? "");
      else if (verb === "import") {
        const item = await share.fetchItem(cfg, adr);
        const ids = new Set(body.entries ?? item.entries.map((e) => e.id));
        const tags = body.tags ?? {};
        out = { added: flow.importNotes(cfg, adr, item.entries.filter((e) => ids.has(e.id)).map((e) => ({ ...e, tag: tags[e.id] }))) };
      } else if (verb === "pull") out = { file: share.writeDigest(cfg, adr, await share.fetchItem(cfg, adr)).replace(cfg.root + "/", "") };
      else if (verb === "finalize") {
        let item = null;
        try { item = await share.fetchItem(cfg, adr); } catch {}
        const dissent = (item?.entries ?? []).filter((e) => e.kind === "pick" && e.opt !== body.option).map((e) => ({ by: e.by, opt: e.opt, why: e.text }));
        flow.finalize(cfg, adr, { option: body.option, decision: body.decision, dissent, reopen: body.reopen ?? [] });
        if (item) {
          await reload();
          await share.publishFinal(cfg, store, store.byId.get(id), { option: body.option, decision: body.decision });
        }
        out = { ok: true, dissent: dissent.length };
      }
      await reload();
      return json(res, out);
    } catch (err) {
      return json(res, { error: err.message }, 400);
    }
  }

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
        if (req.method === "POST") return await action(req, res, path);
        const team = path.match(/^\/api\/team\/(\d+)$/);
        if (team) {
          const adr = store.byId.get(team[1]);
          if (!adr) return json(res, { error: "not found" }, 404);
          const st = share.shareState(cfg)[adr.id] ?? null;
          if (!st) return json(res, { shared: null, configured: !!cfg.share, loggedIn: !!cfg.shareToken });
          try {
            return json(res, { shared: st, item: await share.fetchItem(cfg, adr), configured: true, loggedIn: !!cfg.shareToken });
          } catch (err) {
            return json(res, { shared: st, error: err.message, configured: true, loggedIn: !!cfg.shareToken });
          }
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

function readJson(req) {
  return new Promise((ok) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { ok(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { ok({}); }
    });
  });
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
