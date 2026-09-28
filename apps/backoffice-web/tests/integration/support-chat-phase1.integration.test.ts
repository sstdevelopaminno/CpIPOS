import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Support Chat Phase 1 - POS", () => {
  const center = src("src/components/pos-preview/pos-subscription-center.tsx");
  const chat = src("src/components/pos-preview/pos-support-chat.tsx");
  const bridge = src("src/lib/services/support-chat/support-chat-bridge.ts");
  const conversations = src("src/app/api/pos/support-chat/conversations/route.ts");
  const messages = src("src/app/api/pos/support-chat/conversations/[conversationId]/messages/route.ts");

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

  it("keeps chat history server-side and loads on demand", () => {
    expect(messages).toContain('callSupportChat');
    expect(messages).toContain('"get_messages"');
    expect(messages).toContain('"mark_read"');
    expect(chat).not.toContain("setInterval(");
  });
});
