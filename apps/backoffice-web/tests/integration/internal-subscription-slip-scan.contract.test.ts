import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("internal subscription slip scan bridge", () => {
  const route = src("src/app/api/internal/subscription-slip-scan/route.ts");

  it("requires a derived internal bearer credential instead of exposing the service-role key", () => {
    expect(route).toContain("cpipos:internal-subscription-slip-scan:v1|");
    expect(route).toContain('get("authorization")');
    expect(route).toContain("timingSafeEqual");
    expect(route).not.toContain('authorization: "Bearer " + serviceRole');
  });

  it("only scans evidence within the tenant/request storage scope", () => {
    expect(route).toContain('expectedPrefix=tenantId+"/"+requestId+"/"');
    expect(route).toContain("storagePath.startsWith(expectedPrefix)");
    expect(route).toContain('BUCKET="subscription-payment-evidence"');
    expect(route).toContain("download(storagePath)");
    expect(route).toContain("evidence_path_mismatch");
  });

  it("derives expected amount and recipient from the canonical billing control plane", () => {
    expect(route).toContain('from("tenant_subscription_payment_requests")');
    expect(route).toContain('rpc("subscription_billing_due_state"');
    expect(route).toContain("billing_bank_account_name");
    expect(route).toContain("billing_bank_account_number");
    expect(route).toContain("billing_promptpay_id");
    expect(route).toContain("Caller amount does not match billing control plane.");
    expect(route).toContain("amount_match:amountMatch");
    expect(route).toContain("payee_match:payeeMatch");
    expect(route).toContain('verification.passed?"verified":"needs_review"');
  });

  it("rejects unsupported evidence types and oversized files", () => {
    expect(route).toContain("MAX_BYTES=4*1024*1024");
    expect(route).toContain("mimeFromBytes(bytes)");
    expect(route).toContain("invalid_slip_image");
    expect(route).toContain("invalid_slip_size");
  });
});
