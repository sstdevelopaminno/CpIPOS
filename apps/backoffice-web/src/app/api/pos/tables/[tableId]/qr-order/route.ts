import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { PosTimeoutError, withTimeout } from "@/lib/pos-resilience";
import { issueTableQrSessionWithPolicy } from "@/lib/table-qr-issuance";

const TABLE_QR_ISSUE_TIMEOUT_MS = 45000;

export async function POST(request: Request, context: { params: Promise<{ tableId: string }> }) {
  const startedAt = Date.now();
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "tables:manage" });
    await requirePosApiFeature(auth, "qr_table_ordering");
    const { tableId } = await context.params;
    if (!tableId) return fail("invalid_table_id", "tableId is required.", 422);

    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const requestUrl = new URL(request.url);
    const origin = forwardedHost && forwardedProto
      ? `${forwardedProto}://${forwardedHost}`
      : `${requestUrl.protocol}//${requestUrl.host}`;
    const data = await withTimeout(
      issueTableQrSessionWithPolicy({ auth, tableId, requestOrigin: origin }),
      TABLE_QR_ISSUE_TIMEOUT_MS,
      "table_qr_issue_timeout"
    );

    void appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: auth.branchId!,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "table_qr_order_link_issued",
      targetTable: "table_qr_sessions",
      targetId: data.qr_session_id,
      metadata: {
        table_id: data.table_id,
        table_session_id: data.table_session_id,
        expires_at: data.expires_at,
        expiry_mode: data.expiry_mode,
        ttl_minutes: data.ttl_minutes
      }
    });

    const response = ok(data, 201);
    response.headers.set("x-pos-table-qr-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const message = error instanceof Error ? error.message : "Unable to create table QR.";
    if (error instanceof PosTimeoutError || message.includes("table_qr_issue_timeout")) {
      const response = fail("table_qr_issue_timeout", "Creating the table QR took too long. Please retry.", 503);
      response.headers.set("x-pos-table-qr-ms", String(Date.now() - startedAt));
      return response;
    }
    if (message === "BUFFET_PLAN_NOT_COMMITTED") {
      return fail("buffet_plan_not_committed", "กรุณายืนยันแพ็กเกจบุฟเฟ่ลงบิลก่อนสร้าง QR สำหรับโต๊ะนี้", 409);
    }
    if (message === "BUFFET_SET_INVALID_ITEM") {
      return fail("buffet_set_invalid_item", "ชุดบุฟเฟ่นี้มีรายการที่ไม่ใช่อาหารบุฟเฟ่ราคา 0 บาท กรุณาแก้รายการในชุดก่อนสร้าง QR", 409);
    }
    if (message === "buffet_access_ambiguous") {
      return fail("buffet_access_ambiguous", "โต๊ะนี้มีแพ็กเกจบุฟเฟ่มากกว่าหนึ่งแบบ กรุณาปิดบิลแล้วเปิดโต๊ะใหม่", 409);
    }
    if (message === "table_not_open" || message === "table_session_not_open") {
      return fail(message, "Open the table bill before creating its ordering QR.", 409);
    }
    if (message.includes("signing_secret")) {
      const response = fail("table_qr_configuration_missing", "ยังไม่ได้ตั้งค่า TABLE_QR_SIGNING_SECRET สำหรับสร้าง QR โต๊ะ", 500);
      response.headers.set("x-pos-table-qr-ms", String(Date.now() - startedAt));
      return response;
    }
    return fail("table_qr_issue_failed", message, 400);
  }
}
