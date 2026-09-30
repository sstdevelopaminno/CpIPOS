import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { isTenantPosMenuEnabled } from "@/lib/server/pos-menu-policy-service";
import { createAiChatRoom, listAiChatRooms, pruneExpiredAiChatRooms, publicAiChatRoom } from "@/lib/services/ai-conversation-service";
import { loadAiQuotaStatus } from "@/lib/services/ai-usage-service";
import { PosGuardError } from "@/lib/pos-session-guard";

export const runtime = "nodejs";

function canUseAi(branchRole: string | null) {
  return branchRole === "owner" || branchRole === "manager";
}

function scopeFrom(auth: Awaited<ReturnType<typeof getPosApiAuthContext>>) {
  if (!auth.tenantId || !auth.branchId) throw new Error("missing_pos_scope");
  return {
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    userId: auth.userId,
    role: auth.branchRole ?? "unknown"
  };
}

async function guard() {
  const auth = await getPosApiAuthContext({ requireBranchScope: true });
  if (!canUseAi(auth.branchRole)) {
    return { response: fail("ai_assistant_forbidden", "CpiPOS AI ใช้งานได้เฉพาะ Owner และ Manager", 403) } as const;
  }
  if (!auth.tenantId || !(await isTenantPosMenuEnabled(auth.tenantId, "main.ai_assistant"))) {
    return { response: fail("ai_assistant_disabled_by_it", "CpiPOS AI ถูกปิดสำหรับร้านนี้", 403) } as const;
  }
  const quota = await loadAiQuotaStatus(auth.tenantId);
  if (!quota.enabled) {
    return { response: fail("ai_quota_disabled", "แพ็กเกจของร้านนี้ยังไม่ได้เปิด CpiPOS AI", 403) } as const;
  }
  return { auth, quota } as const;
}

export async function GET() {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    const scope = scopeFrom(checked.auth);
    await pruneExpiredAiChatRooms(scope, checked.quota.history_retention_days);
    const rooms = await listAiChatRooms(scope);
    return ok({
      rooms: rooms.map(publicAiChatRoom),
      history_retention_days: checked.quota.history_retention_days
    });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    console.error("[cpipos-ai] room list failed", error);
    return fail("ai_chat_rooms_failed", "ไม่สามารถโหลดห้องแชท CpiPOS AI ได้ในขณะนี้", 500);
  }
}

export async function POST(request: Request) {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    const body = (await request.json().catch(() => null)) as { title?: string } | null;
    const room = await createAiChatRoom(scopeFrom(checked.auth), body?.title ?? "แชทใหม่");
    return ok({
      room: publicAiChatRoom(room),
      history_retention_days: checked.quota.history_retention_days
    }, 201);
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    console.error("[cpipos-ai] room create failed", error);
    return fail("ai_chat_room_create_failed", "ไม่สามารถสร้างห้องแชทใหม่ได้ในขณะนี้", 500);
  }
}
