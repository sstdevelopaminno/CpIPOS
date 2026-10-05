import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Support Chat Phase 1 - POS", () => {
  const center = src("src/components/pos-preview/pos-subscription-center.tsx");
  const chat = src("src/components/pos-preview/pos-support-chat.tsx");
  const notifier = src("src/components/pos-preview/pos-support-notifier.tsx");
  const bridge = src("src/lib/services/support-chat/support-chat-bridge.ts");
  const conversations = src("src/app/api/pos/support-chat/conversations/route.ts");
  const messages = src("src/app/api/pos/support-chat/conversations/[conversationId]/messages/route.ts");
  const conversation = src("src/app/api/pos/support-chat/conversations/[conversationId]/route.ts");

  it("adds chat to the existing contact/report-issue popup", () => {
    expect(center).toContain("PosSupportChat");
    expect(center).toContain("ติดต่อสอบถาม / แจ้งปัญหา");
    expect(chat).toContain("คุยแชท");
    expect(chat).toContain("ชื่อเรื่องที่ติดต่อ");
    expect(chat).toContain("ชื่อผู้ติดต่อ");
  });

  it("derives tenant identity from the authenticated POS session", () => {
    expect(conversations).toContain("requirePosSession()");
    expect(conversations).toContain("scope.session.tenant_id");
    expect(conversations).not.toContain("body?.tenant_id");
  });

  it("uses a signed server bridge instead of exposing Communications secrets", () => {
    expect(bridge).toContain("issue_support_chat_bridge_token");
    expect(bridge).toContain("https://wznixoeezgyhtwurcswb.supabase.co/functions/v1/support-chat-api");
    expect(bridge).not.toContain("CPIPOS_COMMUNICATIONS_SECRET_KEY");
    expect(chat).not.toContain("supabase.co/functions");
  });

  it("rate-limits creation and messaging", () => {
    expect(conversations).toContain('namespace: "pos-support-chat-create"');
    expect(conversations).toContain("max: 5");
    expect(messages).toContain('namespace: "pos-support-chat-message"');
    expect(messages).toContain("max: 30");
  });

  it("updates live chat without timer polling and shows typing/media", () => {
    expect(chat).toContain('"postgres_changes"');
    expect(chat).toContain('table: "support_chat_heads"');
    expect(chat).toContain('event: "typing"');
    expect(chat).toContain("กำลังพิมพ์");
    expect(chat).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(chat).toContain("2 MB");
    expect(messages).toContain("attachment: body?.attachment");
  });

  it("broadcasts message previews on the same low-latency channel as typing", () => {
    expect(chat).toContain('event: "message_preview"');
    expect(chat).toContain('event: "message_retract"');
    expect(chat).toContain('payload: { actor: "store", client_id: optimisticId }');
    expect(chat).toContain('id = `broadcast:${event.client_id}`');
  });

  it("lets the store end a conversation while retaining text history", () => {
    expect(conversation).toContain('"close_conversation"');
    expect(chat).toContain("จบการสนทนา");
    expect(chat).toContain("เริ่มเรื่องใหม่");
    expect(chat).toContain("รูปภาพถูกลบ");
  });

  it("uses the CpIPOS system logo for support when no employee avatar exists", () => {
    expect(chat).toContain("/brand/cpipos-symbol-sidebar.png");
  });

  it("keeps chat history server-side and loads on demand", () => {
    expect(messages).toContain('callSupportChat');
    expect(messages).toContain('"get_messages"');
    expect(messages).toContain("mark_read: true");
    expect(chat).not.toContain("setInterval(");
  });

  it("keeps the global POS support notifier realtime-first without per-event HTTP refresh", () => {
    expect(notifier).toContain('"postgres_changes"');
    expect(notifier).toContain("headsRef");
    expect(notifier).toContain("realtimeHealthy");
    expect(notifier).toContain('window.addEventListener("focus", onRecovery)');
    expect(notifier).toContain('window.addEventListener("online", onRecovery)');
    expect(notifier).not.toContain("void refresh();\n      })");
  });

  it("publishes a secure realtime head preview before cross-project persistence", () => {
    expect(bridge).toContain("publishOptimisticSupportChatHead");
    expect(bridge).toContain("rollbackOptimisticSupportChatHead");
    expect(messages).toContain('publishOptimisticSupportChatHead(conversationId, "store", preview)');
    expect(messages).toContain("const bridgePromise = issuePosSupportChatBridge(scope)");
  });

  it("optimizes perceived realtime delivery without polling or per-message history churn", () => {
    expect(chat).toContain("Optimistic local echo");
    expect(chat).toContain("preview:");
    expect(chat).toContain("setHeads((current)");
    expect(chat).toContain("scheduleMessageReconcile");
    expect(chat).toContain("messageReconcileTimerRef");
    expect(chat).toContain("1500");
    expect(chat).not.toContain("void loadHeads();\n        if (!selectedId");
    expect(messages).toContain("head_changed");
  });
});
