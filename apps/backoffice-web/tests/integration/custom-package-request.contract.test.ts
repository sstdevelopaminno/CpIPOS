import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("POS CUSTOM package request flow", () => {
  const service = src("src/lib/services/pos-subscription-center-service.ts");
  const route = src("src/app/api/pos/billing/requests/route.ts");
  const ui = src("src/components/pos-preview/pos-subscription-center.tsx");
  const migration = src("../../supabase/migrations/20260928210000_custom_package_commercial_controls.sql");

  it("locks standard retention to six months and gives CUSTOM per-store retention", () => {
    expect(migration).toContain("new.retention_months := 6");
    expect(migration).toContain("tenant_custom_package_terms");
    expect(migration).toContain("when coalesce(sp.quota_mode,'standard') = 'custom'");
    expect(migration).toContain("else 6");
  });

  it("exposes discounted standard package prices and CUSTOM contact-sales state", () => {
    expect(service).toContain("discountedAmount");
    expect(service).toContain("monthly_discount_percent");
    expect(service).toContain("contact_sales: contactSales");
  });

  it("lets POS submit CUSTOM without payment evidence first", () => {
    expect(route).toContain('"custom_quote_request"');
    expect(route).toContain("CUSTOM must be requested first");
    expect(route).toContain('expected_amount: kind === "custom_quote_request"');
    expect(ui).toContain("ส่งคำขอ CUSTOM");
    expect(ui).toContain("ไม่ต้องกรอกราคา โควตา หรือข้อมูลชำระเงิน");
  });

  it("accepts payment only after IT converts CUSTOM to an agreed payment request", () => {
    expect(route).toContain('"it_custom_agreement"');
    expect(route).toContain("completingItPreparedPayment");
    expect(migration).toContain("custom_terms_snapshot");
    expect(migration).toContain("apply_custom_contract_limits");
  });
});
