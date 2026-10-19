import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
const sourceFile=(path:string)=>readFileSync(resolve(process.cwd(),"src",path),"utf8");
const db=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261019223000_optical_pos_paid_sale_atomic_deduction.sql"),"utf8");
const orderPay=sourceFile("app/api/pos/orders/[orderId]/pay/route.ts");
const service=sourceFile("lib/services/pos-sales-service.ts");
describe("CUSTOM Optical stock-safe POS payment",()=>{
 it("all POS payment entry points route Optical through the atomic stock payment RPC",()=>{
  expect(orderPay).toContain('isOptical ? "optical_complete_pos_payment_tx" : "complete_pos_payment_tx"');
  expect(orderPay).toContain("if (!isOptical) {");
  expect(service).toContain('isOptical ? "optical_complete_pos_payment_tx" : "complete_pos_payment_tx"');
  expect(service).toContain('if (POS_FORCE_DIRECT_PAYMENT_COMPLETE && !isOptical)');
  expect(service).toContain('if (!isOptical) {\n    const completedReplay');
  expect(service).toContain('if (isOptical) {\n      // Do not fall back');
 });
 it("atomic ledger cannot charge a second time, oversell, or bypass reservations",()=>{
  expect(db).toContain("unique(tenant_id,branch_id,order_id,product_id)");
  expect(db).toContain("for update");
  expect(db).toContain("b.on_hand-b.reserved>=v_item.qty");
  expect(db).toContain("OPTICAL_PAYMENT_INSUFFICIENT_AVAILABLE_STOCK");
  expect(db).toContain("OPTICAL_PAYMENT_REPLAY_WITHOUT_STOCK_LEDGER");
  expect(db).toContain("OPTICAL_USE_ATOMIC_PAYMENT_RPC");
  expect(db).toContain("app.complete_pos_payment_tx(");
  expect(db).toContain("payment_total_lak");
  expect(db).toContain("enable row level security");
  expect(db).toContain("service_role");
 });
});
