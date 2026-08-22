import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("production stabilization audit guardrails", () => {
  it("expires active Table QR sessions during paid dine-in cleanup", () => {
    const route = source("apps/backoffice-web/src/app/api/pos/payments/route.ts");
    expect(route).toContain('.from("table_qr_sessions")');
    expect(route).toContain('.update({ status: "expired" })');
    expect(route).toContain('table_qr_expire_failed');
    expect(route).toContain('table_cleanup_ok');
  });

  it("hides paid/closed dine-in orders from the active kitchen queue without deleting history", () => {
    const kitchenQueue = source("apps/backoffice-web/src/lib/services/kitchen-queue-service.ts");
    expect(kitchenQueue).toContain('const TERMINAL_ORDER_STATUSES = new Set(["paid", "closed", "cleared", "completed", "cancelled"])');
    expect(kitchenQueue).toContain('String(row.order_type ?? "") === "dine_in"');
    expect(kitchenQueue).toContain('return !isClosedDineIn');
  });

  it("moves table bills through one transactional RPC and preserves the bill session", () => {
    const route = source("apps/backoffice-web/src/app/api/pos/tables/[tableId]/move-bill/route.ts");
    const migration = source("supabase/migrations/20260822143729_table_lifecycle_move_and_paid_cleanup.sql");
    expect(route).toContain('supabase.rpc("move_table_bill_session_tx"');
    expect(route).not.toContain('.from("orders")');
    expect(migration).toContain('create or replace function app.move_table_bill_session_tx');
    expect(migration).toContain('if p_source_table_id = p_target_table_id then');
    expect(migration).toContain('update public.table_bill_sessions s');
    expect(migration).not.toContain('insert into public.table_bill_sessions');
    expect(migration).toContain('update public.table_qr_sessions qs');
    expect(migration).toContain("raise exception 'TARGET_TABLE_OCCUPIED'");
    expect(migration).toContain('update public.kitchen_tickets kt');
  });

  it("bounds Product Management catalog mutations so UI busy state can recover", () => {
    const table = source("apps/backoffice-web/src/components/pos-preview/stock-products-table.tsx");
    expect(table).toContain('import { fetchWithTimeout } from "@/lib/client-fetch";');
    const mutationCalls = table.match(/fetchWithTimeout\("\/api\/backoffice\/catalog"/g) ?? [];
    const timeouts = table.match(/}, 20000\);/g) ?? [];
    expect(mutationCalls.length).toBeGreaterThanOrEqual(8);
    expect(timeouts.length).toBeGreaterThanOrEqual(mutationCalls.length);
    expect(table).not.toContain('await fetch("/api/backoffice/catalog"');
  });

  it("keeps store owner visible in POS user management lists", () => {
    const route = source("apps/backoffice-web/src/app/api/pos/users/route.ts");
    expect(route).toContain('const rows = rawRows;');
    expect(route).not.toContain('rawRows.filter((row) => row.role !== "owner")');
    expect(route).toContain('can_edit: canActorEditTarget');
    expect(route).toContain('can_delete: canActorDelete');
  });
});