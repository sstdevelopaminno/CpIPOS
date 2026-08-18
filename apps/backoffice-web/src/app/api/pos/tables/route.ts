import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { fail, ok } from "@/lib/http";
import { readThroughRuntimeCache } from "@/lib/route-runtime-cache";
import { getEffectiveTableStatus, naturalCompareTableCode } from "@/lib/table-management";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import type { FloorPlanObjectType } from "@pos/shared-types";

type ZoneRow = {
  id: string;
  zone_name: string;
  color: string;
  display_order: number;
  is_active: boolean;
};

type TableRow = {
  id: string;
  zone_id: string | null;
  table_code: string;
  table_name: string | null;
  capacity: number;
  status: "available" | "occupied" | "ordering" | "pending_payment" | "reserved" | "disabled";
  shape: "square" | "rectangle" | "circle";
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  rotation: number;
  is_active: boolean;
  metadata?: Record<string, unknown>;
};

type FloorObjectRow = {
  id: string;
  zone_id: string | null;
  object_type: FloorPlanObjectType;
  object_name: string | null;
  color: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  is_active: boolean;
  metadata?: Record<string, unknown>;
};

type SessionRow = {
  id: string;
  table_id: string;
  order_id: string | null;
  status: "open" | "ordering" | "pending_payment" | "closed" | "cancelled";
  opened_at: string;
};

type QrOrderActivityRow = {
  id: string;
  table_id: string;
  table_session_id: string;
  event_type: "order" | "call_staff" | "request_checkout";
  item_count: number | null;
  subtotal: number | null;
  created_at: string;
};

type QrTableActivity = {
  latest_event_id: string | null;
  latest_event_at: string | null;
  latest_event_type: QrOrderActivityRow["event_type"] | null;
  order_event_count: number;
  pending_item_count: number;
  subtotal: number;
};

type LegacyTableRow = {
  id: string;
  table_code: string;
  seats: number;
  is_active: boolean;
};

function isMissingRelationError(error: { message?: string; code?: string } | null | undefined, relationName: string): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  const relation = relationName.toLowerCase();
  return error.code === "42P01" || (message.includes(relation) && message.includes("does not exist"));
}

function emptyQrActivity(): QrTableActivity {
  return {
    latest_event_id: null,
    latest_event_at: null,
    latest_event_type: null,
    order_event_count: 0,
    pending_item_count: 0,
    subtotal: 0
  };
}

export async function GET() {
  const startedAt = Date.now();
  const withTiming = (response: Response) => {
    response.headers.set("x-pos-tables-ms", String(Date.now() - startedAt));
    return response;
  };
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "tables:view" });
    await requirePosApiFeature(auth, "table_management");

    const cacheKey = `pos-tables:${auth.tenantId}:${auth.branchId}`;
    const { value: payload, source: cacheSource } = await readThroughRuntimeCache({
      key: cacheKey,
      // The POS polls table state every 5s/7s. A 5s TTL expired on the same boundary,
      // turning nearly every poll into a cold multi-query load. Keep one poll inside
      // the fresh window so warm instances can absorb idle refreshes without slowing
      // explicit action/focus refreshes or the independent QR activity channel.
      ttlMs: 8000,
      staleIfErrorMs: 15000,
      loader: async () => {
        const supabase = getSupabaseServiceClient();
        const [zoneResult, sessionResult, tableResult, objectResult] = await Promise.all([
          supabase
            .from("table_zones")
            .select("id,zone_name,color,display_order,is_active")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .eq("is_active", true)
            .order("display_order", { ascending: true })
            .order("zone_name", { ascending: true }),
          supabase
            .from("table_bill_sessions")
            .select("id,table_id,order_id,status,opened_at")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .in("status", ["open", "ordering", "pending_payment"])
            .order("opened_at", { ascending: false }),
          supabase
            .from("dining_tables")
            .select("id,zone_id,table_code,table_name,capacity,status,shape,position_x,position_y,width,height,rotation,is_active")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .order("table_code", { ascending: true }),
          supabase
            .from("table_layout_objects")
            .select("id,zone_id,object_type,object_name,color,position_x,position_y,width,height,rotation,z_index,is_active,metadata")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .eq("is_active", true)
            .order("z_index", { ascending: true })
            .order("object_name", { ascending: true })
        ]);

        const zones = zoneResult.data;
        const zoneError = zoneResult.error;
        const sessions = sessionResult.data;
        const sessionError = sessionResult.error;
        const tables = tableResult.data;
        const tableError = tableResult.error;
        const objects = objectResult.data;
        const objectError = objectResult.error;

        if (zoneError && !isMissingRelationError(zoneError, "table_zones")) {
          throw new Error(`zone_query_failed:${zoneError.message}`);
        }

        if (sessionError && !isMissingRelationError(sessionError, "table_bill_sessions")) {
          throw new Error(`session_query_failed:${sessionError.message}`);
        }

        const activeSessionMap = new Map<string, SessionRow>();
        for (const session of ((sessionError ? [] : sessions) ?? []) as SessionRow[]) {
          if (!activeSessionMap.has(session.table_id)) {
            activeSessionMap.set(session.table_id, session);
          }
        }

        const activeSessionIds = Array.from(activeSessionMap.values()).map((session) => session.id);
        const qrActivityByTable = new Map<string, QrTableActivity>();
        if (activeSessionIds.length > 0) {
          const { data: qrRows, error: qrError } = await supabase
            .from("table_qr_orders")
            .select("id,table_id,table_session_id,event_type,item_count,subtotal,created_at")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .in("table_session_id", activeSessionIds)
            .order("created_at", { ascending: false })
            .limit(250);

          if (qrError && !isMissingRelationError(qrError, "table_qr_orders")) {
            throw new Error(`table_qr_activity_query_failed:${qrError.message}`);
          }

          for (const row of ((qrError ? [] : qrRows) ?? []) as QrOrderActivityRow[]) {
            const current = qrActivityByTable.get(row.table_id) ?? emptyQrActivity();
            if (!current.latest_event_at || new Date(row.created_at).getTime() > new Date(current.latest_event_at).getTime()) {
              current.latest_event_id = row.id;
              current.latest_event_at = row.created_at;
              current.latest_event_type = row.event_type;
            }
            if (row.event_type === "order") {
              current.order_event_count += 1;
              current.pending_item_count += Math.max(0, Number(row.item_count ?? 0));
              current.subtotal = Number((current.subtotal + Math.max(0, Number(row.subtotal ?? 0))).toFixed(2));
            }
            qrActivityByTable.set(row.table_id, current);
          }
        }

        if (tableError && !isMissingRelationError(tableError, "dining_tables")) {
          throw new Error(`table_query_failed:${tableError.message}`);
        }

        if (objectError && !isMissingRelationError(objectError, "table_layout_objects")) {
          throw new Error(`object_query_failed:${objectError.message}`);
        }

        const activeObjects = ((objectError ? [] : objects) ?? []) as FloorObjectRow[];

        if (tableError && isMissingRelationError(tableError, "dining_tables")) {
          const { data: legacyTables, error: legacyError } = await supabase
            .from("dine_in_tables")
            .select("id,table_code,seats,is_active")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .order("table_code", { ascending: true });

          if (legacyError) {
            throw new Error(`legacy_table_query_failed:${legacyError.message}`);
          }

          const mappedLegacyTables = ((legacyTables ?? []) as LegacyTableRow[]).map((table) => {
            const activeSession = activeSessionMap.get(table.id) ?? null;
            return {
              id: table.id,
              zone_id: null,
              table_code: table.table_code,
              table_name: table.table_code,
              capacity: Number(table.seats ?? 0),
              status: getEffectiveTableStatus({
                isActive: Boolean(table.is_active),
                baseStatus: "available",
                sessionStatus: activeSession?.status ?? null
              }),
              shape: "rectangle" as const,
              position_x: 0,
              position_y: 0,
              width: 96,
              height: 72,
              rotation: 0,
              is_active: Boolean(table.is_active),
              metadata: {},
              active_session_id: activeSession?.id ?? null,
              active_order_id: activeSession?.order_id ?? null,
              qr_activity: qrActivityByTable.get(table.id) ?? emptyQrActivity()
            };
          });

          return {
            zones: ((zoneError ? [] : zones) ?? []) as ZoneRow[],
            tables: mappedLegacyTables,
            objects: activeObjects
          };
        }

        const sortedTables = ((tables ?? []) as TableRow[])
          .map((table) => {
            const activeSession = activeSessionMap.get(table.id) ?? null;
            return {
              ...table,
              status: getEffectiveTableStatus({
                isActive: table.is_active,
                baseStatus: table.status,
                sessionStatus: activeSession?.status ?? null
              }),
              active_session_id: activeSession?.id ?? null,
              active_order_id: activeSession?.order_id ?? null,
              qr_activity: qrActivityByTable.get(table.id) ?? emptyQrActivity()
            };
          })
          .sort((a, b) => naturalCompareTableCode(a.table_code, b.table_code));

        return {
          zones: ((zoneError ? [] : zones) ?? []) as ZoneRow[],
          tables: sortedTables,
          objects: activeObjects
        };
      }
    });

    const response = ok(payload);
    response.headers.set("x-pos-tables-cache", cacheSource);
    return withTiming(response);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return withTiming(featureError);
    const message = error instanceof Error ? error.message : "Authentication failed.";
    if (typeof message === "string") {
      if (message.startsWith("zone_query_failed:")) return withTiming(fail("zone_query_failed", message.slice("zone_query_failed:".length), 500));
      if (message.startsWith("session_query_failed:")) return withTiming(fail("session_query_failed", message.slice("session_query_failed:".length), 500));
      if (message.startsWith("table_query_failed:")) return withTiming(fail("table_query_failed", message.slice("table_query_failed:".length), 500));
      if (message.startsWith("object_query_failed:")) return withTiming(fail("object_query_failed", message.slice("object_query_failed:".length), 500));
      if (message.startsWith("legacy_table_query_failed:")) {
        return withTiming(fail("legacy_table_query_failed", message.slice("legacy_table_query_failed:".length), 500));
      }
    }
    return withTiming(fail("unauthorized", message, 401));
  }
}
