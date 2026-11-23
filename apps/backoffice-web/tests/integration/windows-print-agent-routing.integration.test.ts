import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { agentRuntimeMatchesPrinter } from "@/lib/printing/agent-runtime-routing";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Windows print agent device and receipt safety", () => {
  it("never lets an Android agent claim an explicitly Windows-native XP-80C", () => {
    expect(agentRuntimeMatchesPrinter("windows_native", "android_native_print_agent_v2")).toBe(false);
    expect(agentRuntimeMatchesPrinter("windows_native", undefined)).toBe(false);
    expect(agentRuntimeMatchesPrinter("windows_native", "windows_native_print_agent_v1")).toBe(true);
  });

  it("never lets Windows agent claim Android or unassigned printer jobs", () => {
    expect(agentRuntimeMatchesPrinter(undefined, "windows_native_print_agent_v1")).toBe(false);
    expect(agentRuntimeMatchesPrinter("android_native", "windows_native_print_agent_v1")).toBe(false);
    expect(agentRuntimeMatchesPrinter(undefined, "android_native_print_agent_v2")).toBe(true);
    expect(agentRuntimeMatchesPrinter(undefined, undefined)).toBe(true);
  });

  it("both claim paths enforce runtime segregation before leasing", () => {
    const claim = source("src/lib/printing/print-agent-claim-stabilized.ts");
    const legacyClaim = source("src/lib/printing/print-agent-service.ts");
    expect(claim).toContain("agentRuntimeMatchesPrinter(metadata.target_runtime, agentMetadata.runtime)");
    expect(legacyClaim).toContain("agentRuntimeMatchesPrinter(metadata.target_runtime, agentMetadata.runtime)");
  });

  it("server refuses stale or non-HTML jobs and never replays old failures", () => {
    const route = source("src/app/api/pos/windows-print/agent/route.ts");
    expect(route).toContain("HEARTBEAT_MAX_AGE_MS = 180_000");
    expect(route).toContain("PRINT_JOB_MAX_AGE_MS = 150_000");
    expect(route).toContain("windows_receipt_stale_manual_review_required");
    expect(route).toContain("windows_receipt_unsupported_payload");
    expect(route).toContain("retryable: false");
    expect(route).toContain('origin !== new URL(req.url).origin');
    expect(route).toContain('scope.permissions.includes("receipts:view")');
  });

  it("client writes a persistent attempt ledger before the native spool and never auto-retries", () => {
    const worker = source("src/components/printing/windows-native-print-agent.tsx");
    expect(worker.indexOf("markAttempted(job.id)")).toBeLessThan(worker.indexOf("printWindowsReceiptHtml(job.html"));
    expect(worker).toContain('action: "ack"');
    expect(worker).toContain('action: "fail"');
    expect(worker).toContain('windows_duplicate_prevented');
    expect(worker).not.toContain("localStorage.setItem(\"cpi_browser_print_agent_key");
    const host = source("src/components/printing/browser-print-agent-pos-host.tsx");
    expect(host).toContain("<WindowsNativePrintAgent />");
  });

  it("uses tenant-scoped Windows printer profile to choose native text rendering", () => {
    const route = source("src/app/api/pos/windows-print/agent/route.ts");
    const worker = source("src/components/printing/windows-native-print-agent.tsx");
    expect(route).toContain("const assignedProfile = profiles.find(profile => profile.id === job.printer_id)");
    expect(route).toContain('asRecord(assignedProfile?.metadata).windows_print_render_mode === "native_text"');
    expect(route).toContain('render_mode: resolved.kind === "html"');
    expect(worker).toContain('renderMode: job.render_mode === "native_text" ? "native_text" : "html"');
  });

  it("never queues recycling reports with a role mismatched to the selected printer", () => {
    const report = source("src/lib/printing/recycling-report-print-service.ts");
    expect(report).toContain("printerRole:route.printer.printer_role");
    expect(report).not.toContain('printerRole:"report"');
  });

  it("wakes only explicitly scoped Recycling Windows profiles after sale commit or reprint", () => {
    const service = source("src/lib/printing/recycling-receipt-print-service.ts");
    const loader = source("src/components/pos/recycling-sales-content.tsx");
    const checkout = source("src/components/pos/recycling-pos-workspace.tsx");
    const manual = source("src/components/pos/recycling-print-receipt-button.tsx");
    const agent = source("src/components/printing/windows-native-print-agent.tsx");
    expect(service).toContain('meta.target_runtime === "windows_native"');
    expect(service).toContain('meta.windows_receipt_fast_wake === true');
    expect(service).toContain('meta.windows_device_code === args.runtimeDeviceCode');
    expect(service).toContain("fast_wake:fastWindowsWake");
    expect(loader).toContain('meta.windows_receipt_fast_wake === true');
    expect(loader).toContain('meta.windows_device_code === deviceCode');
    expect(checkout).toContain('if (fastWindowsReceiptEnabled)');
    expect(checkout).toContain('jobs.some(job=>job.fast_wake===true)');
    expect(checkout.indexOf('const committedId = body.data.transaction.id'))
      .toBeLessThan(checkout.indexOf('await queueReceiptPrint(committedId, currentRequestId)'));
    expect(manual).toContain('jobs.some(job=>job.fast_wake===true');
    expect(agent).toContain('const urgent = event?.type === "cpi-windows-print-agent-wake"');
    expect(agent).toContain("if (urgent) urgentWakePending = true");
    expect(agent).toContain("const waitMs = urgentWakePending ? 0 : nextMs");
    expect(agent).toContain('markAttempted(job.id)');
  });

  it("keeps the full HTML receipt renderer available for preview parity", () => {
    const agentRoute = source("src/app/api/pos/windows-print/agent/route.ts");
    const native = source("src/lib/printing/windows-local-printer-test.ts");
    const receipt = source("src/lib/printing/recycling-receipt-print-service.ts");
    expect(receipt).toContain("renderRecyclingSharedReceipt({");
    expect(receipt).toContain("payload_html:html");
    expect(agentRoute).toContain('windows_print_render_mode === "native_text"');
    expect(agentRoute).toContain('? "native_text" : "html"');
    expect(native).toContain('...(nativeText ? {} : { html: printableHtml })');
    expect(native).toContain("native_webview2_html_receipt");
    expect(native).toContain("native_dotnet_print_document");
  });

  it("scopes fast-print wake for adjustable barcode labels and reports to the same Windows device", () => {
    const barcodeApi = source("src/app/api/pos/recycling/barcodes/print/route.ts");
    const barcodeJob = source("src/lib/printing/recycling-barcode-print-service.ts");
    const barcodeUi = source("src/components/pos/recycling-barcode-dialog.tsx");
    const reportJob = source("src/lib/printing/recycling-report-print-service.ts");
    const reportUi = source("src/components/pos/recycling-summary-print-button.tsx");
    expect(barcodeApi).toContain("RECYCLING_BARCODE_LABEL_SIZES.includes");
    expect(barcodeApi).toContain("branch_id!==branchId");
    expect(barcodeJob).toContain('meta.windows_device_code===args.runtimeDeviceCode');
    expect(barcodeJob).toContain("fast_wake:fastWake");
    expect(barcodeJob).toContain("size:args.size,centerOnPaper");
    expect(barcodeUi).toContain('size:labelSize');
    expect(barcodeUi).toContain('<option value="large">');
    expect(barcodeUi).toContain('jobs.some(job=>job.fast_wake===true');
    expect(reportJob).toContain("meta.windows_device_code===args.deviceCode");
    expect(reportJob).toContain("fast_wake:fastWake");
    expect(reportUi).toContain('jobs.some(j=>j.fast_wake===true');
    // All these wake the already-authenticated local Windows agent;
    // no Android agent key or cross-tenant print queue is exposed.
    expect(barcodeUi).toContain('new Event("cpi-windows-print-agent-wake")');
    expect(reportUi).toContain('new Event("cpi-windows-print-agent-wake")');
  });

  it("Android bootstrap does not select and rotate the Windows agent key", () => {
    const android = source("src/app/api/android-pos/print-agent/bootstrap/route.ts");
    expect(android).toContain('meta.runtime !== "windows_native_print_agent_v1"');
    expect(android).toContain('!candidate.agent_name.startsWith("Windows Native POS ·")');
  });
});
