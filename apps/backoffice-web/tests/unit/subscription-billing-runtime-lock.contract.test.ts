import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
describe("subscription access lock and Support flow",()=>{
  const guard=src("src/lib/pos-session-guard.ts");
  const entry=src("src/components/pos/pos-entry-gate.tsx");
  const support=src("src/app/api/pos/subscription/support/route.ts");
  const page=src("src/app/preview/pos/payments/page.tsx");
  it("blocks normal POS access when the billing runtime is locked",()=>{
    expect(guard).toContain('from("tenant_subscription_runtime")');
    expect(guard).toContain("subscription_access_locked");
    expect(guard).toContain("await assertSubscriptionAccess");
    expect(entry).toContain('sessionCode==="subscription_access_locked"');
    expect(entry).toContain("แพ็กเกจถูกระงับการใช้งาน");
  });
  it("switches locked stores from self-service payment to Support",()=>{
    expect(entry).toContain("/api/pos/subscription/support");
    expect(entry).toContain("https://lin.ee/f1LXpAF");
    expect(support).toContain("tenant_subscription_support_requests");
    expect(support).toContain("subscription-support-handoff");
    expect(support).toContain("cpipos:internal-subscription-support-handoff:v1|");
    expect(page).toContain("support_required");
    expect(page).toContain("เปิดแชท Support");
  });
  it("shows provisional review without treating it as final settlement",()=>{
    expect(page).toContain("provisional_review");
    expect(page).toContain("provisional_access_active");
    expect(page).toContain("IT ต้องยืนยันเงินจริงภายใน 3 วัน");
  });
});
