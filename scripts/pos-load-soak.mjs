#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

function arg(name, fallback = "") {
  const index = process.argv.findIndex((item) => item === `--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}
function numberArg(name, fallback) {
  const parsed = Number(arg(name, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function readJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function summarize(values) {
  if (values.length === 0) return { count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  return { count: values.length, min: Math.min(...values), p50: percentile(values, 50), p95: percentile(values, 95), p99: percentile(values, 99), max: Math.max(...values), avg: Number((total / values.length).toFixed(2)) };
}
function defaultScopes() {
  return [{ name: "default", cookie: process.env.CPIPOS_COOKIE ?? "", authorization: process.env.CPIPOS_AUTHORIZATION ?? "", headers: readJson(process.env.CPIPOS_HEADERS_JSON ?? "", {}) }];
}
function defaultRoutes() {
  return [
    { name: "session", method: "GET", path: "/api/pos/session/current" },
    { name: "features", method: "GET", path: "/api/pos/features" },
    { name: "products", method: "GET", path: "/api/pos/products" },
    { name: "tables", method: "GET", path: "/api/pos/tables" },
    { name: "sales_list", method: "GET", path: "/api/pos/sales-list" },
    { name: "print_smoke", method: "GET", path: "/api/backoffice/printers/smoke-status?limit=10" }
  ];
}

const baseUrl = String(arg("base-url", process.env.CPIPOS_BASE_URL ?? "https://cp-ipos-web.vercel.app")).replace(/\/+$/, "");
const seconds = Math.max(5, numberArg("seconds", Number(process.env.CPIPOS_SOAK_SECONDS ?? 60)));
const concurrency = Math.max(1, numberArg("concurrency", Number(process.env.CPIPOS_SOAK_CONCURRENCY ?? 12)));
const timeoutMs = Math.max(1000, numberArg("timeout-ms", Number(process.env.CPIPOS_SOAK_TIMEOUT_MS ?? 12000)));
const outFile = arg("out", process.env.CPIPOS_SOAK_OUT ?? "docs/evidence/pos-load-soak-report.json");
const scopes = readJson(arg("scopes-json", process.env.CPIPOS_SOAK_SCOPES_JSON ?? ""), defaultScopes());
const routes = readJson(arg("routes-json", process.env.CPIPOS_SOAK_ROUTES_JSON ?? ""), defaultRoutes());
const deadline = Date.now() + seconds * 1000;

const stats = new Map();
const queueSamples = [];
const timeoutErrors = new Map();
let totalRequests = 0;
let totalFailures = 0;

function key(scope, route) { return `${scope.name ?? "scope"}:${route.name ?? route.path}`; }
function ensureStat(scope, route) {
  const k = key(scope, route);
  if (!stats.has(k)) stats.set(k, { scope: scope.name ?? "scope", route: route.name ?? route.path, method: route.method ?? "GET", path: route.path, durations: [], statuses: new Map(), errors: new Map(), requests: 0, failures: 0 });
  return stats.get(k);
}
function headers(scope, route) {
  const h = { ...(scope.headers ?? {}), ...(route.headers ?? {}) };
  if (scope.cookie) h.Cookie = scope.cookie;
  if (scope.authorization) h.Authorization = scope.authorization;
  if (route.body !== undefined) h["Content-Type"] = "application/json";
  return h;
}
function recordQueueEvidence(route, body) {
  if (!body?.data) return;
  if (route.name !== "print_smoke") return;
  const recent = body.data.recent ?? {};
  const jobs = Array.isArray(recent.print_jobs) ? recent.print_jobs : [];
  const pending = jobs.filter((job) => ["pending", "claimed", "retrying"].includes(String(job.status ?? "")));
  const now = Date.now();
  const ages = pending.map((job) => now - new Date(job.created_at ?? now).getTime()).filter((value) => Number.isFinite(value) && value >= 0);
  queueSamples.push({ captured_at: new Date().toISOString(), pending_depth: pending.length, max_age_ms: ages.length ? Math.max(...ages) : 0 });
}
async function hit(scope, route) {
  const stat = ensureStat(scope, route);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let status = 0;
  let errCode = null;
  let ok = false;
  let body = null;
  try {
    const response = await fetch(`${baseUrl}${route.path}`, { method: route.method ?? "GET", headers: headers(scope, route), body: route.body === undefined ? undefined : JSON.stringify(route.body), signal: controller.signal });
    status = response.status;
    ok = response.ok;
    body = await response.json().catch(() => null);
    errCode = body?.error?.code ?? null;
    recordQueueEvidence(route, body);
  } catch (err) {
    errCode = err instanceof Error && err.name === "AbortError" ? "timeout" : "request_failed";
    timeoutErrors.set(errCode, (timeoutErrors.get(errCode) ?? 0) + 1);
  } finally {
    clearTimeout(timer);
  }
  const duration = Math.round(performance.now() - started);
  stat.requests += 1;
  stat.durations.push(duration);
  stat.statuses.set(status, (stat.statuses.get(status) ?? 0) + 1);
  totalRequests += 1;
  if (!ok) {
    stat.failures += 1;
    totalFailures += 1;
    stat.errors.set(errCode ?? String(status), (stat.errors.get(errCode ?? String(status)) ?? 0) + 1);
  }
}
async function worker(workerId) {
  let i = 0;
  while (Date.now() < deadline) {
    const scope = scopes[(workerId + i) % scopes.length];
    const route = routes[(workerId + i) % routes.length];
    await hit(scope, route);
    i += 1;
  }
}

console.log(`[pos-soak] base=${baseUrl} scopes=${scopes.length} routes=${routes.length} seconds=${seconds} concurrency=${concurrency}`);
await Promise.all(Array.from({ length: concurrency }, (_, idx) => worker(idx)));

const routeSummary = Object.fromEntries([...stats.entries()].map(([k, stat]) => [k, {
  scope: stat.scope,
  route: stat.route,
  method: stat.method,
  path: stat.path,
  requests: stat.requests,
  failures: stat.failures,
  error_rate_pct: stat.requests ? Number(((stat.failures / stat.requests) * 100).toFixed(2)) : 0,
  latency_ms: summarize(stat.durations),
  status_counts: Object.fromEntries([...stat.statuses.entries()].sort((a, b) => a[0] - b[0])),
  error_codes: Object.fromEntries([...stat.errors.entries()].sort((a, b) => b[1] - a[1]))
}]));
const report = {
  generated_at: new Date().toISOString(),
  config: { base_url: baseUrl, seconds, concurrency, timeout_ms: timeoutMs, scopes: scopes.map((scope) => scope.name ?? "scope"), routes: routes.map((route) => route.name ?? route.path) },
  totals: { requests: totalRequests, failures: totalFailures, error_rate_pct: totalRequests ? Number(((totalFailures / totalRequests) * 100).toFixed(2)) : 0, throughput_rps: Number((totalRequests / seconds).toFixed(2)) },
  route_summary: routeSummary,
  queue: { samples: queueSamples, max_pending_depth: queueSamples.length ? Math.max(...queueSamples.map((s) => s.pending_depth)) : null, max_age_ms: queueSamples.length ? Math.max(...queueSamples.map((s) => s.max_age_ms)) : null },
  timeout_errors: Object.fromEntries(timeoutErrors.entries())
};

const outputPath = resolve(outFile);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`[pos-soak] report written to ${outputPath}`);

if (report.totals.error_rate_pct > Number(process.env.CPIPOS_SOAK_MAX_ERROR_RATE_PCT ?? 2)) process.exitCode = 1;
