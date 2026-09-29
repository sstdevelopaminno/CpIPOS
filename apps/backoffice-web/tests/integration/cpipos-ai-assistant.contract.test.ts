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
const conversationService = source("../../src/lib/services/ai-conversation-service.ts");
const conversationMigration = source("../../../../supabase/migrations/20260929183000_pos_ai_openai_conversation_links.sql");
const usageService = source("../../src/lib/services/ai-usage-service.ts");
const usageMigration = source("../../../../supabase/migrations/20260929224000_pos_ai_usage_quota.sql");

describe("CpiPOS AI store assistant", () => {
  it("promotes AI to a first-class main menu and removes it from More", () => {
    expect(menuPolicy).toContain('key: "main.ai_assistant"');
    expect(menuPolicy).toContain('route: "/preview/pos/ai-assistant"');
    expect(menuPolicy).not.toContain('key: "more.ai_assistant"');
    expect(staffMenu).toContain('isPosMenuEnabled("main.ai_assistant", menuPolicy)');
    expect(staffMenu).toContain('const aiVisible = sessionRole === "owner" || sessionRole === "manager"');
    expect(staffMenu).toContain('href="/preview/pos/ai-assistant"');
    expect(staffMenu).not.toContain("moreExpanded");
    expect(staffMenu).not.toContain("pos-more-quick-menu");
    expect(moreWorkspace).not.toContain("CpiPOS AI ผู้ช่วยร้านค้า");
    expect(moreWorkspace).not.toContain('featured: true');
  });

  it("limits CpiPOS AI strictly to owner and manager users", () => {
    expect(aiPage).toContain('scope.session.role !== "owner" && scope.session.role !== "manager"');
    expect(aiApi).toContain('branchRole === "owner" || branchRole === "manager"');
    expect(aiApi).not.toContain('platformRole === "it_admin"');
    expect(aiActions).not.toContain('platformRole === "it_admin"');
  });

  it("keeps durable per-user history in OpenAI Conversations while response-object storage stays disabled", () => {
    expect(aiApi).toContain('readEnv("OPENAI_API_KEY")');
    expect(aiApi).toContain('fetch("https://api.openai.com/v1/responses"');
    expect(aiApi).toContain("conversation: conversationId");
    expect(aiApi).toContain("store: false");
    expect(aiApi).toContain('history_source: "openai_conversations"');
    expect(aiWorkspace).not.toContain("OPENAI_API_KEY");
    expect(conversationService).toContain('openAiFetch<OpenAiConversation>("/conversations"');
    expect(conversationService).toContain("tenant_id: scope.tenantId");
    expect(conversationService).toContain("branch_id: scope.branchId");
    expect(conversationService).toContain("user_id: scope.userId");
  });

  it("loads real POS sales, stock, and cost context before answering", () => {
    expect(aiApi).toContain("loadPosSalesSummaryData");
    expect(aiApi).toContain('.from("ingredients")');
    expect(aiApi).toContain('.from("recipes")');
    expect(aiApi).toContain("low_margin_products");
    expect(aiApi).toContain("low_stock");
  });

  it("keeps Phase 2 proposal -> confirm -> PIN -> execute", () => {
    expect(aiApi).toContain("propose_product_price_update");
    expect(aiApi).toContain("propose_stock_adjustment");
    expect(aiApi).toContain("propose_marketing_campaign");
    expect(aiWorkspace).toContain("PosManagerApprovalModal");
    expect(aiWorkspace).toContain("sales_record_edit");
    expect(aiWorkspace).toContain('fetch("/api/pos/ai/actions"');
    expect(aiActions).toContain('action: "update_product_price"');
    expect(aiActions).toContain('action: "adjust_stock"');
    expect(aiActions).toContain("appendAuditLog");
    expect(aiActions).toContain("ALLOWED_MUTATING_AI_ACTIONS");
    expect(aiActions).toContain('"update_product_price"');
    expect(aiActions).toContain('"adjust_stock"');
    expect(sharedTypes).toContain('"sales_record_edit"');
    expect(featureMap).toContain('"/preview/pos/ai-assistant": "core_pos_sales"');
  });

  it("enforces the promoted per-tenant IT AI policy on page and APIs", () => {
    expect(policyService).toContain("isTenantPosMenuEnabled");
    expect(aiPage).toContain('isTenantPosMenuEnabled(scope.session.tenant_id, "main.ai_assistant")');
    expect(aiApi).toContain('isTenantPosMenuEnabled(tenantId, "main.ai_assistant")');
    expect(aiActions).toContain('isTenantPosMenuEnabled(tenantId, "main.ai_assistant")');
    expect(aiApi).toContain("ai_assistant_disabled_by_it");
    expect(aiActions).toContain("ai_assistant_disabled_by_it");
  });

  it("moves Today and recommendations into accessible modal actions and renders basic rich text", () => {
    expect(aiWorkspace).toContain("setTodayModalOpen(true)");
    expect(aiWorkspace).toContain("setRecommendationModalOpen(true)");
    expect(aiWorkspace).toContain("function AiModal");
    expect(aiWorkspace).toContain('event.key === "Escape"');
    expect(aiWorkspace).toContain("role=\"dialog\"");
    expect(aiWorkspace).toContain("AiRichText");
    expect(aiWorkspace).toContain("InlineRichText");
    expect(aiWorkspace).not.toContain("xl:grid-cols-[minmax(0,1.7fr)_minmax(330px,0.8fr)]");
  });

  it("uses a GPT-like bounded chat surface with collapsible prompts and smart auto-scroll", () => {
    expect(aiWorkspace).toContain('cpipos-ai-show-suggestions');
    expect(aiWorkspace).toContain("toggleSuggestions");
    expect(aiWorkspace).toContain("ซ่อนคำถามแนะนำ");
    expect(aiWorkspace).toContain("แสดงคำถามแนะนำ");
    expect(aiWorkspace).toContain("chatScrollRef");
    expect(aiWorkspace).toContain("handleChatScroll");
    expect(aiWorkspace).toContain("scrollToBottom");
    expect(aiWorkspace).toContain("showScrollToBottom");
    expect(aiWorkspace).toContain("↓ กลับลงล่าง");
    expect(aiWorkspace).toContain('className="sticky bottom-0 z-20');
    expect(aiWorkspace).toContain("resizeComposer");
    expect(aiWorkspace).toContain("friendlyAiError");
  });

  it("stores only a tiny tenant/branch/user pointer in CpiPOS instead of duplicating chat messages", () => {
    expect(conversationMigration).toContain("pos_ai_conversation_links");
    expect(conversationMigration).toContain("primary key (tenant_id, branch_id, user_id)");
    expect(conversationMigration).toContain("openai_conversation_id text not null");
    expect(conversationMigration).not.toContain("message_text");
    expect(aiWorkspace).toContain("OpenAI Conversation");
    expect(aiWorkspace).toContain("ล้างประวัติของฉัน");
  });

  it("enforces package/store monthly quota and records token cost", () => {
    expect(aiApi).toContain("assertAiQuotaAvailable");
    expect(aiApi).toContain("recordAiUsage");
    expect(aiApi).toContain("prompt_cache_key");
    expect(aiApi).toContain("safety_identifier: promptCacheKey");
    expect(aiApi).toContain("makePromptCacheKey");
    expect(aiApi).toContain('createHash("sha256")');
    expect(aiApi).toContain(".slice(0, 64)");
    expect(aiApi).toContain("AiQuotaError");
    expect(usageService).toContain("pos_ai_package_quotas");
    expect(usageService).toContain("pos_ai_tenant_quota_overrides");
    expect(usageService).toContain("pos_ai_usage_events");
    expect(usageService).toContain('"gpt-6-luna"');
    expect(usageService).toContain("cached_input_tokens");
    expect(usageService).toContain("cache_write_tokens");
    expect(usageService).toContain("total_cost_usd");
    expect(usageMigration).toContain("monthly_request_limit");
    expect(usageMigration).toContain("monthly_token_limit");
    expect(usageMigration).toContain("monthly_cost_limit_usd");
  });

  it("keeps the promoted AI menu compact without extra AI/BETA badges", () => {
    expect(staffMenu).not.toContain("bg-cyan-300/15");
    expect(staffMenu).toContain('isHorizontal ? "max-w-[170px]" : "min-w-0 flex-1"');
    expect(aiWorkspace).not.toContain("BETA");
    expect(aiWorkspace).toContain("เดือน {quota.month_key}");
  });

  it("keeps destructive or financial reversal actions outside Phase 2", () => {
    expect(aiApi).toContain("ห้ามเสนอหรือดำเนินการยกเลิกบิล คืนเงิน");
    expect(aiApi).toContain("RESTRICTED_AI_REQUESTS");
    expect(aiApi).toContain("isRestrictedAiRequest");
    expect(aiApi).toContain("รัน SQL/คำสั่งฐานข้อมูลโดยตรง");
    expect(aiApi).toContain("ข้าม PIN/approval");
    expect(aiActions).not.toContain('"cancel_bill"');
    expect(aiActions).not.toContain('"refund"');
    expect(aiActions).not.toContain('"run_sql"');
    expect(aiActions).not.toContain('"delete_user"');
    expect(aiApi).toContain("system prompt");
    expect(aiApi).toContain("API key");
    expect(aiApi).toContain("ข้อมูล tenant/ร้านอื่น");
  });
});
