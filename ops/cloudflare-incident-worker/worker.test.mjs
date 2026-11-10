import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";

test("incident page is independent, public, read-only and no-cache", async () => {
  const response = await worker.fetch(new Request("https://example.workers.dev/"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Security-Policy"), /form-action 'none'/);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  const html = await response.text();
  assert.match(html, /ระบบกำลังประสบปัญหา/);
  assert.match(html, /Temporary service interruption/);
  assert.doesNotMatch(html, /<form|<input|SUPABASE_SERVICE_ROLE_KEY/);
});
test("health endpoint reports incident, not POS readiness", async () => {
  const response = await worker.fetch(new Request("https://example.workers.dev/health"));
  assert.deepEqual(await response.json(), { service: "CpiPOS incident notice", status: "incident" });
});
test("rejects writes, unknown paths and does not publish secrets", async () => {
  const write = await worker.fetch(new Request("https://example.workers.dev/", { method: "POST" }));
  assert.equal(write.status, 405);
  assert.equal(write.headers.get("Allow"), "GET, HEAD");
  const other = await worker.fetch(new Request("https://example.workers.dev/login/store"));
  assert.equal(other.status, 404);
  const head = await worker.fetch(new Request("https://example.workers.dev/", {method:"HEAD"}));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});
