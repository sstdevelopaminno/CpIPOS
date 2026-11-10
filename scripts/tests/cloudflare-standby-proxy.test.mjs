import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { proxyToEdgeMiddleware } from "../cloudflare-standby-build.mjs";

const source = readFileSync(resolve("apps/backoffice-web/src/proxy.ts"), "utf8");

test("Cloudflare Edge bridge changes only proxy export; security and matcher identical", () => {
  const edge = proxyToEdgeMiddleware(source);
  assert.ok(edge.includes("export async function middleware(request: NextRequest)"));
  assert.ok(!edge.includes("export async function proxy(request: NextRequest)"));
  assert.equal(edge.replace("export async function middleware(request: NextRequest)", "export async function proxy(request: NextRequest)"), source);
  assert.match(edge, /refreshControlPlaneSession/);
  assert.match(edge, /stripSupabaseSessionCookiesFromRequest/);
  assert.match(edge, /\/api\/backoffice\/catalog/);
  assert.match(edge, /\/it-admin\/:path\*/);
  assert.match(edge, /\/preview\/pos\/payments\/package/);
});

test("refuses incompatible or unreviewed proxy entry points", () => {
  assert.throws(() => proxyToEdgeMiddleware("export async function proxy() {}"));
  assert.throws(() => proxyToEdgeMiddleware(""));
});
