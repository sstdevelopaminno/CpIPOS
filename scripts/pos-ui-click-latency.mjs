#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

function arg(name, fallback = "") {
  const index = process.argv.findIndex((item) => item === `--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
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

const baseUrl = String(arg("base-url", process.env.CPIPOS_BASE_URL ?? "http://localhost:3000")).replace(/\/+$/, "");
const route = arg("route", process.env.CPIPOS_UI_ROUTE ?? "/preview/pos");
const outFile = arg("out", process.env.CPIPOS_UI_LATENCY_OUT ?? "docs/evidence/pos-ui-click-latency-report.json");
const headless = String(arg("headless", process.env.CPIPOS_UI_HEADLESS ?? "true")).toLowerCase() !== "false";
const cookieHeader = arg("cookie", process.env.CPIPOS_COOKIE ?? "");
const selectors = readJson(arg("selectors-json", process.env.CPIPOS_UI_SELECTORS_JSON ?? ""), [
  { name: "sales_mode_switch", selector: "button[aria-label*='โหมด'], button[aria-label*='mode']" },
  { name: "table_tab", selector: "[role='tab'], .posui-table-browser__view-switch button" },
  { name: "first_safe_button", selector: "button:not([disabled])" }
]);
const iterations = Math.max(1, Number(arg("iterations", process.env.CPIPOS_UI_ITERATIONS ?? "3")) || 3);
const waitAfterClickMs = Math.max(0, Number(arg("wait-after-click-ms", process.env.CPIPOS_UI_WAIT_AFTER_CLICK_MS ?? "80")) || 80);

function cookiesFromHeader(url, header) {
  if (!header) return [];
  const parsed = new URL(url);
  return header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const eq = part.indexOf("=");
    return { name: part.slice(0, eq), value: part.slice(eq + 1), domain: parsed.hostname, path: "/" };
  }).filter((item) => item.name && item.value);
}

const browser = await chromium.launch({ headless });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const consoleErrors = [];
const failedRequests = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText ?? null }));

const targetUrl = `${baseUrl}${route.startsWith("/") ? route : `/${route}`}`;
const cookies = cookiesFromHeader(targetUrl, cookieHeader);
if (cookies.length > 0) await context.addCookies(cookies);

const navStarted = Date.now();
await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 45000 });
const navMs = Date.now() - navStarted;
const overlay = await page.locator("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay").count();
const bodyTextLength = await page.locator("body").innerText().then((text) => text.trim().length).catch(() => 0);

const measurements = [];
for (const target of selectors) {
  const locator = page.locator(target.selector).first();
  const count = await page.locator(target.selector).count().catch(() => 0);
  if (count === 0) {
    measurements.push({ name: target.name, selector: target.selector, skipped: true, reason: "selector_not_found", samples: [] });
    continue;
  }
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    const started = Date.now();
    await locator.click({ timeout: 5000 }).catch((error) => {
      samples.push({ ok: false, latency_ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    });
    if (samples[i]?.ok === false) continue;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (waitAfterClickMs > 0) await page.waitForTimeout(waitAfterClickMs);
    samples.push({ ok: true, latency_ms: Date.now() - started, error: null });
  }
  measurements.push({ name: target.name, selector: target.selector, skipped: false, samples, latency_ms: summarize(samples.filter((sample) => sample.ok).map((sample) => sample.latency_ms)) });
}

const allLatencies = measurements.flatMap((item) => item.samples?.filter((sample) => sample.ok).map((sample) => sample.latency_ms) ?? []);
const report = {
  generated_at: new Date().toISOString(),
  url: targetUrl,
  nav_ms: navMs,
  page: { body_text_length: bodyTextLength, framework_error_overlay_count: overlay },
  summary: { click_latency_ms: summarize(allLatencies), console_error_count: consoleErrors.length, failed_request_count: failedRequests.length },
  measurements,
  console_errors: consoleErrors.slice(0, 20),
  failed_requests: failedRequests.slice(0, 20)
};

const outputPath = resolve(outFile);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`[ui-click-latency] report written to ${outputPath}`);
await browser.close();

if (overlay > 0 || bodyTextLength === 0 || consoleErrors.length > 0) process.exitCode = 1;
