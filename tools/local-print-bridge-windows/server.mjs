import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";

const HOST = process.env.CPIPOS_PRINT_BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.CPIPOS_PRINT_BRIDGE_PORT || 3210);
const DEFAULT_PRINTER = process.env.CPIPOS_WINDOWS_PRINTER || "";
const APP_VERSION = "cpipos-local-print-bridge-windows-0.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-Cpipos-Bridge-Test",
  "Access-Control-Allow-Private-Network": "true",
  "Access-Control-Max-Age": "86400"
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    ...corsHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 3_000_000) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|hr)\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|tr|table|section|article|main|header|footer|li)>/gi, "\n")
    .replace(/<\/(td|th|dt|dd|span|strong)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\r\n");
}

function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function extractPrintableText(payload) {
  const body = readRecord(payload);
  const metadata = readRecord(body.metadata);
  const print = readRecord(body.print);
  const job = readRecord(body.job);
  const payloadJson = readRecord(body.payload_json);

  const directText = firstString(
    body.text,
    body.payload_text,
    body.receipt_text,
    body.content,
    print.text,
    print.payload_text,
    job.payload_text,
    metadata.payload_text,
    metadata.receipt_text,
    payloadJson.payload_text,
    payloadJson.receipt_text
  );
  if (directText) return directText.replace(/\n/g, "\r\n");

  const directHtml = firstString(
    body.html,
    body.payload_html,
    body.receipt_html,
    print.html,
    print.payload_html,
    job.payload_html,
    metadata.payload_html,
    metadata.receipt_html,
    payloadJson.payload_html,
    payloadJson.receipt_html
  );
  if (directHtml) return stripHtml(directHtml);

  const lines = [];
  const orderNo = firstString(body.order_no, body.orderNo, print.order_no, metadata.order_no);
  const title = firstString(body.title, body.store_name, metadata.store_name) || "CpIPOS";
  lines.push(title);
  if (orderNo) lines.push(`เลขที่บิล ${orderNo}`);
  lines.push("------------------------------");
  const items = Array.isArray(body.items) ? body.items : Array.isArray(print.items) ? print.items : [];
  for (const item of items) {
    const row = readRecord(item);
    const name = firstString(row.name, row.product_name, row.label) || "รายการ";
    const qty = row.qty ?? row.quantity ?? 1;
    const total = row.total ?? row.line_total ?? row.price ?? "";
    lines.push(`${name} x${qty}${total !== "" ? `  ${total}` : ""}`);
  }
  const total = body.total ?? body.total_amount ?? body.grand_total ?? print.total ?? "";
  if (total !== "") {
    lines.push("------------------------------");
    lines.push(`ยอดรวม ${total}`);
  }
  lines.push("\r\n\r\n");
  return lines.join("\r\n");
}

function psQuote(value) {
  return String(value || "").replace(/'/g, "''");
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `powershell_exit_${code}`));
    });
  });
}

async function listWindowsPrinters() {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$installed = [System.Drawing.Printing.PrinterSettings]::InstalledPrinters
$default = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
$items = @()
foreach ($printer in $installed) {
  $items += [PSCustomObject]@{
    name = [string]$printer
    is_default = ([string]$printer -eq [string]$default)
  }
}
$items | ConvertTo-Json -Depth 3
`;
  const { stdout } = await runPowerShell(script);
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function printTextViaWindows(text, printerName) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cpipos-print-"));
  const textPath = path.join(tempDir, "receipt.txt");
  await fs.writeFile(textPath, text, "utf8");

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$text = Get-Content -LiteralPath '${psQuote(textPath)}' -Raw -Encoding UTF8
$printerName = '${psQuote(printerName)}'
$font = New-Object System.Drawing.Font('Tahoma', 9)
$brush = [System.Drawing.Brushes]::Black
$doc = New-Object System.Drawing.Printing.PrintDocument
if ($printerName -ne '') { $doc.PrinterSettings.PrinterName = $printerName }
$doc.DocumentName = 'CpIPOS Receipt'
$doc.add_PrintPage({
  param($sender, $event)
  $rect = New-Object System.Drawing.RectangleF(2, 2, ($event.MarginBounds.Width), ($event.MarginBounds.Height))
  $event.Graphics.DrawString($text, $font, $brush, $rect)
  $event.HasMorePages = $false
})
$doc.Print()
"printed"
`;
  try {
    await runPowerShell(script);
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function getCapabilities() {
  return {
    ok: true,
    data: {
      app: "CpIPOS Local Print Bridge",
      app_version: APP_VERSION,
      host: HOST,
      port: PORT,
      default_printer: DEFAULT_PRINTER || "Windows default",
      default_adapter: "LOCAL_BRIDGE_WINDOWS",
      adapters: [
        {
          code: "LOCAL_BRIDGE_WINDOWS",
          label: "Windows Local Bridge",
          status: "supported",
          transport: "http://127.0.0.1:3210/print",
          printer_driver: "Windows PrintDocument",
          recommended_for: ["small_shop", "single_register", "windows_cashier"]
        },
        {
          code: "LAN_PRINTER_BRIDGE",
          label: "LAN / Network Printer Bridge",
          status: HOST === "0.0.0.0" ? "supported_by_current_host" : "available_when_host_is_lan_bound",
          transport: "http://<print-station-ip>:3210/print",
          recommended_for: ["local_lan", "tablet_to_print_station"]
        },
        {
          code: "ANDROID_PRINT_BRIDGE",
          label: "Android Print Bridge",
          status: "planned_external_adapter",
          recommended_for: ["android_tablet", "bluetooth_or_usb_otg_printer"]
        },
        {
          code: "AIRPRINT_OR_LAN_BRIDGE",
          label: "iPad / iOS AirPrint or LAN Bridge",
          status: "planned_external_adapter",
          recommended_for: ["ipad", "ios", "lan_or_airprint_printer"]
        },
        {
          code: "CLOUD_PRINT_QUEUE",
          label: "Cloud Queue + Store Print Station",
          status: "uses_existing_print_jobs_queue",
          recommended_for: ["multi_register", "multi_branch", "kitchen_printer"]
        },
        {
          code: "WEB_SERIAL_EXPERIMENTAL",
          label: "Chrome Web Serial",
          status: "experimental_not_default",
          recommended_for: ["lab_test_only"]
        }
      ]
    }
  };
}

async function handlePrint(req, res) {
  const raw = await collectBody(req);
  const payload = raw ? JSON.parse(raw) : {};
  const body = readRecord(payload);
  const printerName = firstString(body.printer_name, body.printerName, body.windows_printer, body.printer, DEFAULT_PRINTER);
  const text = extractPrintableText(body);
  if (!text.trim()) {
    sendJson(res, 400, { ok: false, error: { code: "empty_print_payload", message: "No printable text/html found." } });
    return;
  }
  await printTextViaWindows(text, printerName);
  sendJson(res, 200, {
    ok: true,
    data: {
      printed: true,
      provider: "windows_print_document",
      adapter: "LOCAL_BRIDGE_WINDOWS",
      printer_name: printerName || "default",
      bytes_received: Buffer.byteLength(raw, "utf8"),
      chars_printed: text.length,
      app_version: APP_VERSION
    }
  });
}

async function handleTestPrint(res) {
  const now = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  await printTextViaWindows(`CpIPOS Local Bridge Test\r\n${now}\r\n------------------------------\r\nLOCAL_BRIDGE_WINDOWS OK\r\n\r\n`, DEFAULT_PRINTER);
  sendJson(res, 200, { ok: true, data: { printed: true, adapter: "LOCAL_BRIDGE_WINDOWS", app_version: APP_VERSION } });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/print/health")) {
      sendJson(res, 200, {
        ok: true,
        data: {
          status: "online",
          app: "CpIPOS Local Print Bridge",
          app_version: APP_VERSION,
          adapter: "LOCAL_BRIDGE_WINDOWS",
          host: HOST,
          port: PORT,
          default_printer: DEFAULT_PRINTER || "Windows default"
        }
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/capabilities") {
      sendJson(res, 200, getCapabilities());
      return;
    }
    if (req.method === "GET" && url.pathname === "/printers") {
      sendJson(res, 200, { ok: true, data: { printers: await listWindowsPrinters(), app_version: APP_VERSION } });
      return;
    }
    if (req.method === "POST" && (url.pathname === "/print/test" || url.pathname === "/test")) {
      await handleTestPrint(res);
      return;
    }
    if (req.method === "POST" && (url.pathname === "/print" || url.pathname === "/api/print")) {
      await handlePrint(req, res);
      return;
    }
    sendJson(res, 404, { ok: false, error: { code: "not_found", message: "Use GET /health, GET /printers, GET /capabilities, POST /print/test, or POST /print." } });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: {
        code: "bridge_print_failed",
        message: error instanceof Error ? error.message : "Local print bridge failed."
      }
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[CpIPOS Print Bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[CpIPOS Print Bridge] health: http://${HOST}:${PORT}/health`);
  console.log(`[CpIPOS Print Bridge] capabilities: http://${HOST}:${PORT}/capabilities`);
  console.log(`[CpIPOS Print Bridge] printers: http://${HOST}:${PORT}/printers`);
  console.log(`[CpIPOS Print Bridge] printer: ${DEFAULT_PRINTER || "Windows default printer"}`);
});
