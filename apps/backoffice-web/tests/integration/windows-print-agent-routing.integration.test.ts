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
    expect(route).toContain("HEARTBEAT_MAX_AGE_MS = 360_000");
    expect(route).toContain("PRINT_JOB_MAX_AGE_MS = 150_000");
    expect(route).toContain("windows_receipt_stale_manual_review_required");
    expect(route).toContain("windows_receipt_unsupported_payload");
    expect(route).toContain('metadata.payload_format === "receipt_html_v1"');
    expect(route).toContain('metadata.document_type !== "payment_notice"');
    expect(route).toContain('payloadJson.document_type !== "payment_notice"');
    expect(route).toContain("windows_receipt_text_too_long");
    expect(route).not.toContain("job.payload_text.slice(0, 14_000)");
    expect(route).toContain("order_id: orderId");
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

  it("fails closed when the local Windows attempt ledger has the wrong structure", () => {
    const worker = source("src/components/printing/windows-native-print-agent.tsx");
    expect(worker).toContain('Array.isArray(parsed)');
    expect(worker).toContain('Object.prototype.hasOwnProperty.call(ledger, jobId)');
    expect(worker).toContain('windows_attempt_ledger_corrupt');
  });

  it("never queues QR payment notices to the text-only Windows native agent", () => {
    const routed = source("src/lib/printing/routed-print-service.ts");
    expect(routed).toContain('purpose: "payment_slip"');
    expect(routed).toContain('metadata.target_runtime !== "windows_native"');
    expect(routed).toContain("physically accepted Windows QR/image renderer");
  });

  it("Android bootstrap does not select and rotate the Windows agent key", () => {
    const android = source("src/app/api/android-pos/print-agent/bootstrap/route.ts");
    expect(android).toContain('meta.runtime !== "windows_native_print_agent_v1"');
    expect(android).toContain('!candidate.agent_name.startsWith("Windows Native POS ·")');
  });
});
