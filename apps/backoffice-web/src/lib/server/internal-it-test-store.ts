import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type InternalItTestMode = "full" | "simulate";

/** Exact two-code match in primary identity plane; never authorize from a request-supplied store code. */
export async function getInternalItTestMode(tenantId: string): Promise<InternalItTestMode | null> {
  const db = getSupabaseServiceClient();
  const tenant = await db.from("tenants").select("code,metadata")
    .eq("id", tenantId).maybeSingle<{ code: string; metadata: Record<string, unknown> | null }>();
  if (tenant.error) throw new Error("it_test_tenant_lookup_failed:" + tenant.error.message);
  if (tenant.data?.code !== "NDL-TH-001") return null;
  const access = await db.from("tenant_access_codes").select("access_code")
    .eq("tenant_id", tenantId).eq("is_active", true)
    .order("issued_at", { ascending: false }).limit(1)
    .maybeSingle<{ access_code: string }>();
  if (access.error) throw new Error("it_test_store_code_lookup_failed:" + access.error.message);
  if (access.data?.access_code !== "900001") return null;
  return tenant.data?.metadata?.it_test_access_mode === "simulate" ? "simulate" : "full";
}
