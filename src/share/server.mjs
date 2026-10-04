// adr share server: a small service for meeting notes and team review of ADRs.
// Owners (token) publish a question or a review snapshot; teammates (team passcode) add notes,
// comments, pros/cons with reasons, answers and picks. Storage: one JSON file per item.
//
// Env: PORT (8080) · HOST (0.0.0.0) · ADR_DATA (./data) · ADR_PUBLIC_URL
//      ADR_TOKENS="handle:token,handle2:token2" (owners) · ADR_PASSCODE (team, optional)
import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { themeCss } from "../theme.mjs";
import { pageHtml } from "./page.mjs";

const APP_CSS = fileURLToPath(new URL("../../web/app.css", import.meta.url));
const LIMIT = { body: 4 * 1024 * 1024, text: 4000, entriesPerMin: 40 };
const KINDS = { notes: ["note"], review: ["comment", "pro", "con", "answer", "pick"] };

export function startShareServer({ port = 8080, host = "0.0.0.0", data = "./data", tokens = "", passcode = "", publicUrl = "" } = {}) {
  const dir = join(data, "items");
  mkdirSync(dir, { recursive: true });
  const owners = new Map(
    String(tokens).split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
      const i = s.indexOf(":");
      return [s.slice(i + 1), s.slice(0, i)];
    }),
  );
  if (!owners.size) process.stderr.write("! ADR_TOKENS is empty: nobody can publish. Set ADR_TOKENS=\"handle:token\".\n");
  const secret = createHash("sha256").update(`adr-share:${passcode}:${[...owners.keys()].join()}`).digest();
  const teamCookie = passcode ? createHmac("sha256", secret).update(passcode).digest("hex") : null;
  const css = () => themeCss() + "\n" + readFileSync(APP_CSS, "utf8");

  // ── storage ──
  const file = (slug) => join(dir, `${slug}.json`);
  const load = (slug) => (/^[a-z0-9]{6,40}$/.test(slug) && existsSync(file(slug)) ? JSON.parse(readFileSync(file(slug), "utf8")) : null);
  const save = (item) => {
    item.updatedAt = new Date().toISOString();
    const tmp = `${file(item.slug)}.tmp`;
    writeFileSync(tmp, JSON.stringify(item, null, 1));
    renameSync(tmp, file(item.slug));
  };
  const all = () => readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

  // ── live updates ──
  const subs = new Map();
  const notify = (slug, type, payload = {}) => {
    for (const res of subs.get(slug) ?? []) res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  // ── auth ──
  const ownerOf = (req) => {
    const t = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!t) return null;
    for (const [tok, handle] of owners) {
      const a = Buffer.from(tok), b = Buffer.from(t);
      if (a.length === b.length && timingSafeEqual(a, b)) return handle;
    }
    return null;
  };
  const cookies = (req) => Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).filter((x) => x[0]));
  const isTeam = (req) => !passcode || !!ownerOf(req) || cookies(req).adr_team === teamCookie || req.headers["x-adr-passcode"] === passcode;

  // ── rate limit for public writes ──
  const hits = new Map();
  const limited = (req) => {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
    const now = Date.now(), w = (hits.get(ip) ?? []).filter((t) => now - t < 60000);
    w.push(now);
    hits.set(ip, w);
    return w.length > LIMIT.entriesPerMin;
  };

  const send = (res, code, body, type = "application/json; charset=utf-8", extra = {}) => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "same-origin", ...extra });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const fail = (res, code, msg) => send(res, code, { error: msg });
  const body = (req) =>
    new Promise((ok, bad) => {
      let n = 0;
      const chunks = [];
      req.on("data", (c) => {
        n += c.length;
        if (n > LIMIT.body) { bad(new Error("too large")); req.destroy(); }
        else chunks.push(c);
      });
      req.on("end", () => {
        try {
          ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
        } catch {
          bad(new Error("bad json"));
        }
      });
    });
  const clean = (s, max = LIMIT.text) => String(s ?? "").slice(0, max).trim();
  const handle = (s) => clean(s, 40).replace(/^@/, "").replace(/[^\w.-]/g, "");
  const base = (req) => publicUrl || `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host}`;
  const view = (item) => ({ ...item, ownerKey: undefined });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    try {
      if (p === "/healthz") return send(res, 200, { ok: true });
      if (p === "/assets/app.css") return send(res, 200, css(), "text/css; charset=utf-8", { "cache-control": "public, max-age=300" });
      if (p === "/" ) return send(res, 200, pageHtml({ landing: true }), "text/html; charset=utf-8");
      if (p === "/api/login" && req.method === "POST") {
        const b = await body(req);
        if (!passcode || b.passcode !== passcode) return fail(res, 403, "wrong passcode");
        return send(res, 200, { ok: true }, undefined, { "set-cookie": `adr_team=${teamCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${base(req).startsWith("https") ? "; Secure" : ""}` });
      }
      if (p === "/api/me") {
        const me = ownerOf(req);
        return me ? send(res, 200, { handle: me }) : fail(res, 401, "bad token");
      }

      const page = p.match(/^\/i\/([a-z0-9]+)$/);
      if (page) {
        if (!load(page[1])) return send(res, 404, pageHtml({ missing: true }), "text/html; charset=utf-8");
        return send(res, 200, pageHtml({ slug: page[1], needPass: !isTeam(req) }), "text/html; charset=utf-8");
      }

      // owner: list + publish
      if (p === "/api/items" && req.method === "GET") {
        const me = ownerOf(req);
        if (!me) return fail(res, 401, "token required");
        return send(res, 200, all().filter((i) => i.owner === me).map((i) => ({ slug: i.slug, adr: i.adr, mode: i.mode, repo: i.repo, entries: i.entries.length, updatedAt: i.updatedAt, url: `${base(req)}/i/${i.slug}` })));
      }
      if (p === "/api/items" && req.method === "POST") {
        const me = ownerOf(req);
        if (!me) return fail(res, 401, "token required");
        const b = await body(req);
        const repo = clean(b.repo, 200), adrId = clean(b.adr?.id, 20);
        let item = all().find((i) => i.owner === me && i.repo === repo && i.adr?.id === adrId);
        if (!item) item = { slug: randomBytes(8).toString("hex"), owner: me, repo, createdAt: new Date().toISOString(), entries: [], versions: 0 };
        Object.assign(item, patchFields(b, clean));
        if (b.snapshot) item.versions = (item.versions ?? 0) + 1;
        save(item);
        notify(item.slug, "item");
        return send(res, 200, { ...view(item), url: `${base(req)}/i/${item.slug}` });
      }

      const m = p.match(/^\/api\/items\/([a-z0-9]+)(?:\/(entries|events)(?:\/([a-z0-9]+)(?:\/(reply))?)?)?$/);
      if (!m) return fail(res, 404, "not found");
      const [, slug, sub, eid, reply] = m;
      const item = load(slug);
      if (!item) return fail(res, 404, "not found");
      const me = ownerOf(req);
      const isOwner = me && me === item.owner;

      if (!sub && req.method === "GET") return isTeam(req) ? send(res, 200, view(item)) : fail(res, 403, "passcode required");
      if (!sub && req.method === "PATCH") {
        if (!isOwner) return fail(res, 403, "owner only");
        Object.assign(item, patchFields(await body(req), clean));
        save(item);
        notify(slug, "item");
        return send(res, 200, view(item));
      }
      if (sub === "events") {
        if (!isTeam(req)) return fail(res, 403, "passcode required");
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
        res.write("retry: 2000\n\n");
        if (!subs.has(slug)) subs.set(slug, new Set());
        subs.get(slug).add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 25000);
        req.on("close", () => { clearInterval(ping); subs.get(slug)?.delete(res); });
        return;
      }
      if (sub === "entries" && !eid && req.method === "POST") {
        if (!isTeam(req)) return fail(res, 403, "passcode required");
        if (limited(req)) return fail(res, 429, "slow down");
        const b = await body(req);
        const allowed = KINDS[item.mode] ?? [];
        if (!allowed.includes(b.kind)) return fail(res, 409, item.mode === "final" ? "this decision is closed" : `“${b.kind}” is not open right now`);
        const by = handle(b.by);
        if (!by) return fail(res, 400, "name required");
        if (["pro", "con"].includes(b.kind) && !clean(b.why)) return fail(res, 400, "a reason is required");
        if (["pro", "con", "pick"].includes(b.kind) && !item.snapshot?.options?.some((o) => o.key === b.opt)) return fail(res, 400, "unknown option");
        const e = { id: randomBytes(5).toString("hex"), kind: b.kind, by, text: clean(b.text), why: clean(b.why), opt: clean(b.opt, 4) || null, target: clean(b.target, 200) || null, conf: b.kind === "pick" ? Math.max(0, Math.min(100, Number(b.conf) || 0)) : undefined, at: new Date().toISOString(), reply: null };
        if (!e.text && b.kind !== "pick") return fail(res, 400, "text required");
        if (b.kind === "pick") item.entries = item.entries.filter((x) => !(x.kind === "pick" && x.by === by));
        item.entries.push(e);
        save(item);
        notify(slug, "entry", { entry: e });
        return send(res, 200, e);
      }
      if (sub === "entries" && eid && reply && req.method === "POST") {
        if (!isOwner) return fail(res, 403, "owner only");
        const e = item.entries.find((x) => x.id === eid);
        if (!e) return fail(res, 404, "no entry");
        const b = await body(req);
        e.reply = { kind: clean(b.kind, 20) || "replied", text: clean(b.text), at: new Date().toISOString() };
        save(item);
        notify(slug, "entry", { entry: e });
        return send(res, 200, e);
      }
      if (sub === "entries" && eid && !reply && req.method === "DELETE") {
        if (!isOwner) return fail(res, 403, "owner only");
        item.entries = item.entries.filter((x) => x.id !== eid);
        save(item);
        notify(slug, "item");
        return send(res, 200, { ok: true });
      }
      return fail(res, 405, "method not allowed");
    } catch (err) {
      return fail(res, err.message === "too large" ? 413 : 400, err.message);
    }
  });
  return new Promise((ok, bad) => {
    server.once("error", bad);
    server.listen(port, host, () => ok({ server, url: publicUrl || `http://${host === "0.0.0.0" ? "localhost" : host}:${server.address().port}`, owners: [...owners.values()] }));
  });
}

// Fields an owner may set when publishing.
function patchFields(b, clean) {
  const out = {};
  if (b.adr) out.adr = { id: clean(b.adr.id, 20), title: clean(b.adr.title, 300), status: clean(b.adr.status, 40) };
  if (b.mode) out.mode = ["notes", "review", "closed", "final"].includes(b.mode) ? b.mode : "closed";
  if (b.question != null) out.question = clean(b.question, 1000);
  if (b.context != null) out.context = clean(b.context, 20000);
  if (b.snapshot) {
    out.snapshot = {
      html: sanitize(String(b.snapshot.html ?? "").slice(0, 3_000_000)),
      options: (b.snapshot.options ?? []).slice(0, 26).map((o) => ({ key: clean(o.key, 4), name: clean(o.name, 200) })),
      questions: (b.snapshot.questions ?? []).slice(0, 50).map((q) => ({ to: clean(q.to, 40).replace(/^@/, ""), text: clean(q.text, 1000) })),
      leaning: b.snapshot.leaning ? { opt: clean(b.snapshot.leaning.opt, 4), why: clean(b.snapshot.leaning.why, 2000) } : null,
      at: new Date().toISOString(),
    };
  }
  if (b.final) out.final = { option: clean(b.final.option, 4), decision: clean(b.final.decision, 4000), at: new Date().toISOString() };
  return out;
}

// The snapshot is rendered ADR HTML from the owner's CLI. Strip anything executable anyway.
function sanitize(html) {
  return html
    .replace(/<(script|iframe|object|embed|link|meta|base|form)\b[\s\S]*?(<\/\1>|\/?>)/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}
