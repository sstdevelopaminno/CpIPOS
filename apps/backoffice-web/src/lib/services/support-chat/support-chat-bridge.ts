import "server-only";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import type { PosSessionScope } from "@/lib/pos-session-guard";

const COMMUNICATIONS_FUNCTION_URL =
  "https://wznixoeezgyhtwurcswb.supabase.co/functions/v1/support-chat-api";

export type SupportChatHead = {
  conversation_id: string;
  tenant_id: string;
  store_code: string;
  store_name: string;
  store_logo_url: string | null;
  subject: string;
  contact_name: string;
  status: string;
  assigned_role: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assigned_user_avatar_url: string | null;
  latest_message_at: string | null;
  latest_message_preview: string | null;
  latest_sender_type: string | null;
  unread_it_count: number;
  unread_store_count: number;
  created_at: string;
  updated_at: string;
};

type BridgeToken = {
  payload: Record<string, unknown>;
  signature: string;
};

export async function issuePosSupportChatBridge(scope: PosSessionScope): Promise<BridgeToken> {
  const db = getPrimarySupabaseServiceClient();
  const [{ data: user, error: userError }, { data: tenant, error: tenantError }] = await Promise.all([
    db.from("users_profiles")
      .select("full_name")
      .eq("id", scope.session.user_id)
      .maybeSingle<{ full_name: string | null }>(),
    db.from("tenants")
      .select("logo_url")
      .eq("id", scope.session.tenant_id)
      .maybeSingle<{ logo_url: string | null }>()
  ]);
  if (userError || tenantError) throw new Error("Unable to prepare support identity.");

  const issued = await db.rpc("issue_support_chat_bridge_token", {
    p_user_id: scope.session.user_id,
    p_actor_type: "store",
    p_tenant_id: scope.session.tenant_id,
    p_branch_id: scope.session.branch_id,
    p_role: scope.session.role,
    p_display_name: user?.full_name ?? "ผู้ติดต่อร้านค้า",
    p_avatar_url: tenant?.logo_url ?? null
  });
  if (issued.error || !issued.data) throw new Error("Unable to authorize support chat.");
  return issued.data as BridgeToken;
}

export async function callSupportChat<T>(
  bridge: BridgeToken,
  action: string,
  data: Record<string, unknown> = {}
): Promise<T> {
  const response = await fetch(COMMUNICATIONS_FUNCTION_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bridge, action, data }),
    cache: "no-store"
  });
  const body = await response.json().catch(() => null) as { data?: T; error?: { message?: string; code?: string } } | null;
  if (!response.ok || !body?.data) {
    const error = new Error(body?.error?.message || "Support chat is temporarily unavailable.") as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = body?.error?.code;
    throw error;
  }
  return body.data;
}

export async function mirrorSupportChatHead(head: SupportChatHead | null | undefined) {
  if (!head?.conversation_id) return;
  const db = getPrimarySupabaseServiceClient();
  const result = await db.from("support_chat_heads").upsert(head, { onConflict: "conversation_id" });
  if (result.error) throw new Error("Unable to update support chat notification state.");
}

export async function loadPosSupportChatHeads(tenantId: string) {
  const db = getPrimarySupabaseServiceClient();
  const result = await db.from("support_chat_heads")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("latest_message_at", { ascending: false, nullsFirst: false })
    .limit(20)
    .returns<SupportChatHead[]>();
  if (result.error) throw new Error("Unable to load support conversations.");
  return result.data ?? [];
}
