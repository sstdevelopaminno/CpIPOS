import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import {
  callSupportChat,
  issuePosSupportChatBridge,
  loadPosSupportChatHeads,
  mirrorSupportChatHead,
  type SupportChatHead
} from "@/lib/services/support-chat/support-chat-bridge";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const scope = await requirePosSession();
    return ok({ conversations: await loadPosSupportChatHeads(scope.session.tenant_id) });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    console.error("[support-chat] POS list failed", error);
    return fail("support_chat_unavailable", "ไม่สามารถโหลดรายการแชทได้", 503);
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    const body = await request.json().catch(() => null) as { subject?: string; contact_name?: string } | null;
    const subject = String(body?.subject ?? "").trim().slice(0, 180);
    const contactName = String(body?.contact_name ?? "").trim().slice(0, 120);
    if (subject.length < 2 || contactName.length < 2) {
      return fail("support_chat_fields_required", "กรุณาระบุชื่อเรื่องและชื่อผู้ติดต่อ", 422);
    }

    const rate = await enforceRateLimit({
      namespace: "pos-support-chat-create",
      key: `${scope.session.tenant_id}:${getClientIpAddress(request)}`,
      max: 5,
      windowMs: 10 * 60_000,
      failClosedOnBackendError: true
    });
    if (!rate.ok) return fail("support_chat_rate_limited", "เปิดเรื่องใหม่ถี่เกินไป กรุณารอสักครู่", 429);

    const db = getPrimarySupabaseServiceClient();
    const tenant = await db.from("tenants")
      .select("id,code,name,display_name,logo_url")
      .eq("id", scope.session.tenant_id)
      .maybeSingle<{ id: string; code: string | null; name: string; display_name: string | null; logo_url: string | null }>();
    if (tenant.error || !tenant.data) return fail("store_not_found", "ไม่พบข้อมูลร้านค้า", 404);

    const bridge = await issuePosSupportChatBridge(scope);
    const data = await callSupportChat<{
      conversation: Record<string, unknown>;
      head: SupportChatHead;
      already_open: boolean;
    }>(bridge, "create_conversation", {
      subject,
      contact_name: contactName,
      store_code: tenant.data.code || tenant.data.id.slice(0, 8).toUpperCase(),
      store_name: tenant.data.display_name || tenant.data.name,
      store_logo_url: tenant.data.logo_url
    });
    await mirrorSupportChatHead(data.head);
    return ok(data);
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    const typed = error as Error & { status?: number; code?: string };
    console.error("[support-chat] POS create failed", typed);
    return fail(typed.code || "support_chat_create_failed", typed.message || "ไม่สามารถเริ่มแชทได้", typed.status || 503);
  }
}
