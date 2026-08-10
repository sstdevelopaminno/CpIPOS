import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const primaryMigration = readFileSync(
  new URL("../../../../supabase/migrations/20260810220000_kitchen_item_lifecycle_and_payment_gate.sql", import.meta.url),
  "utf8"
);
const trialMigration = readFileSync(
  new URL("../../../../supabase/trial-data-plane/migrations/20260810220000_trial_kitchen_item_lifecycle_and_payment_gate.sql", import.meta.url),
  "utf8"
);
const kitchenQueueService = readFileSync(new URL("../../src/lib/services/kitchen-queue-service.ts", import.meta.url), "utf8");
const kitchenKds = readFileSync(new URL("../../src/components/kitchen/kitchen-kds.tsx", import.meta.url), "utf8");
const kdsSettingsService = readFileSync(new URL("../../src/lib/services/kitchen-kds-settings-service.ts", import.meta.url), "utf8");

describe("Kitchen item lifecycle and dine-in payment gate", () => {
  it("keeps Primary and Trial lifecycle migrations aligned on safety contracts", () => {
    for (const migration of [primaryMigration, trialMigration]) {
      expect(migration).toContain("add column if not exists kds_enabled boolean not null default true");
      expect(migration).toContain("add column if not exists queue_no integer");
      expect(migration).toContain("kitchen_ticket_items_status_check");
      expect(migration).toContain("'queued','accepted','ready','cancelled'");
      expect(migration).toContain("assign_kitchen_ticket_queue_no");
      expect(migration).toContain("Asia/Bangkok");
      expect(migration).toContain("KITCHEN_ITEM_LOCKED");
      expect(migration).toContain("new.quantity < old.quantity");
      expect(migration).toContain("apply_kitchen_cancel_delta");
      expect(migration).toContain("set_kitchen_item_status");
      expect(migration).toContain("KITCHEN_ITEM_MUST_BE_ACCEPTED");
      expect(migration).toContain("assert_dine_in_kitchen_ready_for_completion");
      expect(migration).toContain("KITCHEN_NOT_READY");
      expect(migration).toContain("kz.kds_enabled = true");
    }
  });

  it("persists KDS item actions through a branch-scoped server path", () => {
    expect(kitchenQueueService).toContain('export type KitchenItemStatus = "queued" | "accepted" | "ready" | "cancelled"');
    expect(kitchenQueueService).toContain("transitionKitchenItemStatus");
    expect(kitchenQueueService).toContain('.eq("tenant_id", args.auth.tenantId)');
    expect(kitchenQueueService).toContain('.eq("branch_id", args.auth.branchId)');
    expect(kitchenQueueService).toContain('.eq("status", expectedStatus)');
    expect(kitchenQueueService).toContain('action: "kitchen_item_status_changed"');
  });

  it("shows table, queue, time and same-table additional batches on the ticket board", () => {
    expect(kitchenKds).toContain("table.table_code");
    expect(kitchenKds).toContain("queueLabel");
    expect(kitchenKds).toContain('timeZone: "Asia/Bangkok"');
    expect(kitchenKds).toContain("+ เพิ่มรายการอาหาร");
    expect(kitchenKds).toContain("/api/pos/kitchen/items/${item.id}/status");
    expect(kitchenKds).toContain('item.status === "queued" ? "รับออเดอร์" : "พร้อมเสิร์ฟ"');
  });

  it("supports explicit no-KDS zones without weakening tenant/branch scope", () => {
    expect(kdsSettingsService).toContain("setKitchenZoneKdsEnabled");
    expect(kdsSettingsService).toContain('.eq("tenant_id", tenantId)');
    expect(kdsSettingsService).toContain('.eq("branch_id", branchId)');
    expect(kdsSettingsService).toContain("kds_enabled: enabled");
  });
});
