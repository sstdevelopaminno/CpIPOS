import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import {
  parseFinanceDateRange, parseFinanceSalesRecordFilters,
  summarizeFinanceSales, paginateFinanceSalesRecords,
  type FinanceSalesOrder, type FinanceSalesPayment, type FinanceSalesBranch,
  type FinanceSalesRecordsPage
} from "@/lib/finance-sales-analytics";
import { FinanceReportError, type FinanceReadScope } from "@/lib/server/finance-report-guard";

const BATCH_SIZE = 500;
const MAX_ORDERS = 3000;
const PAYMENT_CHUNK = 100;

export type FinanceSalesReport = Omit<ReturnType<typeof summarizeFinanceSales>, "records"> & {
  table: FinanceSalesRecordsPage;
  availableMethods: string[];
  range: { from: string; to: string; timezone: "Asia/Bangkok"; basis: "payment_completed_at" };
  branches: FinanceSalesBranch[];
  selectedBranchId: string | null;
  scannedCompletedOrders: number;
  readOnly: true;
  notes: string[];
};

/** The browser never supplies a tenant or user identity. Enforce active
 * branch membership and an optional one-branch filter on the server.
 * No mutations, no cached cross-tenant report, no silent row truncation.
 */
export async function loadFinanceSalesReport(
  scope: FinanceReadScope,
  filters: {
    from: string | null; to: string | null; branchId: string | null;
    billNo?: string | null; method?: string | null;
    reconciliation?: string | null; page?: string | null; pageSize?: string | null;
  }
): Promise<FinanceSalesReport> {
  let range: ReturnType<typeof parseFinanceDateRange>;
  try {
    range = parseFinanceDateRange(filters.from, filters.to);
  } catch (error) {
    throw new FinanceReportError(error instanceof Error ? error.message : "finance_invalid_date", 422);
  }
  let recordFilters: ReturnType<typeof parseFinanceSalesRecordFilters>;
  try {
    recordFilters = parseFinanceSalesRecordFilters({
      billNo: filters.billNo ?? null,
      method: filters.method ?? null,
      reconciliation: filters.reconciliation ?? null,
      page: filters.page ?? null,
      pageSize: filters.pageSize ?? null
    });
  } catch {
    throw new FinanceReportError("finance_invalid_record_filter", 422);
  }
  const db = getSupabaseServiceClient();
  const { data: allBranches, error: branchError } = await db.from("branches")
    .select("id,code,name")
    .eq("tenant_id", scope.tenantId).eq("is_active", true)
    .order("name", { ascending: true });
  if (branchError) throw new FinanceReportError("finance_branches_unavailable", 503);
  const assigned = new Set(scope.branchIds);
  const branches = ((allBranches ?? []) as FinanceSalesBranch[])
    .filter(branch => assigned.has(branch.id));
  if (!branches.length) throw new FinanceReportError("finance_no_authorized_branches", 403);
  if (filters.branchId && !branches.some(branch => branch.id === filters.branchId))
    throw new FinanceReportError("finance_branch_not_permitted", 403);
  const selectedBranchIds = filters.branchId ? [filters.branchId] : branches.map(branch => branch.id);

  const orders: FinanceSalesOrder[] = [];
  for (let offset = 0; offset < MAX_ORDERS; offset += BATCH_SIZE) {
    const { data, error, count } = await db.from("orders")
      .select("id,branch_id,order_no,status,grand_total,total_amount,paid_total,metadata,payment_completed_at", { count: "exact" })
      .eq("tenant_id", scope.tenantId)
      .in("branch_id", selectedBranchIds)
      .eq("status", "completed")
      .gte("payment_completed_at", range.startIso)
      .lt("payment_completed_at", range.endExclusiveIso)
      .order("payment_completed_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error || count === null) throw new FinanceReportError("finance_sales_query_failed", 503);
    if (count > MAX_ORDERS) throw new FinanceReportError("finance_report_too_many_sales_narrow_dates", 422);
    const page = (data ?? []) as FinanceSalesOrder[];
    orders.push(...page);
    if (page.length < BATCH_SIZE) break;
  }

  const payments: FinanceSalesPayment[] = [];
  for (let offset = 0; offset < orders.length; offset += PAYMENT_CHUNK) {
    const ids = orders.slice(offset, offset + PAYMENT_CHUNK).map(order => order.id);
    const { data, error, count } = await db.from("payments")
      .select("id,order_id,method,status,amount", { count: "exact" })
      .eq("tenant_id", scope.tenantId)
      .in("branch_id", selectedBranchIds)
      .in("order_id", ids)
      .eq("status", "paid")
      .limit(1000);
    if (error || count === null)
      throw new FinanceReportError("finance_payments_query_failed", 503);
    // The Supabase Data API can cap output at 1,000 rows. Never present a
    // truncated sum as a confirmed financial receipt total.
    if (count >= 1000 || (data ?? []).length >= 1000)
      throw new FinanceReportError("finance_payments_too_many_narrow_dates", 422);
    payments.push(...((data ?? []) as FinanceSalesPayment[]));
  }
  const { records, ...summary } = summarizeFinanceSales(orders, payments, branches);
  const table = paginateFinanceSalesRecords(records, recordFilters);
  const availableMethods = [...new Set(summary.methods.map(item => item.method))].sort();
  return {
    ...summary,
    table, availableMethods,
    range: { from: range.from, to: range.to, timezone: "Asia/Bangkok", basis: "payment_completed_at" },
    branches, selectedBranchId: filters.branchId, scannedCompletedOrders: orders.length,
    readOnly: true,
    notes: [
      "ยอดขายคำนวณจากบิล completed ตามวันที่รับชำระสำเร็จ (Asia/Bangkok) ไม่รวมบิลยกเลิกหรือบิลค้าง",
      "ยอดรับชำระรวมเฉพาะรายการ payments ที่มีสถานะ paid แยกจากยอดบิล ไม่บวกซ้ำเข้ายอดขาย",
      "รายงานนี้ยังไม่ใช่กำไรสุทธิ ไม่หักต้นทุนและยังไม่คำนวณยอดคืนเงินหรือภาษีที่ต้องนำส่ง",
      "THB / LAK / USD แยกสรุป ไม่ใช้อัตราแลกเปลี่ยนและไม่รวมหลายสกุลเงินเข้าด้วยกัน"
    ]
  };
}
