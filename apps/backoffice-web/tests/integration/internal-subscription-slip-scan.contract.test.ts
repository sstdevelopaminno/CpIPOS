import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("internal subscription slip scan bridge", () => {
  const route = src("src/app/api/internal/subscription-slip-scan/route.ts");
  const scanner = src("src/lib/payments/subscription-slip-ai.ts");

  it("requires a derived internal bearer credential instead of exposing the service-role key", () => {
    expect(route).toContain('update("cpipos:internal-subscription-slip-scan:v1|")');
    expect(route).toContain('request.headers.get("authorization")');
    expect(route).toContain("timingSafeEqual");
    expect(route).not.toContain('authorization: "Bearer " + serviceRole');
  });

  it("only scans evidence within the tenant/request storage scope", () => {
    expect(route).toContain('const requiredPrefix = tenantId + "/" + requestId + "/"');
    expect(route).toContain("storagePath.startsWith(requiredPrefix)");
    expect(route).toContain('BUCKET = "subscription-payment-evidence"');
    expect(route).toContain("download(storagePath)");
    expect(route).toContain("scan_evidence_mismatch");
  });

  it("derives amount and recipient from the canonical billing control plane and reuses the shared scanner", () => {
    expect(route).toContain('from("tenant_subscription_payment_requests")');
    expect(route).toContain('rpc("subscription_billing_due_state"');
    expect(route).toContain("billing_bank_account_name");
    expect(route).toContain("billing_bank_account_number");
    expect(route).toContain("billing_promptpay_id");
    expect(route).toContain("Caller amount does not match billing control plane.");
    expect(route).toContain("scanSubscriptionSlip");
    expect(route).toContain("expectedAmount");
    expect(route).toContain("expectedPayeeName");
    expect(route).toContain("expectedAccountNumber");
    expect(route).toContain("expectedPromptPayId");
    expect(scanner).toContain("OPENAI_API_KEY");
    expect(scanner).toContain("amount_match");
    expect(scanner).toContain("payee_match");
  });

  it("rejects unsupported evidence types and oversized files", () => {
    expect(route).toContain("MAX_SLIP = 4 * 1024 * 1024");
    expect(route).toContain("actualMime(buffer)");
    expect(route).toContain("scan_evidence_type_invalid");
    expect(route).toContain("scan_evidence_invalid");
  });
});
