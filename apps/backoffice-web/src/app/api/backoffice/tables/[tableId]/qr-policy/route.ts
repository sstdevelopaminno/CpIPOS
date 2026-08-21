import { getAuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { resolveTableBranchScope } from "@/lib/table-branch-scope";
import {
  mergeTableQrPolicyMetadata,
  normalizeTableQrPolicyFromMetadata,
  tableQrPoliciesEqual,
  validateTableQrPolicyInput
} from "@/lib/table-qr-policy";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type TablePolicyPayload = {
  branch_id?: string | null;
  mode?: "time" | "bill" | string;
  ttl_minutes?: number | string | null;
};

type TablePolicyRow = {
  id: string;
  table_code: string;
  table_name: string | null;
  metadata: Record<string, unknown> | null;
};

async function resolvePolicyTable(args: {
  auth: Awaited<ReturnType<typeof getAuthContext>>;
  tableId: string;
  requestedBranchId?: string | null;
}) {
  const supabase = getSupabaseServiceClient();
  const branchScope = await resolveTableBranchScope({
    auth: args.auth,
    requestedBranchId: args.requestedBranchId,
    requireManage: true,
    supabaseClient: supabase
  });
  if (!branchScope.ok) {
    return { response: fail(branchScope.code, branchScope.message, branchScope.status) } as const;
  }

  const targetBranchId = branchScope.targetBranchId!;
  await requireTenantFeature(args.auth.tenantId!, "qr_table_ordering", targetBranchId);

  const { data: table, error } = await supabase
    .from("dining_tables")
    .select("id,table_code,table_name,metadata")
    .eq("tenant_id", args.auth.tenantId!)
    .eq("branch_id", targetBranchId)
    .eq("id", args.tableId)
    .maybeSingle<TablePolicyRow>();

  if (error) {
    return { response: fail("table_qr_policy_query_failed", error.message, 500) } as const;
  }
  if (!table) {
    return { response: fail("table_not_found", "Table not found in current branch.", 404) } as const;
  }

  return {
    supabase,
    targetBranchId,
    targetRole: branchScope.branches.find((branch) => branch.id === targetBranchId)?.role ?? args.auth.branchRole,
    table
  } as const;
}

export async function GET(request: Request, context: { params: Promise<{ tableId: string }> }) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "table_management");
    const { tableId } = await context.params;
    if (!tableId) return fail("invalid_table_id", "tableId is required.", 422);

    const requestedBranchId = new URL(request.url).searchParams.get("branch_id");
    const resolved = await resolvePolicyTable({ auth, tableId, requestedBranchId });
    if ("response" in resolved) return resolved.response;

    return ok({
      table_id: resolved.table.id,
      table_code: resolved.table.table_code,
      table_name: resolved.table.table_name,
      policy: normalizeTableQrPolicyFromMetadata(resolved.table.metadata)
    });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("table_qr_policy_query_failed", error instanceof Error ? error.message : "Unable to load QR policy.", 400);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ tableId: string }> }) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "table_management");
    const { tableId } = await context.params;
    if (!tableId) return fail("invalid_table_id", "tableId is required.", 422);

    const body = (await request.json().catch(() => null)) as TablePolicyPayload | null;
    if (!body) return fail("invalid_payload", "QR policy payload is required.", 422);

    const validated = validateTableQrPolicyInput({ mode: body.mode, ttl_minutes: body.ttl_minutes });
    if (!validated.ok) return fail(validated.code, validated.message, 422);

    const resolved = await resolvePolicyTable({ auth, tableId, requestedBranchId: body.branch_id });
    if ("response" in resolved) return resolved.response;

    const currentPolicy = normalizeTableQrPolicyFromMetadata(resolved.table.metadata);
    const nextPolicy = validated.policy;
    if (tableQrPoliciesEqual(currentPolicy, nextPolicy)) {
      return ok({
        table_id: resolved.table.id,
        table_code: resolved.table.table_code,
        table_name: resolved.table.table_name,
        policy: currentPolicy,
        revoked_active_sessions: 0,
        changed: false
      });
    }

    const revokedAt = new Date().toISOString();
    const { data: revokedRows, error: revokeError } = await resolved.supabase
      .from("table_qr_sessions")
      .update({ status: "revoked", revoked_at: revokedAt })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", resolved.targetBranchId)
      .eq("table_id", tableId)
      .eq("status", "active")
      .select("id");

    if (revokeError) {
      return fail("table_qr_policy_revoke_failed", revokeError.message, 500);
    }

    const nextMetadata = mergeTableQrPolicyMetadata(resolved.table.metadata, nextPolicy);
    const { data: updated, error: updateError } = await resolved.supabase
      .from("dining_tables")
      .update({ metadata: nextMetadata })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", resolved.targetBranchId)
      .eq("id", tableId)
      .select("id,table_code,table_name,metadata")
      .maybeSingle<TablePolicyRow>();

    if (updateError) {
      return fail("table_qr_policy_update_failed", updateError.message, 500);
    }
    if (!updated) {
      return fail("table_not_found", "Table not found in current branch.", 404);
    }

    void appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: resolved.targetBranchId,
      actorUserId: auth.userId,
      actorRole: resolved.targetRole ?? auth.platformRole,
      action: "table_qr_policy_updated",
      targetTable: "dining_tables",
      targetId: tableId,
      metadata: {
        previous_policy: currentPolicy,
        next_policy: nextPolicy,
        revoked_active_sessions: revokedRows?.length ?? 0
      }
    });

    return ok({
      table_id: updated.id,
      table_code: updated.table_code,
      table_name: updated.table_name,
      policy: normalizeTableQrPolicyFromMetadata(updated.metadata),
      revoked_active_sessions: revokedRows?.length ?? 0,
      changed: true
    });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("table_qr_policy_update_failed", error instanceof Error ? error.message : "Unable to update QR policy.", 400);
  }
}
