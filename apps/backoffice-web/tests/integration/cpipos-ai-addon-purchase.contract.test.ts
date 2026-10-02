import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("CpiPOS AI quota top-up purchase flow",()=>{
  const ai=src("src/components/pos-preview/cpipos-ai-assistant.tsx");
  const usage=src("src/lib/services/ai-usage-service.ts");
  const billing=src("src/components/pos-preview/pos-subscription-center.tsx");
  const request=src("src/app/api/pos/billing/requests/route.ts");
  const support=src("src/components/pos-preview/pos-support-chat.tsx");

  it("auto-surfaces exhausted quota with support and AI purchase actions",()=>{
    expect(ai).toContain("quotaPopupOpen");
    expect(ai).toContain("โควตา CpiPOS AI ของแพ็กเกจครบแล้ว");
    expect(ai).toContain("/preview/pos/payments/support?open=chat");
    expect(ai).toContain("/preview/pos/payments/package?mode=ai-addon");
  });

  it("adds approved paid top-ups to the monthly AI limits",()=>{
    expect(usage).toContain('from("pos_ai_tenant_addon_purchases")');
    expect(usage).toContain("addonTotals");
    expect(usage).toContain("baseLimits.requests + addonTotals.requests");
  });

  it("uses IT-defined add-on price and quotas in the POS payment flow",()=>{
    expect(billing).toContain('tab === "ai"');
    expect(billing).toContain("ai_addon_monthly_tokens");
    expect(billing).toContain('"ai_addon_payment"');
    expect(request).toContain('kind === "ai_addon_payment"');
    expect(request).toContain("target.ai_addon_monthly_price");
    expect(request).toContain("ai_addon_tokens");
  });

  it("deep-links quota support directly into Support Chat",()=>{
    expect(support).toContain('params.get("open") === "chat"');
    expect(support).toContain('params.get("subject")');
  });
});
