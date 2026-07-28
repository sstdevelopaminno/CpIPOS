import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(workspaceRoot, "supabase/migrations/202606070002_table_qr_ordering.sql"),
  "utf8"
);
const serviceRequestMigration = readFileSync(
  resolve(workspaceRoot, "supabase/migrations/202606080001_table_qr_service_requests.sql"),
  "utf8"
);
const notificationSettingsMigration = readFileSync(
  resolve(workspaceRoot, "supabase/migrations/202606080002_pos_notification_settings.sql"),
  "utf8"
);
const publicRpcWrapperMigration = readFileSync(
  resolve(workspaceRoot, "supabase/migrations/202606080003_table_qr_order_public_rpc_wrapper.sql"),
  "utf8"
);
const posSalesRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/pos/sales/route.ts"),
  "utf8"
);
const publicRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/table-order/[token]/route.ts"),
  "utf8"
);
const qrService = readFileSync(
  resolve(process.cwd(), "src/lib/table-qr-ordering.ts"),
  "utf8"
);

describe("table QR ordering isolation", () => {
  it("binds QR sessions and submissions to tenant, branch, table, and table session", () => {
    expect(migration).toContain("tenant_id uuid not null");
    expect(migration).toContain("branch_id uuid not null");
    expect(migration).toContain("table_id uuid not null");
    expect(migration).toContain("table_session_id uuid not null");
    expect(migration).toContain("and tenant_id = v_qr.tenant_id");
    expect(migration).toContain("and branch_id = v_qr.branch_id");
    expect(migration).toContain("and table_id = v_qr.table_id");
  });

  it("revokes links on bill close and prevents duplicate customer submits", () => {
    expect(migration).toContain("trg_table_bill_session_revoke_qr");
    expect(migration).toContain("new.status in ('closed', 'cancelled')");
    expect(migration).toContain("unique (qr_session_id, request_id)");
    expect(migration).toContain("for update");
  });

  it("does not trust public prices or scope values", () => {
    expect(publicRoute).not.toContain("unit_price");
    expect(publicRoute).not.toContain("tenant_id:");
    expect(publicRoute).not.toContain("branch_id:");
    expect(qrService).toContain('createHmac("sha256"');
    expect(qrService).toContain('readRequiredEnv("TABLE_QR_SIGNING_SECRET"');
    expect(qrService).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(migration).toContain("from products p");
    expect(migration).toContain("p.tenant_id = v_qr.tenant_id");
    expect(migration).toContain("p.branch_id = v_qr.branch_id");
    expect(qrService).toContain('rpc("submit_table_qr_order_tx"');
    expect(publicRpcWrapperMigration).toContain("public.submit_table_qr_order_tx");
    expect(publicRpcWrapperMigration).toContain("app.submit_table_qr_order_tx($1, $2, $3, $4)");
    expect(publicRpcWrapperMigration).toContain("grant execute on function public.submit_table_qr_order_tx(uuid, text, jsonb, text) to service_role");
  });

  it("stores table service requests without creating fake order items", () => {
    expect(serviceRequestMigration).toContain("event_type");
    expect(serviceRequestMigration).toContain("alter column order_id drop not null");
    expect(serviceRequestMigration).toContain("call_staff");
    expect(serviceRequestMigration).toContain("request_checkout");
    expect(publicRoute).toContain("submitTableQrServiceRequest");
    expect(publicRoute).toContain("action === \"call_staff\"");
    expect(qrService).toContain("submitTableQrServiceRequest");
    expect(qrService).toContain("item_count: 0");
  });

  it("keeps QR service alert settings branch scoped and available to POS sales", () => {
    expect(notificationSettingsMigration).toContain("tenant_pos_notification_settings");
    expect(notificationSettingsMigration).toContain("tenant_id uuid not null");
    expect(notificationSettingsMigration).toContain("branch_id uuid not null");
    expect(notificationSettingsMigration).toContain("primary key (tenant_id, branch_id)");
    expect(notificationSettingsMigration).toContain("table_qr_popup_enabled");
    expect(notificationSettingsMigration).toContain("table_qr_sound_enabled");
    expect(posSalesRoute).toContain("loadPosNotificationSettings");
    expect(posSalesRoute).toContain("notification_settings");
  });
});
