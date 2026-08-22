import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const kitchenService = source("../../src/lib/services/kitchen-queue-service.ts");
const kdsSource = source("../../src/components/kitchen/kitchen-kds.tsx");
const cancelRouteSource = source("../../src/app/api/pos/kitchen/tickets/[ticketId]/items/[itemId]/cancel/route.ts");
const tableQrOrdering = source("../../src/lib/table-qr-ordering.ts");
const tableQrMobile = source("../../src/components/table-order/table-order-mobile.tsx");
const tableQrMobileCss = source("../../src/components/table-order/table-order-mobile.module.css");
const migration = source("../../../../supabase/migrations/20260822020331_kitchen_qr_line_cancel_sync.sql");
const trialMigration = source("../../../../supabase/trial-data-plane/migrations/20260822020331_trial_kitchen_qr_line_cancel_sync.sql");

describe("FG0003 kitchen QR line cancellation and print priority regression", () => {
  it("lets KDS cancel one accepted line through a tenant/branch scoped API", () => {
    expect(cancelRouteSource).toContain("cancelKitchenTicketItem");
    expect(cancelRouteSource).toContain("getKitchenApiAuthContext");
    expect(cancelRouteSource).toContain('requiredPermission: "sales:view"');
    expect(kdsSource).toContain("async function cancelItem(ticket: KitchenTicket, item: KitchenItem)");
    expect(kdsSource).toContain("kds_item_cancel");
    expect(kdsSource).toContain("/cancel");
    expect(kdsSource).toContain('item.action !== "cancel"');
    expect(kitchenService).toContain("export async function cancelKitchenTicketItem");
    expect(kitchenService).toContain('.eq("tenant_id", args.auth.tenantId)');
    expect(kitchenService).toContain('.eq("branch_id", args.auth.branchId)');
    expect(kitchenService).toContain('supabase.rpc("replace_queued_dine_in_order_tx"');
    expect(kitchenService).toContain("kds_line_cancelled");
    expect(kitchenService).toContain("kitchen_ticket_item_cancelled");
    expect(kitchenService).toContain("invalidatePosBranchRuntimeCaches");
    expect(kitchenService).toContain('row.action !== "cancel"');
  });

  it("keeps cancelled submitted lines visible on customer QR with zeroed totals", () => {
    expect(tableQrOrdering).toContain("bill_line_state");
    expect(tableQrOrdering).toContain("cancelled_quantity");
    expect(tableQrOrdering).toContain('status: "active" | "cancelled"');
    expect(tableQrOrdering).toContain('item.status === "active"');
    expect(tableQrMobile).toContain('status?: "active" | "cancelled"');
    expect(tableQrMobile).toContain("submittedModalRowCancelled");
    expect(tableQrMobile).toContain('item.status === "cancelled"');
    expect(tableQrMobileCss).toContain(".submittedModalRowCancelled");
  });

  it("allows all active queued dine-in lines to be replaced by an empty array", () => {
    expect(migration).toContain("Empty desired item arrays are allowed");
    expect(migration).toContain("synchronizes QR totals to zero");
    expect(migration).not.toContain("if v_item_count < 1 then raise exception 'ITEMS_REQUIRED'; end if;");
    expect(trialMigration).toContain("Trial mirror: FG0003 kitchen/QR/receipt hardening");
    expect(trialMigration).not.toContain("if v_item_count < 1 then raise exception 'ITEMS_REQUIRED'; end if;");
  });

  it("prioritizes receipt and payment notice jobs ahead of kitchen queue jobs", () => {
    expect(migration).toContain("document_type', '') in ('payment_notice', 'sales_receipt', 'receipt') then 1");
    expect(migration).toContain("request_source', '') in ('pos_payment', 'pos_payment_notice', 'pos_receipt_modal', 'receipt_history_reprint') then 1");
    expect(migration).toContain("when pj.printer_role = 'receipt' then 2");
    expect(migration).toContain("when pj.printer_role = 'kitchen' then 3");
    expect(trialMigration).toContain("pos_payment_notice");
    expect(trialMigration).toContain("when pj.printer_role = 'kitchen' then 3");
  });
});
