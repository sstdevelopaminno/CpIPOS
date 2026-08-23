export type QrKitchenHardeningFlags = {
  qr_pos_review_required: boolean;
  global_qr_order_alert: boolean;
  kitchen_send_confirmation: boolean;
};

const FG0003_TENANT_IDS = new Set(["2d38bd23-bf2d-4b9a-a7cf-adb2547297ed"]);
const FG0003_BRANCH_IDS = new Set(["41eee367-6762-4277-bfc8-c2e9776a8ef9"]);
const FG0003_CODES = new Set(["FG0003"]);

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

export function resolveQrKitchenHardeningFlags(scope: {
  tenantId?: string | null;
  branchId?: string | null;
  tenantCode?: string | null;
  branchCode?: string | null;
}): QrKitchenHardeningFlags {
  const enabled =
    FG0003_TENANT_IDS.has(String(scope.tenantId ?? "")) ||
    FG0003_BRANCH_IDS.has(String(scope.branchId ?? "")) ||
    FG0003_CODES.has(normalizeCode(scope.tenantCode)) ||
    FG0003_CODES.has(normalizeCode(scope.branchCode));

  return {
    qr_pos_review_required: enabled,
    global_qr_order_alert: enabled,
    kitchen_send_confirmation: enabled
  };
}

export function isFg0003QrKitchenHardeningEnabled(flags: QrKitchenHardeningFlags): boolean {
  return flags.qr_pos_review_required && flags.global_qr_order_alert && flags.kitchen_send_confirmation;
}
