import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("POS support notifications and direct navigation",()=>{
  const menu=src("src/components/pos-preview/pos-staff-menu.tsx");
  const sw=src("public/sw.js");
  const notifier=src("src/components/pos-preview/pos-support-notifier.tsx");
  const push=src("src/components/pos-preview/pos-support-push-control.tsx");
  const message=src("src/app/api/pos/support-chat/conversations/[conversationId]/messages/route.ts");
  const requests=src("src/app/api/pos/billing/requests/route.ts");

  it("shows direct Chat and Send Request menus with unread badge",()=>{
    expect(menu).toContain('href="/preview/pos/payments/support"');
    expect(menu).toContain('href="/preview/pos/payments/package"');
    expect(menu).toContain("supportUnread");
    expect(menu).toContain("ส่งคำขอ");
  });
  it("supports browser push in the service worker",()=>{
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(push).toContain("pushManager.subscribe");
  });
  it("keeps instant in-app chat notification and server push",()=>{
    expect(notifier).toContain('event: "message_preview"');
    expect(message).toContain('audience: "it"');
    expect(message).toContain('kind: "chat"');
    expect(requests).toContain('kind: "request"');
  });
});
