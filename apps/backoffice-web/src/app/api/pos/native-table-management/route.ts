import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type CreatePayload = {
  action?: "create" | "bulk_create";
  zone_name?: string | null;
  table_name?: string | null;
  capacity?: number | null;
  count?: number | null;
};

function clean(value: unknown, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

async function requireNativeTableScope() {
  const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "tables:manage" });
  await requirePosApiFeature(auth, "table_management");
  const scope = await requirePosSession();
  if (scope.session.tenant_id !== auth.tenantId || scope.session.branch_id !== auth.branchId) {
    throw new Error("pos_scope_mismatch");
  }
  if (scope.session.role !== "owner" && scope.session.role !== "manager") {
    throw new Error("forbidden_role");
  }
  return { auth, scope };
}

async function nextTableCode(tenantId: string, branchId: string) {
  const db = getSupabaseServiceClient();
  const rpc = await db.rpc("next_dining_table_code", {
    p_tenant_id: tenantId,
    p_branch_id: branchId
  });
  if (!rpc.error && typeof rpc.data === "string" && rpc.data.trim()) {
    return rpc.data.trim();
  }

  const fallback = await db
    .from("dining_tables")
    .select("table_code")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId);
  if (fallback.error) throw new Error("table_code_generate_failed");

  let max = 0;
  for (const row of fallback.data ?? []) {
    const groups = String(row.table_code ?? "").match(/\d+/g);
    const last = groups?.[groups.length - 1];
    if (!last) continue;
    const number = Number(last);
    if (Number.isFinite(number) && number > max) max = number;
  }
  return String(max + 1);
}

async function resolveZone(args: {
  tenantId: string;
  branchId: string;
  actorUserId: string;
  actorRole: "owner" | "manager";
  zoneName: string;
}) {
  const { tenantId, branchId, actorUserId, actorRole, zoneName } = args;
  if (!zoneName) return { zoneId: null as string | null, createdZoneId: null as string | null };
  const db = getSupabaseServiceClient();

  const existing = await db
    .from("table_zones")
    .select("id,zone_name")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .ilike("zone_name", zoneName)
    .limit(1)
    .maybeSingle<{ id: string; zone_name: string }>();
  if (existing.error) throw new Error("zone_lookup_failed");
  if (existing.data) return { zoneId: existing.data.id, createdZoneId: null };

  const order = await db
    .from("table_zones")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId);
  if (order.error) throw new Error("zone_count_failed");

  const created = await db
    .from("table_zones")
    .insert({
      tenant_id: tenantId,
      branch_id: branchId,
      zone_name: zoneName,
      color: "#0ea5e9",
      display_order: Number(order.count ?? 0) + 1,
      is_active: true
    })
    .select("id,zone_name")
    .single<{ id: string; zone_name: string }>();
  if (created.error || !created.data) throw new Error("zone_create_failed");

  await appendAuditLog({
    tenantId,
    branchId,
    actorUserId,
    actorRole,
    action: "table_zone_created",
    targetTable: "table_zones",
    targetId: created.data.id,
    metadata: { zone_name: created.data.zone_name, source: "native_pos_2" }
  });

  return { zoneId: created.data.id, createdZoneId: created.data.id };
}

export async function POST(request: Request) {
  let createdZoneId: string | null = null;
  const createdIds: string[] = [];
  try {
    const { auth, scope } = await requireNativeTableScope();
    const tenantId = auth.tenantId!;
    const branchId = auth.branchId!;
    const body = (await request.json().catch(() => null)) as CreatePayload | null;
    const action = body?.action === "bulk_create" ? "bulk_create" : "create";
    const requestedCount = action === "bulk_create" ? Number(body?.count ?? 0) : 1;
    const count = Math.floor(requestedCount);
    if (!Number.isFinite(count) || count < 1 || count > 50) {
      return fail("table_count_invalid", "จำนวนโต๊ะต้องอยู่ระหว่าง 1-50", 422);
    }

    const capacity = Math.floor(Number(body?.capacity ?? 4));
    if (!Number.isFinite(capacity) || capacity < 1 || capacity > 100) {
      return fail("table_capacity_invalid", "จำนวนที่นั่งต้องอยู่ระหว่าง 1-100", 422);
    }

    const zoneName = clean(body?.zone_name, 80);
    const tableName = clean(body?.table_name, 100);
    const zone = await resolveZone({
      tenantId,
      branchId,
      actorUserId: auth.userId!,
      actorRole: scope.session.role as "owner" | "manager",
      zoneName
    });
    createdZoneId = zone.createdZoneId;

    const db = getSupabaseServiceClient();
    const created: Array<{
      id: string;
      zone_id: string | null;
      table_code: string;
      table_name: string | null;
      capacity: number;
      status: string;
    }> = [];

    for (let index = 0; index < count; index += 1) {
      let row: (typeof created)[number] | null = null;
      let lastError = "table_create_failed";
      for (let attempt = 0; attempt < 4 && !row; attempt += 1) {
        const code = await nextTableCode(tenantId, branchId);
        const displayName =
          count === 1
            ? tableName || null
            : tableName
              ? `${tableName} ${index + 1}`
              : null;
        const inserted = await db
          .from("dining_tables")
          .insert({
            tenant_id: tenantId,
            branch_id: branchId,
            zone_id: zone.zoneId,
            table_code: code,
            table_name: displayName,
            capacity,
            status: "available",
            shape: "rectangle",
            position_x: 0,
            position_y: 0,
            width: 96,
            height: 72,
            rotation: 0,
            is_active: true,
            metadata: { source: "native_pos_2", bulk_index: count > 1 ? index + 1 : null }
          })
          .select("id,zone_id,table_code,table_name,capacity,status")
          .single<(typeof created)[number]>();
        if (!inserted.error && inserted.data) {
          row = inserted.data;
          break;
        }
        lastError = inserted.error?.message ?? "table_create_failed";
        if (inserted.error?.code !== "23505") break;
      }
      if (!row) throw new Error(lastError);
      created.push(row);
      createdIds.push(row.id);
    }

    for (const row of created) {
      await appendAuditLog({
        tenantId,
        branchId,
        actorUserId: auth.userId!,
        actorRole: scope.session.role as "owner" | "manager",
        action: "table_created",
        targetTable: "dining_tables",
        targetId: row.id,
        metadata: {
          table_code: row.table_code,
          branch_id: branchId,
          zone_id: row.zone_id,
          source: "native_pos_2",
          batch_count: count
        }
      });
    }

    return ok({
      created,
      created_count: created.length,
      zone_id: zone.zoneId,
      zone_created: Boolean(createdZoneId)
    }, action === "bulk_create" ? 201 : 201);
  } catch (error) {
    if (createdIds.length > 0) {
      await getSupabaseServiceClient().from("dining_tables").delete().in("id", createdIds);
    }
    if (createdZoneId) {
      await getSupabaseServiceClient().from("table_zones").delete().eq("id", createdZoneId);
    }
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "pos_scope_mismatch") return fail("pos_scope_mismatch", "POS session scope mismatch", 403);
    if (message === "forbidden_role") return fail("forbidden_role", "Only owner or manager can manage tables.", 403);
    return fail("native_table_create_failed", message, 400);
  }
}
