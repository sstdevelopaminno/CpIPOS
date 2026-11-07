import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  getPosApiAuthContext: vi.fn(),
  requirePosApiFeature: vi.fn(),
  featureGateFail: vi.fn(),
  loadDeviceSettings: vi.fn(),
  saveDeviceSettings: vi.fn(),
  deleteDeviceSettings: vi.fn()
}));

vi.mock("@/lib/pos-api-auth", () => ({
  getPosApiAuthContext: mocks.getPosApiAuthContext
}));
vi.mock("@/lib/pos-api-feature-guard", () => ({
  requirePosApiFeature: mocks.requirePosApiFeature,
  featureGateFail: mocks.featureGateFail
}));
vi.mock("@/lib/services/pos-settings-service", () => ({
  loadDeviceSettings: mocks.loadDeviceSettings,
  saveDeviceSettings: mocks.saveDeviceSettings,
  deleteDeviceSettings: mocks.deleteDeviceSettings
}));

const device = {
  id: "device-1",
  branch_id: "branch-1",
  device_code: "POS-01",
  device_name: "Cashier 01",
  device_type: "pos_terminal",
  status: "active",
  is_locked: true,
  counter_name: "Front",
  location: "",
  last_seen_at: null
};

describe("POS cashier device list is readable independently of enrollment feature", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getPosApiAuthContext.mockResolvedValue({
      tenantId: "tenant-1",
      branchId: "branch-1",
      userId: "staff-1",
      branchRole: "manager"
    });
    mocks.requirePosApiFeature.mockResolvedValue(undefined);
    mocks.loadDeviceSettings.mockResolvedValue([device]);
    mocks.featureGateFail.mockReturnValue(null);
  });

  it("GET lists registered devices without requiring the optional enrollment add-on", async () => {
    const { GET } = await import("@/app/api/pos/settings/devices/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).data.devices).toEqual([device]);
    expect(mocks.getPosApiAuthContext).toHaveBeenCalledWith({
      requireBranchScope: true,
      requiredPermission: "settings:view"
    });
    expect(mocks.loadDeviceSettings).toHaveBeenCalledTimes(1);
    expect(mocks.requirePosApiFeature).not.toHaveBeenCalled();
  });

  it("GET never loads a device list if POS settings authorization fails", async () => {
    mocks.getPosApiAuthContext.mockRejectedValue(new Error("User is not authenticated."));
    const { GET } = await import("@/app/api/pos/settings/devices/route");
    const response = await GET();
    expect(response.ok).toBe(false);
    expect(mocks.loadDeviceSettings).not.toHaveBeenCalled();
  });

  it("POST still requires device enrollment, without creating devices when forbidden", async () => {
    mocks.requirePosApiFeature.mockRejectedValue(new Error("enrollment forbidden"));
    const { POST } = await import("@/app/api/pos/settings/devices/route");
    const response = await POST(new Request("http://localhost/api/pos/settings/devices", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch_id: "branch-1", device_code: "POS-02", device_name: "Cashier 02" })
    }));
    expect(response.ok).toBe(false);
    expect(mocks.requirePosApiFeature).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1" }),
      "mobile_device_enrollment"
    );
    expect(mocks.saveDeviceSettings).not.toHaveBeenCalled();
  });
});

describe("Cashier list user experience guards", () => {
  const uiSource = readFileSync(
    new URL("../../src/components/pos-preview/pos-settings-workspace.tsx", import.meta.url),
    "utf8"
  );

  it("makes failed device loads visible and retryable without pretending that no devices exist", () => {
    expect(uiSource).toContain("setLoadError(");
    expect(uiSource).toContain('role="alert"');
    expect(uiSource).toContain("setReloadRequest((current) => current + 1)");
    expect(uiSource).toContain("!isLoading && !loadError && filteredDevices.length === 0");
    expect(uiSource).toContain("12_000");
  });

  it("shows a total count for all branches instead of a misleading single-branch quota", () => {
    expect(uiSource).toContain('branchFilter === "all"');
    expect(uiSource).toContain('devices.length');
    expect(uiSource).toContain('activeDeviceCountForCreateBranch');
  });
});
