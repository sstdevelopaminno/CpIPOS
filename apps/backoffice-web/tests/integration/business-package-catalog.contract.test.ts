import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("canonical Business package catalog", () => {
  const migration = src("../../supabase/migrations/20260930090000_business_package_catalog.sql");
  const catalog = src("src/lib/subscription-catalog.ts");
  const service = src("src/lib/services/pos-subscription-center-service.ts");
  const ui = src("src/components/pos-preview/pos-subscription-center.tsx");
  const features = src("src/app/api/pos/features/route.ts");
  const featureMap = src("src/lib/pos-feature-map.ts");
  const shared = src("../../packages/shared-types/src/index.ts");

  it("defines only Starter, Growth, Business and CUSTOM as canonical commercial tiers", () => {
    expect(migration).toContain("Starter -> Growth -> Business -> CUSTOM");
    expect(migration).toContain("monthly_price = 1500");
    expect(migration).toContain("yearly_price = 16200");
    expect(migration).toContain("max_branches = 2");
    expect(migration).toContain("max_devices = 4");
    expect(migration).toContain("max_users = 20");
    expect(migration).toContain("max_products = 5000");
    expect(migration).toContain("monthly_bill_limit = 10000");
    expect(migration).toContain("retention_months = 24");
    expect(migration).toContain("where code not in ('starter','growth','business','custom')");
    expect(catalog).toContain('code: "business"');
    expect(catalog).toContain('name: "Business"');
    expect(catalog).not.toContain('code: "enterprise"');
    expect(catalog).not.toContain('code: "solo"');
  });

  it("includes Business AI and keeps Growth AI as a tenant add-on", () => {
    expect(shared).toContain('| "cpipos_ai"');
    expect(catalog).toContain('code: "cpipos_ai"');
    expect(featureMap).toContain('"/preview/pos/ai-assistant": "cpipos_ai"');
    expect(catalog).toContain("ai_addon_monthly_price: 299");
    expect(catalog).toContain("ai_addon_monthly_requests: 500");
    expect(catalog).toContain("ai_monthly_requests: 2000");
    expect(migration).toContain("when 'business' then 2000");
    expect(migration).toContain("where tdl.lifecycle_status = 'sales_demo'");
  });

  it("exposes package limits to the POS comparison table and supports upgrades", () => {
    expect(service).toContain("max_products");
    expect(service).toContain("monthly_bill_limit");
    expect(service).toContain("retention_months");
    expect(service).toContain("ai_addon_available");
    expect(ui).toContain("เลือก / อัปเกรดแพ็กเกจ");
    expect(ui).toContain("แนะนำสำหรับธุรกิจ");
    expect(ui).toContain("บิล / เดือน");
    expect(ui).toContain("CpiPOS AI");
    expect(ui).toContain("Growth สามารถขอเปิด CpiPOS AI Add-on");
    expect(ui).toContain("choosePackage(row)");
  });

  it("enforces package sales-mode ceilings and package-specific retention", () => {
    expect(features).toContain("salesModePolicy");
    expect(features).toContain("sales_mode_limit");
    expect(features).toContain("default_sales_modes");
    expect(migration).toContain("Starter 6, Growth 12, Business 24");
    expect(migration).toContain("else coalesce(sp.retention_months,6)");
  });
});
