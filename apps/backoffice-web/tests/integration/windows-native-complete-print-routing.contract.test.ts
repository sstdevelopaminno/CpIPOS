import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveWindowsAgentJob } from "../../src/lib/printing/windows-print-job-policy";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Windows local POS printing: sale, reprint, kitchen, shift, notices and drawer", () => {
  it("keeps XP-80C 80mm HTML totals inside a conservative 64mm printable width", () => {
    const bridge = read("../windows-runtime-native/Cpipos.WindowsRuntime/LocalPrintBridge.cs");
    const canonical = read("src/lib/printing/receipt-html-template.ts");
    const sale = read("src/components/pos/pos-sales-module.tsx");
    const history = read("src/components/pos-preview/pos-receipts-workspace.tsx");

    expect(canonical).toContain("printableMm: 64");
    expect(canonical).toContain("printableMm: 45");
    for (const source of [sale, history]) {
      expect(source).toContain("paperWidthMm === 80 ? 64 : 45");
      expect(source).toContain("paperWidthMm === 80 ? 2 : 1");
      expect(source).toContain("overflow-wrap: anywhere");
      expect(source).toContain("table-layout: fixed");
      expect(source).not.toContain("width: 16mm; text-align: right; white-space: nowrap");
    }
    expect(bridge).toContain("CoreWebView2PrintMediaSize.Custom");
    expect(bridge).toContain("printerSettings.PageWidth = paperWidthMm / 25.4");
    expect(bridge).toContain("printerSettings.PageHeight = sheetHeightMm / 25.4");
    expect(bridge).toContain("printerSettings.ScaleFactor = 1.0");
    expect(bridge).toContain("contentHeightPx * 25.4 / 96.0");
  });


  it("accepts an offscreen Thai HTML receipt after DOM readiness instead of checking innerText on a Promise", () => {
    const bridge = read("../windows-runtime-native/Cpipos.WindowsRuntime/LocalPrintBridge.cs");
    expect(bridge).toContain("body.textContent");
    expect(bridge).toContain("WebMessageReceived += onRenderMessage");
    expect(bridge).toContain("WebMessageReceived -= onRenderMessage");
    expect(bridge).toContain("renderReady.Task.WaitAsync");
    expect(bridge).toContain('notify("ready")');
    expect(bridge).toContain("CoreWebView2.PrintAsync(printerSettings)");
    expect(bridge).not.toContain('if (rendered != "true")');
    expect(bridge).not.toContain("document.body.innerText.trim()");
    expect(bridge).not.toContain("browser.Print();");
  });

  const html = "<html><body><h1>ร้านค้า</h1></body></html>";
  const base = { printerRole: "receipt", printerAssigned: true, metadata: {}, html };

  it("accepts authorized HTML receipt, shift, payment notice, QR and kitchen tickets", () => {
    expect(resolveWindowsAgentJob({ ...base, metadata: { request_source: "pos_payment", payload_format: "receipt_html_v1" } }))
      .toEqual({ kind: "html", saleReceipt: true });
    expect(resolveWindowsAgentJob({ ...base, metadata: { request_source: "pos_payment_notice" } }))
      .toEqual({ kind: "html", saleReceipt: false });
    expect(resolveWindowsAgentJob({ ...base, printerRole: "report" }))
      .toEqual({ kind: "html", saleReceipt: false });
    expect(resolveWindowsAgentJob({ ...base, printerRole: "kitchen" }))
      .toEqual({ kind: "html", saleReceipt: false });
  });

  it("never lets non-receipt documents consume the sale receipt duplicate ledger", () => {
    const worker = read("src/components/printing/windows-native-print-agent.tsx");
    expect(worker).toContain("job.sale_receipt === true ? job.order_no : null");
    expect(worker.indexOf("markAttempted(job.id)")).toBeLessThan(worker.indexOf("printWindowsReceiptHtml(job.html"));
    expect(worker).toContain("cpi-windows-print-agent-result");
  });

  it("accepts only strictly validated, authorized printer-kick commands", () => {
    const command = {
      command: "open_cash_drawer", request_source: "cash_drawer_controller",
      quarantine_replay_allowed: false, drawer_connection_mode: "printer-kick",
      drawer_kick_pin: 0, drawer_pulse_on_ms: 80, drawer_pulse_off_ms: 250
    };
    expect(resolveWindowsAgentJob({ ...base, html: "", metadata: command }))
      .toEqual({ kind: "cash_drawer", drawer: { kickPin: 0, pulseOnMs: 80, pulseOffMs: 250 } });
    expect(resolveWindowsAgentJob({ ...base, html: "", metadata: { ...command, quarantine_replay_allowed: true } })).toBeNull();
    expect(resolveWindowsAgentJob({ ...base, html: "", metadata: { ...command, drawer_pulse_on_ms: 9999 } })).toBeNull();
    expect(resolveWindowsAgentJob({ ...base, html: "", metadata: { ...command, command: "other" } })).toBeNull();
    expect(resolveWindowsAgentJob({ ...base, html: "", metadata: command, printerAssigned: false })).toBeNull();
    expect(resolveWindowsAgentJob({ ...base, html: "", metadata: command, printerRole: "kitchen" })).toBeNull();
    expect(resolveWindowsAgentJob({ ...base, html: "", metadata: command, printerRole: "receipt" })).not.toBeNull();
    expect(resolveWindowsAgentJob({ ...base, html: "", metadata: { ...command, drawer_connection_mode: "vendor-sdk" } })).toBeNull();
  });

  it("rejects unsigned/unassigned, non-HTML or malformed requests", () => {
    expect(resolveWindowsAgentJob({ ...base, printerAssigned: false })).toBeNull();
    expect(resolveWindowsAgentJob({ ...base, html: "plain text" })).toBeNull();
    expect(resolveWindowsAgentJob({ ...base, metadata: { command: "open_cash_drawer" } })).toBeNull();
    expect(resolveWindowsAgentJob({ ...base, printerRole: "unknown" })).toBeNull();
    expect(resolveWindowsAgentJob({ ...base, html: "<html>" + "X".repeat(250_001) })).toBeNull();
  });

  it("keeps Windows agent active after every secure claim and does not rely on stale registry data for drawers", () => {
    const route = read("src/app/api/pos/windows-print/agent/route.ts");
    const drawer = read("src/lib/printing/cash-drawer-controller-service.ts");
    expect(route).toContain('action === "claim"');
    expect(route).toContain('last_seen_at: new Date().toISOString()');
    expect(route).toContain("resolveWindowsAgentJob");
    expect(route).toContain("cash_drawer_events");
    expect(drawer).toContain('metadata.target_runtime === "windows_native"');
    expect(drawer).toContain('from("pos_device_health_latest")');
    expect(drawer).toContain("peripherals.selected_printer_valid === true");
    expect(route).toContain("PRINT_JOB_MAX_AGE_MS = 150_000");
  });

  it("does not force manual print after successful cash payment, and retains no-blind-retry protection", () => {
    const modal = read("src/components/pos/pos-payment-modals.tsx");
    const sale = read("src/components/pos/pos-sales-module.tsx");
    const worker = read("src/components/printing/windows-native-print-agent.tsx");
    expect(modal).toContain("ระบบกำลังส่งพิมพ์ Windows อัตโนมัติ");
    expect(sale).toContain('new Event("cpi-windows-print-agent-wake")');
    expect(sale).toContain('cpi-windows-print-agent-result');
    expect(worker).toContain("priorityPollUntil = Date.now() + 16_000");
    expect(worker).toContain("windows_duplicate_prevented");
    expect(worker).toContain("openWindowsCashDrawerJob(job.drawer)");
  });

  it("uses IE-compatible receipt layouts for the installed WinForms HTML renderer", () => {
    const canonical = read("src/lib/printing/receipt-html-template.ts");
    const sale = read("src/components/pos/pos-sales-module.tsx");
    const history = read("src/components/pos-preview/pos-receipts-workspace.tsx");
    const local = read("src/lib/printing/windows-local-printer-test.ts");
    for (const src of [canonical, sale, history]) {
      expect(src).toContain("display: table");
      expect(src).toContain("display: table-cell");
    }
    expect(canonical).toContain("input.storeName");
    expect(local).toContain('printableHtml');
    expect(local).toContain('appOrigin');
    expect(local).toContain("window.location.origin");
  });
});
