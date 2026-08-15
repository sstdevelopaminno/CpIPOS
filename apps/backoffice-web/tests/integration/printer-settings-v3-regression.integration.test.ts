import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("printer settings v3 regression coverage", () => {
  it("uses the current v3 printer settings UI", () => {
    const moduleSource = source("src/components/backoffice/printers-module.tsx");
    expect(moduleSource).toContain("PrinterConnectionManagerV3");
    expect(moduleSource).not.toContain("PrinterConnectionManagerV2");
  });

  it("discovers every transport declared by a native print agent", () => {
    const discoverySource = source("src/app/api/backoffice/printers/discover/route.ts");
    expect(discoverySource).toContain("metadata.transports ?? metadata.supported_transports");
    expect(discoverySource).toContain('["lan", "usb", "bluetooth"]');
    expect(discoverySource).toContain("for (const agentMode of modes)");
    expect(discoverySource).toContain('id: `agent:${agent.id}:${agentMode}`');
  });

  it("keeps mixed cashier printers on receipt role before report or kitchen fallback", () => {
    const deviceRouteSource = source("src/app/api/backoffice/printers/devices/route.ts");
    const roleStart = deviceRouteSource.indexOf("function roleFor");
    const roleEnd = deviceRouteSource.indexOf("function connectionTypeFor", roleStart);
    const roleSource = deviceRouteSource.slice(roleStart, roleEnd);

    const receiptPriority = roleSource.indexOf('value === "receipt" || value === "cash_drawer"');
    const kitchenFallback = roleSource.indexOf('value === "kitchen" || value === "drink" || value === "bar"');
    const reportFallback = roleSource.indexOf('purposes.includes("shift_report")');

    expect(receiptPriority).toBeGreaterThanOrEqual(0);
    expect(kitchenFallback).toBeGreaterThan(receiptPriority);
    expect(reportFallback).toBeGreaterThan(kitchenFallback);
    expect(deviceRouteSource).not.toContain('bridge_url: mode === "lan" ? undefined : "browser-agent://web-serial"');
  });
  it("fans out kitchen-zone routes instead of reducing them to one default printer", () => {
    const routingSource = source("src/lib/printing/printer-routing-service.ts");
    const selectionStart = routingSource.indexOf("function selectAssignmentRows");
    const selectionEnd = routingSource.indexOf("export async function resolvePrinterRoutes", selectionStart);
    const selectionSource = routingSource.slice(selectionStart, selectionEnd);

    expect(selectionSource).toContain('const canFanOut = args.purpose === "kitchen" || args.purpose === "drink" || args.purpose === "bar";');
    expect(selectionSource).toContain("if (!canFanOut)");
    expect(selectionSource).toContain("} else if (!assignments.some((assignment) => assignment.is_default)) {");
    expect(routingSource.replace(/\r\n/g, "\n")).toContain("purpose,\n      runtimeDeviceCode: args.runtimeDeviceCode");
  });
});
