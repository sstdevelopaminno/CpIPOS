import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const service = source("../../src/lib/services/public-package-checkout-service.ts");
const route = source("../../src/app/api/public/subscription-checkout/route.ts");
const submit = source("../../src/app/api/public/subscription-checkout/submit/route.ts");

describe("public company website package checkout", () => {
  it("requires store code plus owner/manager PIN without creating a POS session", () => {
    expect(route).toContain("store_or_pin_invalid");
    expect(service).toContain('in("role", ["owner", "manager"])');
    expect(service).toContain("bcrypt.compare");
    expect(service).toContain("resolveTenantByStoreCode");
    expect(service).not.toContain("requirePosSession");
  });

  it("uses short-lived signed checkout tokens and rate limits verification", () => {
    expect(service).toContain("TOKEN_TTL_SECONDS = 15 * 60");
    expect(service).toContain('createHmac("sha256"');
    expect(route).toContain("public_package_checkout_verify");
    expect(route).toContain("failClosedOnBackendError: true");
  });

  it("submits the slip into the existing IT subscription approval tables", () => {
    expect(service).toContain('from("tenant_subscription_payment_requests")');
    expect(service).toContain("SUBSCRIPTION_SLIP_BUCKET");
    expect(service).toContain("scanSubscriptionSlip");
    expect(service).toContain('source: "company_website_package_checkout"');
    expect(service).toContain('audience: "it"');
    expect(submit).toContain("submitPublicPackageCheckout");
  });

  it("does not allow CUSTOM or unpriced annual checkout directly", () => {
    expect(service).toContain("target.contact_sales");
    expect(service).toContain('target.code === "custom"');
    expect(service).toContain("yearly_unavailable");
  });
});
