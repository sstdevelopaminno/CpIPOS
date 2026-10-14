import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
const api=source("src/app/api/pos/optical/customers/route.ts");
const serverGate=source("src/lib/server/optical-entitlement.ts");
const ui=source("src/components/pos/pos-optical-customer-modal.tsx");
const payment=source("src/components/pos-ui/pos-payment-panel.tsx");
const migration=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261014120000_optical_customer_exam_history.sql"),"utf8");

describe("Optical customer history does not bypass IT or legacy financial controls",()=>{
  it("requires POS session, permission and the explicit Optical grant",()=>{
    expect(api).toContain("requirePosSession()");
    expect(api).toContain('requirePermission(scope,"sale:create")');
    expect(api).toContain("requireOpticalRetailEntitlement(scope.session.tenant_id)");
    expect(serverGate).toContain("grants.optical_retail !== true");
    expect(serverGate).toContain('toLowerCase() === "custom"');
  });
  it("persists append-only eye exams and prevents cross-tenant CRM exposure",()=>{
    expect(migration).toContain("optical_eye_exams");
    expect(migration).toContain("optical_exam_customer_scope");
    expect(migration).toContain("can_manage_optical_customer_data");
    expect(migration).toContain("optical_save_customer_exam");
    expect(migration).toContain("optical_exam_idempotency");
    expect(migration).toContain("enable row level security");
  });
  it("aligns full checkout/cancel and keeps deposit disabled",()=>{
    expect(payment).toContain('data-testid="pos-optical-primary-actions"');
    expect(payment).toContain("min-h-14 w-full items-center justify-center");
    expect(payment).toContain("ชำระเงินมัดจำ");
    expect(payment).toContain('aria-disabled="true"');
    expect(payment).toContain("เพิ่มประวัติลูกค้า");
    expect(ui).toContain("/api/pos/optical/customers");
    expect(api).not.toContain("complete_pos_payment_tx");
  });
});
