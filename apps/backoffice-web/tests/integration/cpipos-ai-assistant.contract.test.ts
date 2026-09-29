import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const staffMenu = source("../../src/components/pos-preview/pos-staff-menu.tsx");
const moreWorkspace = source("../../src/components/pos-preview/pos-more-workspace.tsx");
const aiPage = source("../../src/app/preview/pos/ai-assistant/page.tsx");
const aiWorkspace = source("../../src/components/pos-preview/cpipos-ai-assistant.tsx");
const aiApi = source("../../src/app/api/pos/ai/assistant/route.ts");
const menuPolicy = source("../../src/lib/pos-menu-policy.ts");
const featureMap = source("../../src/lib/pos-feature-map.ts");
const aiActions = source("../../src/app/api/pos/ai/actions/route.ts");
const policyService = source("../../src/lib/server/pos-menu-policy-service.ts");
const sharedTypes = source("../../../../packages/shared-types/src/index.ts");

describe("CpiPOS AI store assistant", () => {
  it("registers the AI assistant under More and keeps the sidebar compact", () => {
    expect(menuPolicy).toContain('key: "more.ai_assistant"');
    expect(menuPolicy).toContain('route: "/preview/pos/ai-assistant"');
    expect(moreWorkspace).toContain("CpiPOS AI ผู้ช่วยร้านค้า");
    expect(moreWorkspace).toContain('featured: true');
    expect(staffMenu).toContain("moreExpanded");
    expect(staffMenu).toContain("เมนูเพิ่มเติมทั้งหมด");
    expect(staffMenu).toContain("max-h-[104px]");
    expect(staffMenu).toContain('href="/preview/pos/ai-assistant"');
  });

  it("limits the first AI release to owner and manager roles", () => {
    expect(aiPage).toContain('scope.session.role !== "owner" && scope.session.role !== "manager"');
    expect(aiApi).toContain('branchRole === "owner" || branchRole === "manager"');
  });

  it("uses server-side OpenAI calls with storage disabled", () => {
    expect(aiApi).toContain('readEnv("OPENAI_API_KEY")');
    expect(aiApi).toContain('fetch("https://api.openai.com/v1/responses"');
    expect(aiApi).toContain("store: false");
    expect(aiApi).toContain("CPIPOS_AI_MODEL");
    expect(aiWorkspace).not.toContain("OPENAI_API_KEY");
  });

  it("loads real POS sales, stock, and cost context before answering", () => {
    expect(aiApi).toContain("loadPosSalesSummaryData");
    expect(aiApi).toContain('.from("ingredients")');
    expect(aiApi).toContain('.from("recipes")');
    expect(aiApi).toContain("low_margin_products");
    expect(aiApi).toContain("low_stock");
  });

  it("upgrades Phase 2 to proposal -> confirm -> PIN -> execute", () => {
    expect(aiApi).toContain("propose_product_price_update");
    expect(aiApi).toContain("propose_stock_adjustment");
    expect(aiApi).toContain("propose_marketing_campaign");
    expect(aiApi).toContain('mode: "confirm_then_pin"');
    expect(aiWorkspace).toContain("PosManagerApprovalModal");
    expect(aiWorkspace).toContain("sales_record_edit");
    expect(aiWorkspace).toContain('fetch("/api/pos/ai/actions"');
    expect(aiActions).toContain('action: "update_product_price"');
    expect(aiActions).toContain('action: "adjust_stock"');
    expect(aiActions).toContain("appendAuditLog");
    expect(sharedTypes).toContain('"sales_record_edit"');
    expect(featureMap).toContain('"/preview/pos/ai-assistant": "core_pos_sales"');
  });

  it("enforces the per-tenant IT AI policy on the page and APIs", () => {
    expect(policyService).toContain("isTenantPosMenuEnabled");
    expect(aiPage).toContain('isTenantPosMenuEnabled(scope.session.tenant_id, "more.ai_assistant")');
    expect(aiApi).toContain('isTenantPosMenuEnabled(tenantId, "more.ai_assistant")');
    expect(aiActions).toContain('isTenantPosMenuEnabled(tenantId, "more.ai_assistant")');
    expect(aiApi).toContain("ai_assistant_disabled_by_it");
    expect(aiActions).toContain("ai_assistant_disabled_by_it");
  });

  it("keeps destructive or financial reversal actions outside Phase 2", () => {
    expect(aiApi).toContain("ห้ามเสนอหรือดำเนินการยกเลิกบิล คืนเงิน");
    expect(aiActions).not.toContain('"cancel_bill"');
    expect(aiActions).not.toContain('"refund"');
  });
});
