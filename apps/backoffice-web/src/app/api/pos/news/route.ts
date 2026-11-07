import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Post = {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  published_at: string;
};

export async function GET() {
  try {
    const { session } = await requirePosSession();
    const db = getPrimarySupabaseServiceClient();
    const { data, error } = await db.from("platform_news_posts")
      .select("id,title,body,image_url,link_url,published_at")
      .eq("status", "published")
      .lte("published_at", new Date().toISOString())
      .or("target_tenant_id.is.null,target_tenant_id.eq." + session.tenant_id)
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(200);
    if (error) throw new Error("platform_news_list_unavailable");
    const posts = (data ?? []) as Post[];
    const ids = posts.map(post => post.id);
    const { data: reads, error: readError } = ids.length
      ? await db.from("platform_news_reads").select("news_id,read_at")
          .eq("tenant_id", session.tenant_id).eq("user_id", session.user_id).in("news_id", ids)
      : { data: [] as Array<{ news_id: string; read_at: string }>, error: null };
    if (readError) throw new Error("platform_news_read_state_unavailable");
    const readIds = new Set((reads ?? []).map(row => row.news_id));
    const response = ok({
      items: posts.map((post, index) => ({
        ...post, is_latest: index === 0, is_read: readIds.has(post.id)
      })),
      unread_count: posts.filter(post => !readIds.has(post.id)).length
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    console.error("[pos-news] unable to list announcements", error);
    return fail("news_unavailable", "ไม่สามารถโหลดข่าวสารได้ในขณะนี้", 503);
  }
}
