import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

const sessionService = source("../../src/lib/services/buffet-table-session-service.ts");
const sessionRoute = source("../../src/app/api/pos/buffet-table/session/route.ts");
const tablesRoute = source("../../src/app/api/pos/tables/route.ts");
const tableTypes = source("../../src/components/tables/types.ts");
const tableBrowser = source("../../src/components/pos/pos-table-browser.tsx");
const buffetPicker = source("../../src/components/pos/pos-buffet-price-picker-modal.tsx");

describe("POS Buffet Table active-session contract", () => {
  it("derives buffet counts from persisted order items instead of client deltas", () => {
    expect(sessionService).toContain('.from("order_items")');
    expect(sessionService).toContain('.eq("order_id", args.orderId)');
    expect(sessionService).toContain('import { buffetPlanModeFromProduct } from "@/lib/pos-buffet-plan-product";');
    expect(sessionService).toContain("buffetPlanModeFromProduct(product)");
    expect(sessionService).toContain("modeByProductId.set(product.id, mode)");
    expect(sessionService).toContain("perPersonQuantity += quantity");
    expect(sessionService).toContain("setQuantity += quantity");
  });

  it("persists the summary only into the active table bill session metadata", () => {
    expect(sessionService).toContain('.from("table_bill_sessions")');
    expect(sessionService).toContain('.in("status", ["open", "ordering", "pending_payment"])');
    expect(sessionService).toContain("mergeBuffetTableSessionSummaryMetadata");
    expect(sessionService).toContain('.update({ metadata: nextMetadata })');
    expect(sessionService).toContain('.eq("order_id", args.orderId)');
  });

  it("syncs after a successful dine-in order event and supports lazy recovery on reopen", () => {
    expect(buffetPicker).toContain('window.addEventListener("pos:sales:order-created"');
    expect(buffetPicker).toContain('detail?.order_type !== "dine_in"');
    expect(buffetPicker).toContain('fetch("/api/pos/buffet-table/session"');
    expect(sessionRoute).toContain("syncBuffetTableSessionSummary");
    expect(sessionRoute).toContain("loadBuffetTableSessionByCode");
  });

  it("does not add an extra order-items query to the frequent table polling route", () => {
    expect(tablesRoute).toContain('.select("id,table_id,order_id,status,opened_at,metadata")');
    expect(tablesRoute).toContain("normalizeBuffetTableSessionSummary(activeSession?.metadata)");
    expect(tablesRoute).not.toContain('.from("order_items")');
  });

  it("exposes and renders active buffet status on table cards", () => {
    expect(tableTypes).toContain("buffet_summary?: BuffetTableSessionSummary");
    expect(tableBrowser).toContain("formatBuffetTableSessionLabel");
    expect(tableBrowser).toContain("table.buffet_summary");
  });

  it("reopens an existing buffet table without automatically charging another package", () => {
    expect(buffetPicker).toContain("Buffet is already open");
    expect(buffetPicker).toContain("Reopening the table does not double-charge buffet fees");
    expect(buffetPicker).toContain('`Add ${plan.name}`');
    expect(buffetPicker).toContain("sessionSummary.per_person_quantity");
    expect(buffetPicker).toContain("sessionSummary.set_quantity");
    expect(buffetPicker).toContain("Continue sale");
  });
});
