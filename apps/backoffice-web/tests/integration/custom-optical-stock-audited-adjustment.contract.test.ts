import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261019211500_optical_stock_adjustment_audit_v1.sql"),"utf8");
const ui=src("components/pos/optical-stock-workspace.tsx");
const api=src("app/api/pos/optical/stock/adjust/route.ts");
describe("Optical stock receive / issue audited workflow (staged only)",()=>{
 it("requires scoped authorizations before touching amounts",()=>{
  expect(api).toContain("requirePosSession()");
  expect(api).toContain('requirePermission(scope,"inventory:view")');
  expect(api).toContain('requireTenantFeature(scope.session.tenant_id,"stock_management",branchId)');
  expect(api).toContain("getOpticalBranchScope(scope)");
  expect(api).toContain("requireOpticalRetailEntitlement");
  expect(api).toContain('rpc("optical_adjust_stock_tx"');
  expect(sql).toContain("current_setting('request.jwt.claim.role', true)");
  expect(sql).toContain("auth.uid() is distinct from p_actor");
  expect(sql).toContain("OPTICAL_STOCK_SCOPE_FORBIDDEN");
  expect(sql).toContain("OPTICAL_STOCK_IT_DISABLED");
  expect(sql).toContain("OPTICAL_STOCK_FEATURE_DENIED");
 });
 it("records each manual movement atomically and prevents unsafe deductions",()=>{
  expect(sql).toContain("optical_stock_adjustments_request_unique");
  expect(sql).toContain("pg_advisory_xact_lock");
  expect(sql).toContain("for update");
  expect(sql).toContain("v_new<v_bin.reserved");
  expect(sql).toContain("OPTICAL_STOCK_INSUFFICIENT_UNRESERVED");
  expect(sql).toContain("OPTICAL_STOCK_IDEMPOTENCY_CONFLICT");
  expect(sql).toContain("public.audit_logs");
  expect(sql).toContain("OPTICAL_LEGACY_RECIPE_REQUIRES_CUTOVER");
  expect(sql).toContain("OPTICAL_STOCK_HISTORICAL_SALES_NEED_RECONCILIATION");
  expect(sql).toContain("alter table public.optical_stock_adjustments enable row level security");
 });
 it("barcode scanner opens a popup; adjustments require user confirmation",()=>{
  expect(ui).toContain('type Modal=null|"add"|"bulk"|"edit"|"delete"|"sku"|"media"|"best"|"adjust"|"scan"|"summary"');
  expect(ui).toContain("handleBarcodeScan()");
  expect(ui).toContain('onClick={()=>openStockAdjustment(row.sku??"")}');
  expect(ui).toContain("saveStockAdjustment()");
  expect(ui).toContain('direction:adjustDirection');
  expect(ui).toContain("setAdjustRequestId(crypto.randomUUID())");
  expect(ui).toContain('inputMode="numeric" type="number"');
  expect(ui).toContain('จำนวนรับเข้าเริ่มต้น');
 });
 it("requires positive quantity per bulk row and queues each audited receipt for confirmation",()=>{
  expect(ui).toContain('"จำนวนรับเข้าเริ่มต้น","ลบแถว"');
  expect(ui).toContain('onChange={e=>changeBulk(i,"initial_quantity",e.target.value)}');
  expect(ui).toContain("pendingBulkReceipts");
  expect(ui).toContain("setPendingBulkReceipts(proposals.slice(1))");
  expect(ui).toContain("advanceReceiptQueue()");
  expect(ui).toContain("const catalogItems=items.map");
  expect(ui).toContain("setAdjustQuantity(proposals[0].quantity)");
  expect(ui).toContain("ไม่รับเข้าอัตโนมัติ");
 });
 it("moves barcode scanner and summary cards into distinct dialogs without changing audited stock mutations",()=>{
  expect(ui).toContain('onClick={()=>show("scan")}');
  expect(ui).toContain('onClick={()=>show("summary")}');
  expect(ui).toContain('modal==="scan"?<div');
  expect(ui).toContain('modal==="summary"?<div');
  expect(ui).toContain('role="alert" className="mt-1 block text-xs text-rose-700"');
  expect(ui).toContain("กรุณาระบุเหตุผลในการปรับสต๊อก");
  expect(ui).toContain("จำนวนต้องเป็นจำนวนเต็มบวก");
  expect(ui).toContain("รับสินค้าตามใบส่งของ");
  expect(ui).not.toContain('aria-label={T("สแกนเพื่อปรับสต๊อก")}');
 });
});
