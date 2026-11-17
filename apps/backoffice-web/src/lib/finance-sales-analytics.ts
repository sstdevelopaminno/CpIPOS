import { orderCurrencyFromMetadata, type SalesCurrencyCode } from "@/lib/pos-money";

export type FinanceSalesOrder = {
  id: string;
  branch_id: string;
  order_no: string | null;
  status: string;
  grand_total: number | string | null;
  total_amount: number | string | null;
  paid_total: number | string | null;
  metadata: unknown;
  payment_completed_at: string | null;
};
export type FinanceSalesPayment = {
  id: string;
  order_id: string;
  method: string;
  status: string;
  amount: number | string | null;
};
export type FinanceSalesBranch = { id: string; name: string; code: string };
export type FinanceSalesBucket = {
  currency: SalesCurrencyCode;
  billed: number;
  received: number;
  bills: number;
  unmatchedBills: number;
};
export type FinanceSalesDaily = FinanceSalesBucket & { date: string };
export type FinanceSalesByBranch = FinanceSalesBucket & {
  branchId: string;
  branchName: string;
};
export type FinanceSalesMethod = {
  currency: SalesCurrencyCode;
  method: string;
  received: number;
  transactions: number;
};
export type FinanceSalesRecent = {
  orderId: string;
  orderNo: string;
  branchId: string;
  branchName: string;
  completedAt: string;
  currency: SalesCurrencyCode;
  billed: number;
  received: number;
  methods: string[];
  unmatched: boolean;
};

function finiteMoney(value: number | string | null): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) throw new Error("finance_invalid_amount");
  return number;
}
function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function dateBangkok(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok"
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function empty(currency: SalesCurrencyCode): FinanceSalesBucket {
  return { currency, billed: 0, received: 0, bills: 0, unmatchedBills: 0 };
}
function accumulate(row: FinanceSalesBucket, billed: number, received: number, unmatched: boolean) {
  row.billed = money(row.billed + billed);
  row.received = money(row.received + received);
  row.bills++;
  if (unmatched) row.unmatchedBills++;
}

/** Reporting is by payment completion in Bangkok. Cancelled/queued orders
 * are never sales. Payments are evidence, not a second copy of order revenue.
 * Currencies are NEVER added together and refunds/costs are NOT inferred.
 */
export function summarizeFinanceSales(
  orders: readonly FinanceSalesOrder[],
  payments: readonly FinanceSalesPayment[],
  branches: readonly FinanceSalesBranch[]
): {
  totals: FinanceSalesBucket[];
  daily: FinanceSalesDaily[];
  byBranch: FinanceSalesByBranch[];
  methods: FinanceSalesMethod[];
  recent: FinanceSalesRecent[];
  records: FinanceSalesRecent[];
} {
  const branchMap = new Map(branches.map(branch => [branch.id, branch]));
  const paymentsByOrder = new Map<string, FinanceSalesPayment[]>();
  const uniquePaymentIds = new Set<string>();
  const orderIds = new Set(orders.filter(o => o.status === "completed").map(o => o.id));
  for (const payment of payments) {
    if (payment.status !== "paid" || !orderIds.has(payment.order_id) || uniquePaymentIds.has(payment.id)) continue;
    uniquePaymentIds.add(payment.id);
    const list = paymentsByOrder.get(payment.order_id) ?? [];
    list.push(payment);
    paymentsByOrder.set(payment.order_id, list);
  }
  const totals = new Map<SalesCurrencyCode, FinanceSalesBucket>();
  const daily = new Map<string, FinanceSalesDaily>();
  const byBranch = new Map<string, FinanceSalesByBranch>();
  const methods = new Map<string, FinanceSalesMethod>();
  const recent: FinanceSalesRecent[] = [];
  for (const order of orders) {
    if (order.status !== "completed" || !order.payment_completed_at || !branchMap.has(order.branch_id)) continue;
    const currency = orderCurrencyFromMetadata(order.metadata);
    const billed = money(finiteMoney(order.grand_total ?? order.total_amount));
    const paidRows = paymentsByOrder.get(order.id) ?? [];
    const received = money(paidRows.reduce((sum, p) => sum + finiteMoney(p.amount), 0));
    const unmatched = Math.abs(billed - received) > (currency === "LAK" ? 0.5 : 0.01);
    const date = dateBangkok(order.payment_completed_at);
    const overall = totals.get(currency) ?? empty(currency);
    accumulate(overall, billed, received, unmatched);
    totals.set(currency, overall);

    const dayKey = date + ":" + currency;
    const day = daily.get(dayKey) ?? { date, ...empty(currency) };
    accumulate(day, billed, received, unmatched);
    daily.set(dayKey, day);

    const branch = branchMap.get(order.branch_id)!;
    const branchKey = order.branch_id + ":" + currency;
    const branchRow = byBranch.get(branchKey) ?? {
      branchId: branch.id, branchName: branch.name, ...empty(currency)
    };
    accumulate(branchRow, billed, received, unmatched);
    byBranch.set(branchKey, branchRow);

    const orderMethods = new Set<string>();
    for (const payment of paidRows) {
      const methodName = String(payment.method || "unknown").trim().slice(0, 60) || "unknown";
      orderMethods.add(methodName);
      const key = currency + ":" + methodName;
      const method = methods.get(key) ?? { currency, method: methodName, received: 0, transactions: 0 };
      method.received = money(method.received + finiteMoney(payment.amount));
      method.transactions++;
      methods.set(key, method);
    }
    recent.push({
      orderId: order.id, orderNo: order.order_no || order.id,
      branchId: branch.id, branchName: branch.name,
      completedAt: order.payment_completed_at, currency, billed, received,
      methods: [...orderMethods], unmatched
    });
  }
  return {
    totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency)),
    byBranch: [...byBranch.values()].sort((a, b) => a.branchName.localeCompare(b.branchName) || a.currency.localeCompare(b.currency)),
    methods: [...methods.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.method.localeCompare(b.method)),
    records: recent.sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.orderId.localeCompare(a.orderId)),
    recent: recent.slice(0, 50)
  };
}


export type FinanceReconciliationFilter = "all" | "matched" | "unmatched" | "missing_payment";
export type FinanceSalesRecordFilters = {
  billNo: string;
  method: string;
  reconciliation: FinanceReconciliationFilter;
  page: number;
  pageSize: number;
};
export function parseFinanceSalesRecordFilters(raw: {
  billNo: string | null;
  method: string | null;
  reconciliation: string | null;
  page: string | null;
  pageSize: string | null;
}): FinanceSalesRecordFilters {
  const billNo = (raw.billNo ?? "").trim();
  const method = (raw.method ?? "all").trim();
  const reconciliation = raw.reconciliation ?? "all";
  const pageRaw = raw.page ?? "1";
  const sizeRaw = raw.pageSize ?? "20";
  if (billNo.length > 80 || method.length > 60 || !method ||
    !["all", "matched", "unmatched", "missing_payment"].includes(reconciliation) ||
    !/^[1-9]\d{0,3}$/.test(pageRaw) || !["20", "50"].includes(sizeRaw)) {
    throw new Error("finance_invalid_record_filter");
  }
  return {
    billNo, method, reconciliation: reconciliation as FinanceReconciliationFilter,
    page: Number(pageRaw), pageSize: Number(sizeRaw)
  };
}

export type FinanceSalesRecordsPage = {
  rows: FinanceSalesRecent[];
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
/** Filter the FULL authorized period, not the recent-50 preview. Totals in the
 * financial dashboard are independently calculated for the date + branch only.
 */
export function paginateFinanceSalesRecords(
  records: readonly FinanceSalesRecent[],
  filters: FinanceSalesRecordFilters
): FinanceSalesRecordsPage {
  const bill = filters.billNo.trim().toLocaleLowerCase();
  const rows = records.filter(row => {
    if (bill && !row.orderNo.toLocaleLowerCase().includes(bill)) return false;
    if (filters.method !== "all" && !row.methods.includes(filters.method)) return false;
    if (filters.reconciliation === "matched" && row.unmatched) return false;
    if (filters.reconciliation === "unmatched" && !row.unmatched) return false;
    if (filters.reconciliation === "missing_payment" && row.methods.length > 0) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / filters.pageSize));
  const page = Math.min(filters.page, totalPages);
  return {
    rows: rows.slice((page - 1) * filters.pageSize, page * filters.pageSize),
    totalRows: rows.length,
    page, pageSize: filters.pageSize, totalPages
  };
}

export type BangkokDateRange = { from: string; to: string; startIso: string; endExclusiveIso: string };
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}
export function todayBangkok(now: Date = new Date()): string {
  return dateBangkok(now.toISOString());
}
export function parseFinanceDateRange(fromValue: string | null, toValue: string | null, now = new Date()): BangkokDateRange {
  const today = todayBangkok(now);
  const from = fromValue ?? today;
  const to = toValue ?? today;
  if (!validDate(from) || !validDate(to)) throw new Error("finance_invalid_date");
  const start = Date.parse(from + "T00:00:00+07:00");
  const end = Date.parse(to + "T00:00:00+07:00");
  if (end < start || (end - start) / 86_400_000 >= 31) throw new Error("finance_date_range_too_large");
  return {
    from, to, startIso: new Date(start).toISOString(),
    endExclusiveIso: new Date(end + 86_400_000).toISOString()
  };
}
