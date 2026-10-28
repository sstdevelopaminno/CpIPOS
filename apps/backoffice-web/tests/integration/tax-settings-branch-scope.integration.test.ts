import { beforeEach, describe, expect, it, vi } from "vitest";

const getPosApiAuthContext = vi.fn();
const loadTaxSettings = vi.fn();
const saveTaxSettings = vi.fn();
const requirePosApiFeature = vi.fn();

vi.mock("@/lib/pos-api-auth", () => ({ getPosApiAuthContext }));
vi.mock("@/lib/pos-api-feature-guard", () => ({
  requirePosApiFeature,
  featureGateFail: () => null
}));
vi.mock("@/lib/services/pos-settings-service", () => ({
  loadTaxSettings,
  saveTaxSettings
}));

const auth = {
  userId: "owner-1",
  platformRole: "tenant_user",
  tenantId: "tenant-1",
  branchId: "branch-1",
  branchRole: "owner"
};

const branchTaxSettings = {
  is_enabled: true,
  calculation_base: "net_after_discount",
  lines: [{ id: "vat-7", label: "VAT 7%", rate_pct: 7, mode: "add_to_bill", is_active: true }]
};

describe("tax settings branch scope API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPosApiAuthContext.mockResolvedValue(auth);
    requirePosApiFeature.mockResolvedValue(undefined);
  });

  it("loads tax settings for the owner-selected branch", async () => {
    loadTaxSettings.mockResolvedValue(branchTaxSettings);
    const { GET } = await import("@/app/api/pos/settings/tax/route");

    const response = await GET(new Request("http://localhost/api/pos/settings/tax?branch_id=branch-2"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(loadTaxSettings).toHaveBeenCalledWith(auth, "branch-2");
    expect(body.data.branch_id).toBe("branch-2");
    expect(body.data.tax_settings.is_enabled).toBe(true);
  });

  it("saves tax settings with the selected branch id", async () => {
    saveTaxSettings.mockResolvedValue({ ...branchTaxSettings, is_enabled: false });
    const { PATCH } = await import("@/app/api/pos/settings/tax/route");

    const response = await PATCH(
      new Request("http://localhost/api/pos/settings/tax", {
        method: "PATCH",
        body: JSON.stringify({ ...branchTaxSettings, branch_id: "branch-2", is_enabled: false })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(saveTaxSettings).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({ branch_id: "branch-2", is_enabled: false })
    );
    expect(body.data.branch_id).toBe("branch-2");
    expect(body.data.tax_settings.is_enabled).toBe(false);
  });
});
