import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { getRoutedSupabaseServiceClient } from "@/lib/tenant-data-router";

export async function GET(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:view" });
    const { searchParams } = new URL(request.url);
    const sinceRaw = searchParams.get("since")?.trim() || new Date(Date.now() - 15_000).toISOString();
    const since = Number.isFinite(new Date(sinceRaw).getTime()) ? new Date(sinceRaw).toISOString() : new Date(Date.now() - 15_000).toISOString();
    const supabase = getRoutedSupabaseServiceClient();

    const { data: rows, error } = await supabase
      .from("table_qr_orders")
      .select("id,table_id,event_type,item_count,subtotal,created_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);

    const tableIds = Array.from(new Set((rows ?? []).map((row: { table_id?: string }) => String(row.table_id ?? "")).filter(Boolean)));
    const tableResult = tableIds.length
      ? await supabase
          .from("dining_tables")
          .select("id,table_code,table_name")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .in("id", tableIds)
      : { data: [], error: null };
    if (tableResult.error) throw new Error(tableResult.error.message);

    const tableById = new Map((tableResult.data ?? []).map((table: { id: string; table_code: string; table_name: string | null }) => [table.id, table]));
    const events = (rows ?? []).map((row: { id: string; table_id: string; event_type: string; item_count: number | null; subtotal: number | null; created_at: string }) => ({
      ...row,
      table: tableById.get(row.table_id) ?? null
    }));

    return ok({ events, cursor: events.at(-1)?.created_at ?? since, server_time: new Date().toISOString() });
  } catch (error) {
    return fail("table_qr_activity_failed", error instanceof Error ? error.message : "Unable to load table QR activity.", 500);
  }
}
