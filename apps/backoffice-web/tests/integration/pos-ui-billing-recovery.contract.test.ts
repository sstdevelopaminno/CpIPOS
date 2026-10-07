import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("POS UI and billing recovery contract", () => {
  const packagePage = src("src/app/preview/pos/payments/package/page.tsx");
  const rootPayments = src("src/app/preview/pos/payments/page.tsx");
  const center = src("src/components/pos-preview/pos-subscription-center.tsx");
  const service = src("src/lib/services/pos-subscription-center-service.ts");
  const guard = src("src/lib/pos-session-guard.ts");
  const entry = src("src/components/pos/pos-entry-gate.tsx");
  const supportPage = src("src/app/preview/pos/payments/support/page.tsx");
  const supportRoute = src("src/app/api/pos/subscription/support/route.ts");
  const scanner = src("src/app/api/internal/subscription-slip-scan/route.ts");

  it("keeps the modern subscription center as the package-payment UI", () => {
    expect(packagePage).toContain("PosSubscriptionCenter");
    expect(rootPayments).toContain("PosHelpCenter");
    expect(center).toContain("แพ็กเกจและการชำระเงิน");
    expect(center).toContain("สถานะรอบชำระปัจจุบัน");
  });

  it("reads canonical billing due state without falling back to historical settlements", () => {
    expect(service).toContain('rpc("subscription_billing_due_state"');
    expect(service).toContain("billing_due:");
    expect(center).toContain("ยอดที่ต้องชำระอ้างอิงจากรอบสิทธิ์ปัจจุบัน");
  });

  it("enforces runtime lock while preserving Support handoff", () => {
    expect(guard).toContain('from("tenant_subscription_runtime")');
    expect(guard).toContain("subscription_access_locked");
    expect(entry).toContain('sessionCode === "subscription_access_locked"');
    expect(entry).toContain("/api/pos/subscription/support");
    expect(entry).toContain("https://lin.ee/f1LXpAF");
    expect(supportPage).toContain("requirePosSessionForShiftClose");
    expect(supportRoute).toContain("tenant_subscription_support_requests");
  });

  it("keeps the internal slip scanner bound to the billing control plane", () => {
    expect(scanner).toContain('rpc("subscription_billing_due_state"');
    expect(scanner).toContain("Caller amount does not match billing control plane");
    expect(scanner).toContain("billing_bank_account_number");
    expect(scanner).toContain("timingSafeEqual");
  });
});
