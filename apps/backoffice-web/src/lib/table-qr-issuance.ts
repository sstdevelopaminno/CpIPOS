import "server-only";

import QRCode from "qrcode";
import type { AuthContext } from "@/lib/auth-context";
import { buildTableQrToken } from "@/lib/table-qr-ordering";
import {
  normalizeTableQrPolicyFromMetadata,
  tableQrPolicyExpiryMs,
  tableQrSessionMatchesPolicy
} from "@/lib/table-qr-policy";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const ACTIVE_TABLE_SESSION_STATUSES = ["open", "ordering", "pending_payment"];

type QrSessionRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_id: string;
  table_session_id: string;
  status: "active" | "revoked" | "expired";
  expires_at: string;
  created_by: string;
  created_at: string;
};

type TableRow = {
  id: string;
  table_code: string;
  table_name: string | null;
  status: string;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
};

type TableSessionRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_id: string;
  status: string;
  opened_by: string;
};

export async function issueTableQrSessionWithPolicy(args: {
  auth: AuthContext;
  tableId: string;
  requestOrigin: string;
}) {
  const { auth, tableId, requestOrigin } = args;
  if (!auth.tenantId || !auth.branchId) throw new Error("missing_scope");

  const supabase = getSupabaseServiceClient();
  const [{ data: table, error: tableError }, { data: tableSession, error: sessionError }] = await Promise.all([
    supabase
      .from("dining_tables")
      .select("id,table_code,table_name,status,is_active,metadata")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("id", tableId)
      .maybeSingle<TableRow>(),
    supabase
      .from("table_bill_sessions")
      .select("id,tenant_id,branch_id,table_id,status,opened_by")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("table_id", tableId)
      .in("status", ACTIVE_TABLE_SESSION_STATUSES)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle<TableSessionRow>()
  ]);

  if (tableError) throw new Error(tableError.message);
  if (sessionError) throw new Error(sessionError.message);
  if (!table || !table.is_active || !["occupied", "ordering", "pending_payment"].includes(table.status)) {
    throw new Error("table_not_open");
  }
  if (!tableSession) throw new Error("table_session_not_open");

  const policy = normalizeTableQrPolicyFromMetadata(table.metadata);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const { data: existing, error: existingError } = await supabase
    .from("table_qr_sessions")
    .select("id,tenant_id,branch_id,table_id,table_session_id,status,expires_at,created_by,created_at")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("table_session_id", tableSession.id)
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<QrSessionRow>();

  if (existingError) throw new Error(existingError.message);

  let qrSession = existing ?? null;
  if (
    qrSession &&
    !tableQrSessionMatchesPolicy({
      policy,
      createdAt: qrSession.created_at,
      expiresAt: qrSession.expires_at
    })
  ) {
    const { error: revokeMismatchError } = await supabase
      .from("table_qr_sessions")
      .update({ status: "revoked", revoked_at: nowIso })
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("id", qrSession.id)
      .eq("status", "active");
    if (revokeMismatchError) throw new Error(revokeMismatchError.message);
    qrSession = null;
  }

  if (!qrSession) {
    const { error: expireOldError } = await supabase
      .from("table_qr_sessions")
      .update({ status: "expired" })
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("table_session_id", tableSession.id)
      .eq("status", "active")
      .lte("expires_at", nowIso);
    if (expireOldError) throw new Error(expireOldError.message);

    const expiresAt = new Date(tableQrPolicyExpiryMs(policy, nowMs)).toISOString();
    const { data: created, error: createError } = await supabase
      .from("table_qr_sessions")
      .insert({
        tenant_id: auth.tenantId,
        branch_id: auth.branchId,
        table_id: tableId,
        table_session_id: tableSession.id,
        status: "active",
        expires_at: expiresAt,
        created_by: auth.userId
      })
      .select("id,tenant_id,branch_id,table_id,table_session_id,status,expires_at,created_by,created_at")
      .single<QrSessionRow>();
    if (createError) throw new Error(createError.message);
    qrSession = created;
  }

  const token = buildTableQrToken(qrSession.id);
  const orderUrl = `${requestOrigin.replace(/\/$/, "")}/table-order/${encodeURIComponent(token)}`;
  const qrDataUrl = await QRCode.toDataURL(orderUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 420,
    color: { dark: "#000000", light: "#ffffff" }
  });

  return {
    qr_session_id: qrSession.id,
    table_session_id: tableSession.id,
    table_id: table.id,
    table_code: table.table_code,
    table_name: table.table_name,
    order_url: orderUrl,
    qr_data_url: qrDataUrl,
    expires_at: qrSession.expires_at,
    expiry_mode: policy.mode,
    ttl_minutes: policy.ttl_minutes,
    bill_lifecycle_safety_cap: policy.mode === "bill"
  };
}
