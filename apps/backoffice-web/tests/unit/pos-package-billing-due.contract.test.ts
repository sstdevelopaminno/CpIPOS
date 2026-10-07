import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";

const src=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
describe("POS package billing due state",()=>{
  const service=src("src/lib/services/pos-package-overview-service.ts");
  const page=src("src/app/preview/pos/payments/page.tsx");
  it("uses the canonical entitlement-derived due state",()=>{
    expect(service).toContain('rpc("subscription_billing_due_state"');
    expect(service).toContain("billingDue");
    expect(page).toContain('open:"รอชำระ"');
    expect(page).toContain('under_review:"รอตรวจสอบการชำระ"');
    expect(page).toContain("สถานะรอบชำระคำนวณจากวันสิ้นสุดสิทธิ์ปัจจุบัน");
  });
  it("keeps historical paid settlement separate from the next bill",()=>{
    expect(page).toContain("รอบชำระถัดไป");
    expect(page).toContain("ยอดที่ต้องชำระ");
    expect(service).not.toContain('from("tenant_billing_cycles")');
  });
});
