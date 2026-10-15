import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const source=(path:string)=>readFileSync(new URL("../../src/"+path,import.meta.url),"utf8");
const proposal=(file:string)=>readFileSync(new URL("../../../../supabase/proposals/"+file,import.meta.url),"utf8");

describe("Optical-only finance isolation (not deployed)",()=>{
  it("requires CUSTOM/Optical plus explicit feature and environment gate",()=>{
    const policy=source("lib/server/optical-finance-policy.ts");
    expect(policy).toContain('process.env.OPTICAL_FINANCE_V1_ENABLED !== "true"');
    expect(policy).toContain('customFeatures?.[feature] === true');
    expect(policy).toContain('salesModes?.optical_retail === true');
    expect(policy).toContain('contracts.length !== 1');
    const payments=source("app/api/pos/optical/work-orders/[workOrderId]/payments/route.ts");
    expect(payments).toContain("requireActiveShift(scope)");
    expect(payments).toContain("scope.session.tenant_id");
    expect(payments).toContain("scope.session.branch_id");
    expect(payments).toContain("optical_transfer_verification_pending");
    expect(payments).not.toContain('supabase.from("payments").insert');
  });
  it("keeps new inventory movement ledger separate from shared restaurant stock",()=>{
    const schema=proposal("20261015_optical_work_order_ledger_isolated.sql");
    const rpc=proposal("20261015_optical_atomic_transactions.sql");
    expect(schema).toContain("create table if not exists public.optical_stock_bins");
    expect(schema).toContain("create table if not exists public.optical_stock_reservations");
    expect(schema).toContain("create table if not exists public.optical_payment_ledger");
    expect(schema).toContain("create table if not exists public.optical_stock_movements");
    expect(schema).toContain("enable row level security");
    expect(schema).toContain("unique(tenant_id,branch_id,request_id)");
    expect(rpc).toContain("OPTICAL_LEGACY_RECIPE_OR_PRICE_REQUIRES_STOCK_CUTOVER");
    expect(rpc).toContain("OPTICAL_OUTSTANDING_BALANCE");
    expect(rpc).toContain("OPTICAL_IDEMPOTENCY_CONFLICT");
    expect(rpc).toContain("for update");
    expect(rpc).not.toContain("insert into public.payments");
    expect(rpc).not.toContain("insert into public.orders");
    expect(rpc).not.toContain("insert into public.stock_movements");
    expect(rpc).not.toContain("update public.ingredients");
  });
  it("recall QR only fetches tenant-scoped partially-paid bill",()=>{
    const recall=source("app/api/pos/optical/work-orders/recall/route.ts");
    const receipt=source("app/api/pos/optical/work-orders/[workOrderId]/deposit-receipt/route.ts");
    expect(recall).toContain("parseOpticalBillRecallCode");
    expect(recall).toContain('eq("tenant_id",scope.session.tenant_id)');
    expect(recall).toContain('eq("branch_id",scope.session.branch_id)');
    expect(recall).toContain("Number(data.paid_total)<=0");
    expect(receipt).toContain("QRCode.toDataURL");
    expect(receipt).toContain("renderOpticalDepositReceipt80mm");
    expect(receipt).toContain('Cache-Control":"no-store, private"');
    expect(receipt).not.toContain("queueRoutedSalesReceipt(");
    expect(receipt).not.toContain("window.print(");
  });
});
