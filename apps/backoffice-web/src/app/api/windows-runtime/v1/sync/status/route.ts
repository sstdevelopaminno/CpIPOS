import { ok } from "@/lib/http";
import { buildWindowsRuntimeBootstrap } from "@/lib/windows-runtime/entitlements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const payload = buildWindowsRuntimeBootstrap({});
  return ok({
    contract_version: payload.contract_version,
    server_time: payload.server_time,
    sync: {
      ...payload.sync,
      phase: "offline_database_foundation",
      live_order_sync: "not_enabled_yet",
      next_required_endpoints: [
        "POST /api/windows-runtime/v1/sync/orders",
        "POST /api/windows-runtime/v1/sync/payments",
        "POST /api/windows-runtime/v1/sync/print-jobs",
        "GET /api/windows-runtime/v1/sync/pull-catalog"
      ]
    }
  });
}
