import "server-only";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

const cache = new Map<string, { mode: InternalItTestMode | null; expires: number }>();

export type InternalItTestMode = "full" | "simulate";

/** Exact two-code match in primary identity plane; never authorize from a request-supplied store code. */
export async function getInternalItTestMode(tenantId: string): Promise<InternalItTestMode | null> {
  const cached = cache.get(tenantId);
  if (cached && cached.expires > Date.now()) return cached.mode;
  const db = getPrimarySupabaseServiceClient();
  const tenant = await db.from("tenants").select("code,metadata")
    .eq("id", tenantId).maybeSingle<{ code: string; metadata: Record<string, unknown> | null }>();
  if (tenant.error) throw new Error("it_test_tenant_lookup_failed:" + tenant.error.message);
  if (tenant.data?.code !== "NDL-TH-001") {
    cache.set(tenantId, { mode: null, expires: Date.now() + 30_000 });
    return null;
  }
  const access = await db.from("tenant_access_codes").select("access_code")
    .eq("tenant_id", tenantId).eq("is_active", true)
    .order("issued_at", { ascending: false }).limit(1)
    .maybeSingle<{ access_code: string }>();
  if (access.error) throw new Error("it_test_store_code_lookup_failed:" + access.error.message);
  const mode = access.data?.access_code !== "900001" ? null
    : tenant.data?.metadata?.it_test_access_mode === "simulate" ? "simulate" : "full";
  if (cache.size > 2048) cache.clear();
  cache.set(tenantId, { mode, expires: Date.now() + 30_000 });
  return mode;
}
