import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const src = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("routed shift report print stability", () => {
  it("routes close-shift printing through the POS device assignment instead of the Bluetooth-only endpoint", () => {
    const ui = src("apps/backoffice-web/src/components/pos/pos-shift-history-module.tsx");
    expect(ui).toContain('/api/pos/shifts/${closeReceipt.shift_id}/print');
    expect(ui).toContain('window.dispatchEvent(new Event("cpi-windows-print-agent-wake"))');
    const closeStart = ui.indexOf("async function printCloseReceipt()");
    const closeEnd = ui.indexOf("function printSelectedShiftDetail58", closeStart);
    const closeSource = ui.slice(closeStart, closeEnd);
    expect(closeSource).not.toContain("/api/pos/receipts/bluetooth");
  });

  it("binds shift report routing to the authenticated POS device code", () => {
    const route = src("apps/backoffice-web/src/app/api/pos/shifts/[shiftId]/print/route.ts");
    expect(route).toContain("requirePosSession()");
    expect(route).toContain('requirePermission(scope, "shift:join")');
    expect(route).toContain("runtimeDeviceCode: scope.session.device_code");
    expect(route).toContain("queueRoutedShiftReport");
    expect(route).toContain("idempotencyKey:");
  });

  it("keeps Android a text-print path while attaching HTML for Windows native printing", () => {
    const routed = src("apps/backoffice-web/src/lib/printing/routed-print-service.ts");
    expect(routed).toContain('purpose: "shift_report"');
    expect(routed).toContain('fallbackPurposes: ["receipt"]');
    expect(routed).toContain('printerRole: "report"');
    expect(routed).toContain('payload_format: "shift_report_html_v1"');
    expect(routed).toContain("payload_html: reportHtml");
  });

  it("allows the Windows in-session agent to claim approved report HTML without relaxing device assignment", () => {
    const windowsAgent = src("apps/backoffice-web/src/app/api/pos/windows-print/agent/route.ts");
    expect(windowsAgent).toContain("resolveWindowsAgentJob");
    expect(src("apps/backoffice-web/src/lib/printing/windows-print-job-policy.ts")).toContain('["receipt", "report", "kitchen"]');
    expect(windowsAgent).toContain('metadata.target_runtime === "windows_native"');
    expect(windowsAgent).toContain("windows_device_code");
    expect(windowsAgent).toContain("profiles.some(profile => profile.id === job.printer_id)");
    expect(windowsAgent).toContain("payload_html");
  });
});
