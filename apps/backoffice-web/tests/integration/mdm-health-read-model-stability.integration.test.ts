import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const heartbeatRoute = source("../../src/app/api/pos/device-heartbeat/route.ts");
const supportCenterService = source("../../src/lib/services/it-admin/support-center-service.ts");
const mdmPrinterDevicesRoute = source("../../src/app/api/backoffice/printers/mdm-devices/route.ts");

describe("MDM health read model stability", () => {
  it("keeps POS heartbeat device identity authoritative to the server session", () => {
    expect(heartbeatRoute).toContain('const reportedDeviceCode = sanitizeText(bodyIdentity.device_code);');
    expect(heartbeatRoute).toContain('const sessionDeviceCode = sanitizeText(scope.session.device_code, "POS-DEVICE");');
    expect(heartbeatRoute).toContain("const deviceCode = sessionDeviceCode;");
    expect(heartbeatRoute).toContain('authoritative_device_code_source: "pos_session"');
    expect(heartbeatRoute).not.toContain('const deviceCode = sanitizeText(bodyIdentity.device_code, scope.session.device_code ?? "POS-DEVICE");');
  });

  it("bounds IT Support Center health reads to registered devices", () => {
    const deviceIdsIndex = supportCenterService.indexOf("const registeredDeviceIds = registeredDevices.map((device) => String(device.id)).filter(Boolean);");
    const healthQueryIndex = supportCenterService.indexOf('.from("pos_device_health_latest")');

    expect(deviceIdsIndex).toBeGreaterThan(0);
    expect(healthQueryIndex).toBeGreaterThan(deviceIdsIndex);
    expect(supportCenterService).toContain('.in("pos_device_id", registeredDeviceIds)');
    expect(supportCenterService).toContain("Math.min(500, Math.max(registeredDeviceIds.length * 6, 50))");
    expect(supportCenterService).not.toContain(".limit(500)\n  ]);");
  });

  it("bounds printer MDM device health reads to active branch device ids", () => {
    const deviceIdsIndex = mdmPrinterDevicesRoute.indexOf("const deviceIds = (devices ?? []).map((device) => device.id).filter(Boolean);");
    const healthQueryIndex = mdmPrinterDevicesRoute.indexOf('.from("pos_device_health_latest")');

    expect(deviceIdsIndex).toBeGreaterThan(0);
    expect(healthQueryIndex).toBeGreaterThan(deviceIdsIndex);
    expect(mdmPrinterDevicesRoute).toContain('.in("pos_device_id", deviceIds)');
    expect(mdmPrinterDevicesRoute).toContain("Math.min(500, Math.max(deviceIds.length * 6, 50))");
  });
});