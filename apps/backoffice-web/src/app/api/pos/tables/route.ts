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
      ttlMs: 2000,
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
              active_order_id: activeSession?.order_id ?? null
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
              active_order_id: activeSession?.order_id ?? null
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
