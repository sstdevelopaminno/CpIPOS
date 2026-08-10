import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tableOrderRoute = readFileSync(new URL("../../src/app/api/table-order/[token]/route.ts", import.meta.url), "utf8");
const tableQrOrdering = readFileSync(new URL("../../src/lib/table-qr-ordering.ts", import.meta.url), "utf8");
const tableOrderMobile = readFileSync(new URL("../../src/components/table-order/table-order-mobile.tsx", import.meta.url), "utf8");
const tableService = readFileSync(new URL("../../src/lib/services/table-service.ts", import.meta.url), "utf8");
const posSalesRoute = readFileSync(new URL("../../src/app/api/pos/sales/route.ts", import.meta.url), "utf8");
const posSalesService = readFileSync(new URL("../../src/lib/services/pos-sales-service.ts", import.meta.url), "utf8");
const posSalesErrors = readFileSync(new URL("../../src/components/pos/pos-sales-errors.ts", import.meta.url), "utf8");
const posSalesModule = readFileSync(new URL("../../src/components/pos/pos-sales-module.tsx", import.meta.url), "utf8");
const tenantRouter = readFileSync(new URL("../../src/lib/tenant-data-router.ts", import.meta.url), "utf8");
const primaryMigration = readFileSync(new URL("../../../../supabase/migrations/20260810075709_table_order_concurrency_dinein_sync.sql", import.meta.url), "utf8");
const trialMigration = readFileSync(new URL("../../../../supabase/trial-data-plane/migrations/20260810075709_trial_table_order_concurrency_dinein_sync.sql", import.meta.url), "utf8");

describe("Table order concurrency and dine-in bill sync hardening", () => {
  it("separates public Table QR menu/status/write rate limit lanes", () => {
    expect(tableOrderRoute).toContain('lane: "menu" | "status" | "write"');
    expect(tableOrderRoute).toContain('"table_order_public_write_session"');
    expect(tableOrderRoute).toContain('"table_order_public_read_session"');
    expect(tableOrderRoute).toContain("`table_order_public_${lane}`");
    expect(tableOrderRoute).toContain('url.searchParams.get("view") === "status"');
    expect(tableOrderRoute).toContain('checkRateLimit(request, token, "write")');
  });

  it("polls lightweight status without replacing local cart/menu catalog", () => {
    expect(tableOrderMobile).toContain('const statusUrl = useMemo(() => `${apiUrl}?view=status`, [apiUrl]);');
    expect(tableOrderMobile).toContain('"x-table-order-client-id"');
    expect(tableOrderMobile).toContain("applyStatusData");
    expect(tableOrderMobile).toContain("categories: current.categories ?? []");
    expect(tableOrderMobile).toContain("products: current.products ?? []");
  });

  it("uses Kitchen Core database triggers for normal QR orders", () => {
    expect(tableQrOrdering).toContain("export async function loadTableQrState");
    expect(tableQrOrdering).toContain("server_revision");
    expect(tableQrOrdering).not.toContain("enqueueKitchenTicketForOrderSnapshot");
  });

  it("routes dine-in queued edits and empty bill cancellation through database RPCs", () => {
    expect(posSalesRoute).toContain("replace_queued_dine_in_order_tx");
    expect(posSalesRoute).toContain('normalizedBody.order_type !== "dine_in"');
    expect(posSalesRoute).not.toContain('table_id: body.order_type === "dine_in"');
    expect(tableService).toContain("cancel_empty_table_bill_session_tx");
    expect(tableService).toContain(".or('order_id.is.null,order_id.eq.' + orderId)");
    expect(posSalesModule).toContain("cancelEmptyOpenBill");
    expect(posSalesModule).toContain("/api/pos/tables/${table.id}/cancel-empty-bill");
    expect(posSalesModule).toContain("checkoutLabel={isEmptyOpenDineInBill ? text.cancelBill");
  });

  it("maps table bill race conflicts and reloads authoritative table state", () => {
    expect(posSalesRoute).toContain('message.includes("TABLE_BILL_ORDER_CONFLICT") ? "table_bill_order_conflict"');
    expect(posSalesService).toContain('message.includes("TABLE_BILL_ORDER_CONFLICT")');
    expect(posSalesService).toContain('code: "table_bill_order_conflict", status: 409');
    expect(posSalesErrors).toContain('code === "table_bill_order_conflict"');
    expect(posSalesErrors).toContain('code === "table_bill_not_open"');
    expect(posSalesModule).toContain('errorCode === "table_bill_order_conflict"');
    expect(posSalesModule).toContain("loadTableBillContextRef.current(table)");
  });

  it("keeps checkout loading under guaranteed error/finally handling", () => {
    expect(posSalesModule).toContain("let payload: PendingSubmit | null = null;");
    expect(posSalesModule).toContain("try {\n      const latestTaxSettings = await refreshTaxSettings();");
    expect(posSalesModule).toContain("finally {\n      setSubmitting(false);\n      checkoutRequestLockRef.current = false;");
    expect(posSalesModule).toContain("isConnectivityIssueMessage(rawMessage) && payload");
  });

  it("keeps new business RPCs routed across data planes", () => {
    expect(tenantRouter).toContain('"replace_queued_dine_in_order_tx"');
    expect(tenantRouter).toContain('"cancel_empty_table_bill_session_tx"');
    expect(tenantRouter).toContain('add("table_bill_sessions", asString(row.table_session_id))');
  });

  it("adds source-only Primary and Trial migration hardening", () => {
    for (const migration of [primaryMigration, trialMigration]) {
      expect(migration).toContain("lock_dine_in_order_table_session_before_insert");
      expect(migration).toContain("create trigger trg_lock_dine_in_order_table_session_before_insert");
      expect(migration).toContain("before insert on public.orders");
      expect(migration).toContain("for update");
      expect(migration).toContain("TABLE_BILL_NOT_OPEN");
      expect(migration).toContain("TABLE_BILL_ORDER_CONFLICT");
      expect(migration).toContain("ux_orders_one_queued_dine_in_table");
      expect(migration).toContain("bind_dine_in_order_to_table_session");
      expect(migration).toContain("create trigger trg_bind_dine_in_order_to_table_session");
      expect(migration).toContain("replace_queued_dine_in_order_tx");
      expect(migration).toContain("cancel_empty_table_bill_session_tx");
      expect(migration).toContain("revoke all on function public.replace_queued_dine_in_order_tx");
      expect(migration).toContain("grant execute on function public.cancel_empty_table_bill_session_tx");
      expect(migration).not.toContain("delete from public.order_items");
      expect(migration).not.toContain("updated_at = now()\n  from pg_temp.dine_in_target_items");
      expect(migration).toContain("bill_line_state', 'cancelled'");
      expect(migration).toContain("kitchen_delta_quantity");
      expect(migration).toContain(":pos-edit:add:");
      expect(migration).toContain(":pos-edit:cancel:");
      expect(migration).toContain("p_action in ('add','cancel') and oi.metadata ? 'kitchen_delta_quantity'");
    }
    expect(primaryMigration).toContain("with normalized_items as");
    expect(primaryMigration).not.toContain("for v_item in select value from jsonb_array_elements(p_items)");
  });
});