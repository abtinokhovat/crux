// The browser steps parser must read flows exactly like the Go one (internal/adr/element.go).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSteps } from "../../web-src/components/system.js";

const site = { catalog: { transports: { http: { mode: "sync" }, topic: { mode: "async", aliases: ["event"] } } } };

test("steps: ids, transports, async, phases, branches, notes", () => {
  const out = parseSteps(`== order ==
place:  customer -> api : http POST /orders
emit:   orders --> billing : event order.created
  ? declined -> failed
note: one transaction
billing -> psp: POST /v1/charges
// ignored`, site);
  const steps = out.filter((s) => s.kind === "step");
  assert.equal(steps.length, 3);
  assert.deepEqual([steps[0].id, steps[0].from, steps[0].to, steps[0].transport, steps[0].name, steps[0].async, steps[0].phase], ["place", "customer", "api", "http", "POST /orders", false, "order"]);
  assert.equal(steps[1].async, true);
  assert.equal(steps[1].transport, "topic");
  assert.deepEqual(steps[1].branches, [{ when: "declined", to: "failed" }]);
  assert.deepEqual(steps[1].notes, ["one transaction"]);
  assert.equal(steps[2].id, "s3");
  assert.equal(steps[2].label, "POST /v1/charges");
});
