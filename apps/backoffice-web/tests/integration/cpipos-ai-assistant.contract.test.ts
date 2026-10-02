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
const aiImage = source("../../src/app/api/pos/ai/product-image/route.ts");
const policyService = source("../../src/lib/server/pos-menu-policy-service.ts");
const sharedTypes = source("../../../../packages/shared-types/src/index.ts");
const conversationService = source("../../src/lib/services/ai-conversation-service.ts");
const conversationMigration = source("../../../../supabase/migrations/20260929183000_pos_ai_openai_conversation_links.sql");
const roomMigration = source("../../../../supabase/migrations/20260930133000_cpipos_ai_chat_rooms_retention.sql");
const roomListApi = source("../../src/app/api/pos/ai/conversations/route.ts");
const roomApi = source("../../src/app/api/pos/ai/conversations/[roomId]/route.ts");
const usageService = source("../../src/lib/services/ai-usage-service.ts");
const usageMigration = source("../../../../supabase/migrations/20260929224000_pos_ai_usage_quota.sql");
const oneTimeApprovalMigration = source("../../../../supabase/migrations/20260930062000_one_time_manager_pin_approvals.sql");

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

  it("keeps durable per-user history server-side while the POS client stays provider-neutral", () => {
    expect(aiApi).toContain('readEnv("OPENAI_API_KEY")');
    expect(aiApi).toContain('fetch("https://api.openai.com/v1/responses"');
    expect(aiApi).toContain("conversation: conversationId");
    expect(aiApi).toContain("store: false");
    expect(aiApi).toContain("publicAiChatRoom");
    expect(aiApi).not.toContain('history_source: "openai_conversations"');
    expect(aiWorkspace).not.toContain("OPENAI_API_KEY");
    expect(aiWorkspace).not.toContain("OpenAI");
    expect(conversationService).toContain('openAiFetch<OpenAiConversation>("/conversations"');
    expect(conversationService).toContain("tenant_id: scope.tenantId");
    expect(conversationService).toContain("branch_id: scope.branchId");
    expect(conversationService).toContain("user_id: scope.userId");
    expect(conversationService).toContain("publicAiChatRoom");
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
    expect(aiApi).toContain("propose_create_product");
    expect(aiApi).toContain("propose_product_image");
    expect(aiApi).toContain("propose_document");
    expect(aiApi).toContain("query_sales_period");
    expect(aiWorkspace).toContain("PosManagerApprovalModal");
    expect(aiWorkspace).toContain("sales_record_edit");
    expect(aiWorkspace).toContain('fetch("/api/pos/ai/actions"');
    expect(aiActions).toContain('action: "update_product_price"');
    expect(aiActions).toContain('action: "adjust_stock"');
    expect(aiActions).toContain("appendAuditLog");
    expect(aiActions).toContain("ALLOWED_MUTATING_AI_ACTIONS");
    expect(aiActions).toContain("consumeAiApproval");
    expect(aiActions).toContain('.is("consumed_at", null)');
    expect(oneTimeApprovalMigration).toContain("consumed_at timestamptz");
    expect(oneTimeApprovalMigration).toContain("idx_manager_pin_approvals_unconsumed");
    expect(aiActions).toContain('"update_product_price"');
    expect(aiActions).toContain('"adjust_stock"');
    expect(aiActions).toContain('"create_product"');
    expect(aiImage).toContain('fetch("https://api.openai.com/v1/images/generations"');
    expect(aiImage).toContain("gpt-image-2.5-sunburst");
    expect(sharedTypes).toContain('"sales_record_edit"');
    expect(featureMap).toContain('"/preview/pos/ai-assistant": "cpipos_ai"');
  });

  it("enforces the promoted per-tenant IT AI policy on page and APIs", () => {
    expect(policyService).toContain("isTenantPosMenuEnabled");
    expect(aiPage).toContain('isTenantPosMenuEnabled(scope.session.tenant_id, "main.ai_assistant")');
    expect(aiPage).toContain('hasBranchFeature(scope.session.tenant_id, scope.session.branch_id, "cpipos_ai")');
    expect(aiPage).toContain('redirect("/preview/pos/payments/package")');
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
    expect(aiWorkspace).toContain("cpipos-ai-room-sidebar-collapsed");
    expect(aiWorkspace).toContain("toggleRoomSidebar");
    expect(aiWorkspace).toContain("เปิดแถบห้องแชท");
    expect(aiWorkspace).toContain("ซ่อนแถบห้องแชท");
  });

  it("stores only a tiny local room index while full chat content stays in the provider conversation store", () => {
    expect(conversationMigration).toContain("pos_ai_conversation_links");
    expect(roomMigration).toContain("create table if not exists public.pos_ai_chat_rooms");
    expect(roomMigration).toContain("openai_conversation_id text not null unique");
    expect(roomMigration).not.toContain("message_text");
    expect(roomMigration).not.toContain("message_content");
    expect(conversationService).toContain("listAiChatRooms");
    expect(conversationService).toContain("createAiChatRoom");
    expect(conversationService).toContain("deleteOpenAiConversationById");
    expect(conversationService).not.toContain("conversationExists");
    expect(roomListApi).toContain("publicAiChatRoom");
    expect(roomListApi).not.toContain('storage: "openai_conversations"');
    expect(roomApi).toContain("listAiConversationMessages");
    expect(roomApi).toContain("publicAiChatRoom");
    expect(aiWorkspace).not.toContain("OpenAI");
  });

  it("handles expired POS sessions without turning them into generic AI failures", () => {
    expect(aiApi).toContain("PosGuardError");
    expect(aiApi).toContain("return fail(error.code, error.message, error.status)");
    expect(aiWorkspace).toContain("POS_SESSION_AUTH_CODES");
    expect(aiWorkspace).toContain("redirectToPosLogin");
    expect(aiWorkspace).toContain("เซสชัน POS หมดอายุ");
    expect(aiPage).toContain('redirect("/login/employee")');
  });

  it("supports one active room at a time with GPT-like room navigation and deletion", () => {
    expect(aiWorkspace).toContain("function ChatRoomPanel");
    expect(aiWorkspace).toContain("แชทใหม่");
    expect(aiWorkspace).toContain("activeRoomId");
    expect(aiWorkspace).toContain("openRoom(roomId");
    expect(aiWorkspace).toContain("createRoom()");
    expect(aiWorkspace).toContain("deleteRoom(room");
    expect(aiWorkspace).toContain("☰ ห้องแชท");
    expect(aiWorkspace).toContain("cpipos-ai-active-room-id");
    expect(aiWorkspace).toContain("rememberActiveRoom");
    expect(aiWorkspace).toContain("ข้อมูลสำคัญวันนี้");
    expect(aiWorkspace).toContain("เมนูแนะนำสำหรับคุณ");
    expect(aiWorkspace).toContain("setRooms([]);");
    expect(aiWorkspace).toContain("rememberActiveRoom(null)");
    expect(aiApi).toContain("room_id");
    expect(aiApi).toContain("getOrCreateAiChatRoom");
    expect(aiApi).toContain("touchAiChatRoom");
    expect(roomApi).toContain("deleteAiChatRoom");
  });

  it("enforces package-controlled OpenAI chat retention without storing transcripts in Supabase", () => {
    expect(roomMigration).toContain("history_retention_days");
    expect(roomMigration).toContain("when 'growth' then 365");
    expect(roomMigration).toContain("when 'business' then 730");
    expect(usageService).toContain("history_retention_days");
    expect(conversationService).toContain("pruneExpiredAiChatRooms");
    expect(aiApi).toContain("pruneExpiredAiChatRooms");
    expect(conversationService).toContain("history_cleared_at");
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
    expect(aiApi).toContain("AI_FALLBACK_MODEL");
    expect(aiApi).toContain("AI_QUALITY_MODEL");
    expect(aiApi).toContain('"gpt-6-sol"');
    expect(aiApi).toContain("reasoningEffort");
    expect(aiApi).toContain("mergeAiResponseUsage");
    expect(aiApi).toContain("ai_provider_rate_limited");
    expect(aiApi).toContain("persistConversationTurn");
    expect(aiApi).toContain('verbosity: useQuality ? "medium" : "low"');
    expect(usageService).toContain("pos_ai_package_quotas");
    expect(usageService).toContain("pos_ai_tenant_quota_overrides");
    expect(usageService).toContain("pos_ai_usage_events");
    expect(usageService).toContain('"gpt-6-luna"');
    expect(usageService).toContain('"gpt-6-sol"');
    expect(usageService).toContain("cached_input_tokens");
    expect(usageService).toContain("cache_write_tokens");
    expect(usageService).toContain("total_cost_usd");
    expect(usageMigration).toContain("monthly_request_limit");
    expect(usageMigration).toContain("monthly_token_limit");
    expect(usageMigration).toContain("monthly_cost_limit_usd");
  });

  it("keeps the promoted AI menu compact and simplifies the customer-facing AI header", () => {
    expect(staffMenu).not.toContain("bg-cyan-300/15");
    expect(staffMenu).toContain('const aiLabel = lang === "th" ? "CpiPOS AI" : "CpiPOS AI"');
    expect(aiWorkspace).not.toContain("BETA");
    expect(aiWorkspace).toContain(">CpiPOS AI</h1>");
    expect(aiWorkspace).not.toContain("CpiPOS AI ผู้ช่วยร้านค้า</h1>");
    expect(aiWorkspace).not.toContain("ผู้ช่วยอัจฉริยะสำหรับยอดขาย ต้นทุน สต๊อก และการตลาด");
    expect(aiWorkspace).not.toContain("ประวัติส่วนตัวตามบัญชี Owner/Manager");
    expect(aiWorkspace).not.toContain("cpipos-symbol-sidebar.png");
    expect(aiWorkspace).toContain("เดือน {quota.month_key}");
  });

  it("queries exact historical sales and can research current market context", () => {
    expect(aiApi).toContain("query_sales_period");
    expect(aiApi).toContain("executeAiReadTool");
    expect(aiApi).toContain("date_from");
    expect(aiApi).toContain("date_to");
    expect(aiApi).toContain('type: "web_search"');
    expect(aiApi).toContain("needsMarketWeb");
    expect(aiApi).toContain("loadBusinessIdentity");
    expect(aiApi).toContain("อย่าถามซ้ำ");
  });

  it("creates products and can generate then attach product images", () => {
    expect(aiActions).toContain('body.action === "create_product"');
    expect(aiActions).toContain('from("product_channel_prices")');
    expect(aiActions).toContain('from("recipes")');
    expect(aiWorkspace).toContain("generateProductImage");
    expect(aiWorkspace).toContain("attachGeneratedProductImage");
    expect(aiWorkspace).toContain("/api/pos/product-media/");
    expect(aiImage).toContain("gpt-image-2.5-sunburst");
  });

  it("keeps destructive or financial reversal actions outside Phase 2", () => {
    expect(aiApi).toContain("ห้ามดำเนินการยกเลิกบิล คืนเงิน");
    expect(aiApi).toContain("RESTRICTED_AI_REQUESTS");
    expect(aiApi).toContain("isRestrictedAiRequest");
    expect(aiApi).toContain("รัน SQL/คำสั่งฐานข้อมูลโดยตรง");
    expect(aiApi).toContain("ข้าม approval");
    expect(aiActions).not.toContain('"cancel_bill"');
    expect(aiActions).not.toContain('"refund"');
    expect(aiActions).not.toContain('"run_sql"');
    expect(aiActions).not.toContain('"delete_user"');
    expect(aiApi).toContain("system prompt");
    expect(aiApi).toContain("API key");
    expect(aiApi).toContain("ข้อมูล tenant/ร้านอื่น");
  });
});
