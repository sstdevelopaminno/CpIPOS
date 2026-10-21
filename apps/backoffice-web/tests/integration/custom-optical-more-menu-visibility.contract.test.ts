import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const load = (name: string) => readFileSync(resolve(process.cwd(), "src", name), "utf8");
const more = load("components/pos-preview/pos-more-workspace.tsx");
const featureGate = load("lib/feature-gate.ts");
const featureApi = load("app/api/pos/features/route.ts");

describe("CUSTOM Optical additional menu visibility", () => {
  it("renders IT-enabled child cards even if their package feature is locked", () => {
    expect(more).toContain('if (isCustom && !isCustomPosMenuVisible(');
    expect(more).not.toContain('|| isLocked(item.href))) return null');
    expect(more).toContain('const locked = menuLocked || isLocked(item.href)');
    expect(more).toContain('IT เปิดเมนูแล้ว · ยังไม่มีสิทธิ์ฟีเจอร์ในแพ็กเกจ');
  });
  it("fails closed with a clear retry if menu policy cannot load", () => {
    expect(more).toContain('setPolicyReady(false); // Fail closed');
    expect(more).toContain('setPolicyError(');
    expect(more).toContain('setRefreshCounter(n => n + 1)');
  });
  it("lets IT enable optical stock only for authorized CUSTOM Optical with no explicit override", () => {
    expect(featureGate).toContain('featureCode === "stock_management" ? "more.stock"');
    expect(featureGate).toContain('!tenantOverride && !branchOverride && opticalManagementMenu');
    expect(featureGate).toContain('isOpticalRetailExplicitlyEnabled(contract?.metadata?.sales_modes)');
    expect(featureGate).toContain('command.data?.is_enabled === true');
    expect(featureGate).toContain('toLowerCase() === "custom"');
    expect(featureApi).toContain('["stock_management", "more.stock"]');
    expect(featureApi).toContain('!tenantOverrides.has(feature) && !branchOverrides.has(feature)');
  });
  it("does not grant unpurchased advanced reporting or receipt reprinting", () => {
    expect(featureGate).not.toContain('featureCode === "advanced_sales_reports" ? "more.sales_summary"');
    expect(featureGate).not.toContain('featureCode === "receipt_reprint_history" ? "more.receipts"');
    expect(featureApi).not.toContain('["advanced_sales_reports", "more.sales_summary"]');
    expect(featureApi).not.toContain('["receipt_reprint_history", "more.receipts"]');
  });
});
