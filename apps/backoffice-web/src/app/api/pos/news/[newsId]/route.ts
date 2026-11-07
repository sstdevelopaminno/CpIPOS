import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ newsId: string }> };

async function scopedNews(newsId: string, tenantId: string) {
  if (!UUID.test(newsId)) return null;
  const db = getPrimarySupabaseServiceClient();
  const { data, error } = await db.from("platform_news_posts")
    .select("id,title,body,image_url,link_url,published_at")
    .eq("id", newsId).eq("status", "published")
    .lte("published_at", new Date().toISOString())
    .or("target_tenant_id.is.null,target_tenant_id.eq." + tenantId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { session } = await requirePosSession();
    const { newsId } = await context.params;
    const item = await scopedNews(newsId, session.tenant_id);
    if (!item) return fail("news_not_found", "ไม่พบรายการข่าวสาร", 404);
    const db = getPrimarySupabaseServiceClient();
    const read = await db.from("platform_news_reads").select("read_at")
      .eq("news_id", newsId).eq("tenant_id", session.tenant_id).eq("user_id", session.user_id).maybeSingle();
    if (read.error) throw read.error;
    const response = ok({ item: { ...item, is_read: Boolean(read.data) } });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    console.error("[pos-news] detail failed", error);
    return fail("news_unavailable", "ไม่สามารถโหลดรายละเอียดข่าวสาร", 503);
  }
}

export async function POST(_request: Request, context: Context) {
  try {
    const { session } = await requirePosSession();
    const { newsId } = await context.params;
    const item = await scopedNews(newsId, session.tenant_id);
    if (!item) return fail("news_not_found", "ไม่พบข่าวสารที่เปิดอ่านได้", 404);
    const db = getPrimarySupabaseServiceClient();
    const saved = await db.from("platform_news_reads").upsert({
      news_id: newsId, tenant_id: session.tenant_id, user_id: session.user_id
    }, { onConflict: "news_id,tenant_id,user_id", ignoreDuplicates: true })
      .select("news_id,read_at").maybeSingle();
    if (saved.error) throw saved.error;
    // A pre-existing row is an idempotent success for this authenticated user.
    const response = ok({ news_id: newsId, read: true });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    console.error("[pos-news] mark read failed", error);
    return fail("news_read_failed", "ยังไม่สามารถบันทึกสถานะอ่านข่าวได้", 503);
  }
}
