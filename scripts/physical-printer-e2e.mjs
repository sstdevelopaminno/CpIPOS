#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

function arg(name, fallback = "") {
  const index = process.argv.findIndex((item) => item === `--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function list(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function readJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

const baseUrl = String(arg("base-url", process.env.CPIPOS_BASE_URL ?? "https://cp-ipos-web.vercel.app")).replace(/\/+$/, "");
const cookie = arg("cookie", process.env.CPIPOS_COOKIE ?? "");
const authorization = arg("authorization", process.env.CPIPOS_AUTHORIZATION ?? "");
const extraHeaders = readJson(arg("headers-json", process.env.CPIPOS_HEADERS_JSON ?? ""), {});
const timeoutMs = Math.max(1000, Number(arg("timeout-ms", process.env.CPIPOS_PRINTER_E2E_TIMEOUT_MS ?? "15000")) || 15000);
const outFile = arg("out", process.env.CPIPOS_PRINTER_E2E_OUT ?? "docs/evidence/physical-printer-e2e-report.json");
const targetDevice = arg("device", process.env.CPIPOS_PRINTER_E2E_DEVICE ?? "");
const targetPrinter = arg("printer", process.env.CPIPOS_PRINTER_E2E_PRINTER ?? "");
const bluetoothBridgeUrl = arg("bluetooth-bridge-url", process.env.CPIPOS_BLUETOOTH_BRIDGE_URL ?? "");
const printerIds = {
  lan: list(arg("lan-printer-id", process.env.CPIPOS_LAN_PRINTER_IDS ?? "")),
  usb: list(arg("usb-printer-id", process.env.CPIPOS_USB_PRINTER_IDS ?? "")),
  bluetooth: list(arg("bluetooth-printer-id", process.env.CPIPOS_BLUETOOTH_PRINTER_IDS ?? ""))
};

function headers(json = false) {
  return {
    ...extraHeaders,
    ...(cookie ? { Cookie: cookie } : {}),
    ...(authorization ? { Authorization: authorization } : {}),
    ...(json ? { "Content-Type": "application/json" } : {})
  };
}

async function timedRequest(label, path, init = {}) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status = 0;
  let body = null;
  let ok = false;
  let error = null;
  try {
    const response = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal });
    status = response.status;
    ok = response.ok;
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
  return {
    label,
    path,
    status,
    ok,
    latency_ms: Math.round(performance.now() - started),
    error,
    error_code: body?.error?.code ?? body?.data?.code ?? null,
    body
  };
}

function summarizeChecks(results) {
  const byLabel = Object.fromEntries(results.map((item) => [item.label, { ok: item.ok, status: item.status, latency_ms: item.latency_ms, error_code: item.error_code, error: item.error }]));
  const testPrints = results.filter((item) => item.label.startsWith("test_print:"));
  const transportCoverage = Object.fromEntries(Object.entries(printerIds).map(([mode, ids]) => [mode, {
    configured_ids: ids.length,
    attempted: testPrints.filter((item) => item.label.startsWith(`test_print:${mode}:`)).length,
    accepted: testPrints.filter((item) => item.label.startsWith(`test_print:${mode}:`) && item.ok).length
  }]));
  const coreChecksOk = Boolean(byLabel['discover:all']?.ok && byLabel.devices?.ok);
  const requestedSmokeOk = byLabel['smoke-status'] ? Boolean(byLabel['smoke-status'].ok) : true;
  const bluetoothHealthOk = byLabel['bluetooth:health'] ? Boolean(byLabel['bluetooth:health'].ok) : true;
  const allConfiguredTransportsAttempted = Object.values(transportCoverage).every((item) => item.configured_ids === 0 || item.attempted === item.configured_ids);
  const allAttemptedTestPrintsAccepted = testPrints.length > 0 && testPrints.every((item) => item.ok);
  return {
    core_checks_ok: coreChecksOk,
    requested_smoke_ok: requestedSmokeOk,
    bluetooth_health_ok: bluetoothHealthOk,
    all_configured_transports_attempted: allConfiguredTransportsAttempted,
    all_attempted_test_prints_accepted: allAttemptedTestPrintsAccepted,
    ready_to_close: coreChecksOk && requestedSmokeOk && bluetoothHealthOk && allConfiguredTransportsAttempted && allAttemptedTestPrintsAccepted,
    transport_coverage: transportCoverage,
    checks: byLabel
  };
}

const results = [];
results.push(await timedRequest("discover:all", "/api/backoffice/printers/discover?mode=all", { headers: headers() }));
results.push(await timedRequest("devices", "/api/backoffice/printers/devices", { headers: headers() }));

if (targetDevice || targetPrinter) {
  const params = new URLSearchParams();
  if (targetDevice) params.set("device", targetDevice);
  if (targetPrinter) params.set("printer", targetPrinter);
  results.push(await timedRequest("smoke-status", `/api/backoffice/printers/smoke-status?${params.toString()}`, { headers: headers() }));
}

if (bluetoothBridgeUrl) {
  results.push(await timedRequest("bluetooth:health", "/api/backoffice/printers/bluetooth/health", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ bridge_url: bluetoothBridgeUrl, timeout_ms: timeoutMs })
  }));
}

for (const [mode, ids] of Object.entries(printerIds)) {
  for (const id of ids) {
    results.push(await timedRequest(`test_print:${mode}:${id}`, "/api/backoffice/printers/test", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ printer_id: id })
    }));
  }
}

const report = {
  generated_at: new Date().toISOString(),
  base_url: baseUrl,
  timeout_ms: timeoutMs,
  target: { device: targetDevice || null, printer: targetPrinter || null },
  summary: summarizeChecks(results),
  results: results.map((item) => ({ ...item, body: item.body?.data ?? item.body ?? null }))
};

const outputPath = resolve(outFile);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`[printer-e2e] report written to ${outputPath}`);

if (!report.summary.ready_to_close) process.exitCode = 1;
