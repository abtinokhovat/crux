import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.mjs";
import { loadStore } from "../src/store.mjs";
import { loadProjectComponents, renderAdr } from "../src/render.mjs";
import { optionsFromTable, parseTable, splitFrontmatter } from "../src/parse.mjs";

const root = fileURLToPath(new URL("../example", import.meta.url));

test("options table → verdicts, topic-less, letter keys", () => {
  const t = parseTable("| Option | Pros | Cons | Verdict |\n|---|---|---|---|\n| A — Kafka | Replay. | Ops. | ok |\n| B — Rabbit | Easy. | No replay. | no |");
  const o = optionsFromTable(t);
  assert.equal(o[0].key, "A");
  assert.equal(o[0].name, "Kafka");
  assert.equal(o[0].verdict.kind, "ok");
  assert.equal(o[1].verdict.kind, "no");
  assert.equal(o[0].fields.find((f) => f.role === "pro").text, "Replay.");
});

test("frontmatter tolerates unquoted colons", () => {
  const { meta } = splitFrontmatter("---\ntitle: A: b\ntags: [x, y]\n---\nbody");
  assert.equal(meta.title, "A: b");
  assert.deepEqual(meta.tags, ["x", "y"]);
});

test("example project indexes, links and renders cleanly", async () => {
  const cfg = loadConfig(root);
  await loadProjectComponents(cfg);
  const s = loadStore(cfg);
  assert.equal(s.problems.length, 0, JSON.stringify(s.problems));
  assert.equal(s.adrs.length, 3);
  assert.ok(s.edges.some((e) => e.from === "0001" && e.to === "0003" && e.type === "depends_on"));
  assert.ok(s.architecture.nodes.kafka.adrs.includes("0001"));
  assert.ok(s.architecture.nodes.messaging.deep.includes("0001"));
  for (const a of s.adrs) {
    const { html, errors } = renderAdr(a, s, cfg);
    assert.deepEqual(errors, [], a.id);
    assert.match(html, /am-panel/);
  }
  const { html } = renderAdr(s.byId.get("0001"), s, cfg);
  assert.match(html, /ak-hero--decision/);
  assert.match(html, /ak-opt--ok/);
  assert.match(html, /ak-compare/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /x-risk/); // project component
  assert.match(html, /class="ak-ref ak-st-open" href="#\/adr\/0002"/);
});
