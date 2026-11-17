import { describe, expect, it } from "vitest";
import { parseFinanceDateRange, summarizeFinanceSales, paginateFinanceSalesRecords, parseFinanceSalesRecordFilters } from "../../src/lib/finance-sales-analytics";

const branches = [{ id: "b1", name: "สาขาหนึ่ง", code: "B1" }, { id: "b2", name: "สาขาสอง", code: "B2" }];
const orders = [
  { id: "1", branch_id: "b1", order_no: "001", status: "completed", grand_total: 120,
    total_amount: 150, paid_total: 120, metadata: { currency_code: "THB" }, payment_completed_at: "2026-11-16T18:00:00Z" },
  { id: "2", branch_id: "b2", order_no: "002", status: "completed", grand_total: 40,
    total_amount: 40, paid_total: 40, metadata: { currency_code: "THB" }, payment_completed_at: "2026-11-16T20:00:00Z" },
  { id: "3", branch_id: "b2", order_no: "003", status: "completed", grand_total: 9500,
    total_amount: 9500, paid_total: 9500, metadata: { currency_code: "LAK" }, payment_completed_at: "2026-11-16T23:00:00Z" },
  { id: "4", branch_id: "b1", order_no: "004", status: "cancelled", grand_total: 900,
    total_amount: 900, paid_total: 900, metadata: { currency_code: "THB" }, payment_completed_at: "2026-11-16T23:00:00Z" }
];
const payments = [
  { id: "p1", order_id: "1", status: "paid", method: "cash", amount: 70 },
  { id: "p2", order_id: "1", status: "paid", method: "bank_transfer", amount: 50 },
  { id: "p3", order_id: "2", status: "paid", method: "cash", amount: 30 },
  { id: "p4", order_id: "3", status: "paid", method: "cash", amount: 9500 },
  { id: "p5", order_id: "4", status: "paid", method: "cash", amount: 900 },
  { id: "p6", order_id: "2", status: "pending", method: "cash", amount: 10 },
  { id: "p2", order_id: "1", status: "paid", method: "bank_transfer", amount: 50 }
];

describe("Finance read-only sales analytics", () => {
  it("counts only completed orders, paid payment rows, and unique payment ids", () => {
    const result = summarizeFinanceSales(orders, payments, branches);
    expect(result.totals).toEqual([
      { currency: "LAK", bills: 1, billed: 9500, received: 9500, unmatchedBills: 0 },
      { currency: "THB", bills: 2, billed: 160, received: 150, unmatchedBills: 1 }
    ]);
    expect(result.methods.find(x => x.currency === "THB" && x.method === "cash")?.received).toBe(100);
    expect(result.byBranch.find(x => x.branchId === "b2" && x.currency === "THB")?.unmatchedBills).toBe(1);
  });
  it("reports by the Bangkok payment-completion day, not order creation", () => {
    const result = summarizeFinanceSales(orders, payments, branches);
    expect(result.daily.map(d => d.date)).toEqual(["2026-11-17", "2026-11-17"]);
    expect(result.recent.every(row => row.orderNo !== "004")).toBe(true);
    expect(result.recent.find(row => row.orderNo === "001")?.methods).toEqual(["cash", "bank_transfer"]);
  });
  it("does not invent a financial amount by combining currencies", () => {
    const result = summarizeFinanceSales(orders, payments, branches);
    expect(result.totals).toHaveLength(2);
    expect(result.totals.find(x => x.currency === "THB")?.billed).toBe(160);
    expect(result.totals.find(x => x.currency === "LAK")?.billed).toBe(9500);
  });
  it("rejects impossible dates, reverse ranges and periods longer than 31 days", () => {
    expect(() => parseFinanceDateRange("2026-02-31", "2026-02-28")).toThrow("finance_invalid_date");
    expect(() => parseFinanceDateRange("2026-11-18", "2026-11-17")).toThrow("finance_date_range_too_large");
    expect(() => parseFinanceDateRange("2026-09-01", "2026-10-02")).toThrow("finance_date_range_too_large");
    expect(parseFinanceDateRange("2026-11-17", "2026-11-17")).toMatchObject({
      startIso: "2026-11-16T17:00:00.000Z", endExclusiveIso: "2026-11-17T17:00:00.000Z"
    });
  });
  it("filters from every authorized completed order and paginates without changing summary totals", () => {
    const summary = summarizeFinanceSales(orders, payments, branches);
    expect(summary.records).toHaveLength(3);
    const options = { billNo: "", method: "all", reconciliation: "all" as const, page: 1, pageSize: 2 };
    const first = paginateFinanceSalesRecords(summary.records, options);
    expect(first.totalRows).toBe(3);
    expect(first.totalPages).toBe(2);
    expect(first.rows.map(row => row.orderNo)).toEqual(["003", "002"]);
    const second = paginateFinanceSalesRecords(summary.records, { ...options, page: 2 });
    expect(second.rows.map(row => row.orderNo)).toEqual(["001"]);
    expect(paginateFinanceSalesRecords(summary.records, { ...options, billNo: "001" }).rows).toHaveLength(1);
    expect(paginateFinanceSalesRecords(summary.records, { ...options, method: "bank_transfer" }).rows.map(row => row.orderNo)).toEqual(["001"]);
    expect(paginateFinanceSalesRecords(summary.records, { ...options, reconciliation: "unmatched" }).rows.map(row => row.orderNo)).toEqual(["002"]);
    expect(paginateFinanceSalesRecords(summary.records, { ...options, reconciliation: "matched" }).totalRows).toBe(2);
    expect(summary.totals.find(row => row.currency === "THB")?.billed).toBe(160);
  });

  it("validates untrusted table filter and page input before server reads", () => {
    const base = { billNo: " 001 ", method: null, reconciliation: null, page: null, pageSize: null };
    expect(parseFinanceSalesRecordFilters(base)).toEqual({
      billNo: "001", method: "all", reconciliation: "all", page: 1, pageSize: 20
    });
    expect(() => parseFinanceSalesRecordFilters({ ...base, reconciliation: "cancelled" })).toThrow("finance_invalid_record_filter");
    expect(() => parseFinanceSalesRecordFilters({ ...base, page: "-1" })).toThrow("finance_invalid_record_filter");
    expect(() => parseFinanceSalesRecordFilters({ ...base, page: "10000" })).toThrow("finance_invalid_record_filter");
    expect(() => parseFinanceSalesRecordFilters({ ...base, pageSize: "999" })).toThrow("finance_invalid_record_filter");
    expect(() => parseFinanceSalesRecordFilters({ ...base, billNo: "x".repeat(81) })).toThrow("finance_invalid_record_filter");
  });

});
