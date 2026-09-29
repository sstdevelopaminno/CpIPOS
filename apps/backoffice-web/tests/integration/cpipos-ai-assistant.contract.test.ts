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

  it("keeps the assistant read-only in the first release", () => {
    expect(aiApi).toContain("ระบบเวอร์ชันนี้เป็น read-only");
    expect(aiApi).toContain('mode: "read_only"');
    expect(aiWorkspace).toContain("ยังไม่แก้ไขราคา สต๊อก บิล หรือข้อมูลบัญชีโดยอัตโนมัติ");
    expect(featureMap).toContain('"/preview/pos/ai-assistant": "core_pos_sales"');
  });
});
