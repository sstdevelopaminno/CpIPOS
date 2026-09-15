import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import {
  loadPosNotificationSettings,
  savePosNotificationSettings,
  type PosNotificationSettingsInput
} from "@/lib/services/pos-settings-service";
import { saveStoreTableQrAutomationPolicy } from "@/lib/services/table-qr-automation-policy-service";

function statusFromError(error: unknown) {
  const message = error instanceof Error ? error.message : "Notification settings request failed.";
  if (message.includes("Only owner")) return { code: "forbidden_role", message, status: 403 };
  if (message.includes("not found")) return { code: "branch_not_found", message, status: 404 };
  if (message.includes("required")) return { code: "invalid_payload", message, status: 422 };
  return { code: "settings_notifications_failed", message, status: 500 };
}

export async function GET(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    const { searchParams } = new URL(request.url);
    const branchId = String(searchParams.get("branch_id") ?? auth.branchId ?? "").trim();
    const notification_settings = await loadPosNotificationSettings(auth, branchId);
    return ok({ branch_id: branchId, notification_settings });
  } catch (error) {
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "settings:view" });
    const body = (await request.json()) as PosNotificationSettingsInput;
    await savePosNotificationSettings(auth, body);

    // Keep the legacy notification endpoint compatible while making the IT override authoritative.
    // If the old settings screen changes the popup preference, store it as the shop preference;
    // then rewrite the legacy popup column to the effective (shop + IT override) value.
    await saveStoreTableQrAutomationPolicy(auth, {
      branch_id: String(body.branch_id ?? auth.branchId ?? ""),
      ...(typeof body.table_qr_popup_enabled === "boolean"
        ? { popup_enabled: body.table_qr_popup_enabled }
        : {})
    });

    const branchId = String(body.branch_id ?? auth.branchId ?? "");
    const notification_settings = await loadPosNotificationSettings(auth, branchId);
    return ok({ branch_id: branchId, notification_settings });
  } catch (error) {
    const resolved = statusFromError(error);
    return fail(resolved.code, resolved.message, resolved.status);
  }
}
