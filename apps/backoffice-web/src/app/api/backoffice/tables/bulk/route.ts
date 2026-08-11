import { getAuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { canManageTables } from "@/lib/table-management";
import { resolveTableBranchScope } from "@/lib/table-branch-scope";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type BulkTablePayload = {
  branch_id?: string;
  zone_id?: string | null;
  count?: number;
  start_number?: number;
  prefix?: string;
  capacity?: number;
  name_mode?: "prefix_number" | "table_number" | "number";
  locale?: "th" | "en";
};

type ExistingTableRow = {
  table_code: string | null;
  table_name: string | null;
};

const MIN_BULK_COUNT = 5;
const MAX_BULK_COUNT = 100;

function normalizePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function buildTableName(args: {
  nameMode: NonNullable<BulkTablePayload["name_mode"]>;
  prefix: string;
  number: number;
  locale: "th" | "en";
}) {
  const { nameMode, prefix, number, locale } = args;
  if (nameMode === "table_number") return locale === "th" ? `โต๊ะ ${number}` : `Table ${number}`;
  if (nameMode === "number") return String(number);
  return `${prefix}${number}`;
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "table_management");
    if (!canManageTables(auth.branchRole)) {
      return fail("forbidden_role", "Only manager or owner can manage tables.", 403);
    }

    const body = (await req.json().catch(() => ({}))) as BulkTablePayload;
    const count = normalizePositiveInteger(body.count, 0);
    const startNumber = normalizePositiveInteger(body.start_number, 0);
    const capacity = normalizePositiveInteger(body.capacity, 4);
    const prefix = String(body.prefix ?? "").trim();
    const nameMode =
      body.name_mode === "table_number" || body.name_mode === "number" || body.name_mode === "prefix_number"
        ? body.name_mode
        : "prefix_number";
    const locale = body.locale === "en" ? "en" : "th";

    if (count < MIN_BULK_COUNT || count > MAX_BULK_COUNT) {
      return fail("invalid_bulk_count", `Table count must be between ${MIN_BULK_COUNT} and ${MAX_BULK_COUNT}.`, 422);
    }
    if (startNumber < 1) {
      return fail("invalid_start_number", "start_number must be an integer of 1 or greater.", 422);
    }
    if (capacity < 1 || capacity > 999) {
      return fail("invalid_capacity", "capacity must be an integer between 1 and 999.", 422);
    }
    if (prefix.length > 20 || !/^[\p{L}\p{N}_-]*$/u.test(prefix)) {
      return fail("invalid_prefix", "Prefix may contain letters, numbers, underscore, or hyphen and must be 20 characters or fewer.", 422);
    }

    const supabase = getSupabaseServiceClient();
    const branchScope = await resolveTableBranchScope({
      auth,
      requestedBranchId: body.branch_id,
      requireManage: true,
      supabaseClient: supabase
    });
    if (!branchScope.ok) {
      return fail(branchScope.code, branchScope.message, branchScope.status);
    }
    const targetBranchId = branchScope.targetBranchId!;

    if (body.zone_id) {
      const { data: zone, error: zoneError } = await supabase
        .from("table_zones")
        .select("id")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", targetBranchId)
        .eq("id", body.zone_id)
        .maybeSingle();
      if (zoneError) {
        return fail("zone_lookup_failed", "Unable to validate the selected zone.", 500);
      }
      if (!zone) {
        return fail("invalid_zone_id", "The selected zone is not available in this branch.", 422);
      }
    }

    const proposed = Array.from({ length: count }, (_, index) => {
      const number = startNumber + index;
      const tableCode = `${prefix}${number}`;
      return {
        number,
        table_code: tableCode,
        table_name: buildTableName({ nameMode, prefix, number, locale })
      };
    });

    const proposedCodeSet = new Set(proposed.map((item) => item.table_code.toLocaleLowerCase()));
    const proposedNameSet = new Set(proposed.map((item) => item.table_name.toLocaleLowerCase()));
    if (proposedCodeSet.size !== proposed.length || proposedNameSet.size !== proposed.length) {
      return fail("bulk_duplicate_generated", "The generated table batch contains duplicate codes or names.", 422);
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("dining_tables")
      .select("table_code,table_name")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", targetBranchId);
    if (existingError) {
      return fail("table_duplicate_check_failed", "Unable to validate existing table numbers.", 500);
    }

    const existingCodes = new Set(
      ((existingRows ?? []) as ExistingTableRow[])
        .map((row) => String(row.table_code ?? "").trim().toLocaleLowerCase())
        .filter(Boolean)
    );
    const existingNames = new Set(
      ((existingRows ?? []) as ExistingTableRow[])
        .map((row) => String(row.table_name ?? "").trim().toLocaleLowerCase())
        .filter(Boolean)
    );

    const duplicateCodes = proposed.filter((item) => existingCodes.has(item.table_code.toLocaleLowerCase())).map((item) => item.table_code);
    const duplicateNames = proposed.filter((item) => existingNames.has(item.table_name.toLocaleLowerCase())).map((item) => item.table_name);
    if (duplicateCodes.length > 0 || duplicateNames.length > 0) {
      const duplicates = Array.from(new Set([...duplicateCodes, ...duplicateNames])).slice(0, 8);
      return fail(
        "bulk_table_duplicate",
        `Cannot create this batch because these table codes or names already exist: ${duplicates.join(", ")}${
          duplicateCodes.length + duplicateNames.length > duplicates.length ? " …" : ""
        }`,
        409
      );
    }

    const existingCount = existingRows?.length ?? 0;
    const rowsToInsert = proposed.map((item, index) => {
      const boardIndex = existingCount + index;
      return {
        tenant_id: auth.tenantId!,
        branch_id: targetBranchId,
        zone_id: body.zone_id ?? null,
        table_code: item.table_code,
        table_name: item.table_name,
        capacity,
        status: "available",
        shape: "rectangle",
        position_x: (boardIndex % 6) * 112,
        position_y: Math.floor(boardIndex / 6) * 88,
        width: 96,
        height: 72,
        rotation: 0,
        is_active: true,
        metadata: {
          created_via: "bulk_table_create",
          bulk_start_number: startNumber,
          bulk_count: count
        }
      };
    });

    // PostgREST sends this array as one INSERT statement. Any row failure rolls back
    // the whole statement, so the batch remains all-or-nothing.
    const { data: createdRows, error: insertError } = await supabase
      .from("dining_tables")
      .insert(rowsToInsert)
      .select(
        "id,tenant_id,branch_id,zone_id,table_code,table_name,capacity,status,shape,position_x,position_y,width,height,rotation,is_active,metadata,created_at,updated_at"
      );

    if (insertError) {
      if (insertError.code === "23505") {
        return fail("bulk_table_duplicate", "One or more table codes already exist. No tables were created.", 409);
      }
      return fail("bulk_table_create_failed", "Unable to create the table batch. No tables were created.", 500);
    }

    const created = createdRows ?? [];
    await appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: targetBranchId,
      actorUserId: auth.userId,
      actorRole: auth.branchRole!,
      action: "table_bulk_create",
      targetTable: "dining_tables",
      targetId: created[0]?.id,
      module: "table_management",
      metadata: {
        branch_id: targetBranchId,
        zone_id: body.zone_id ?? null,
        created_count: created.length,
        start_number: startNumber,
        prefix,
        capacity,
        name_mode: nameMode,
        table_codes: created.map((row) => row.table_code)
      }
    });

    return ok({ created_count: created.length, tables: created }, 201);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}
