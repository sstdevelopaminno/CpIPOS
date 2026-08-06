import { createServiceClient } from "@/lib/supabase/server";

type MobileScope = {
  tenantId: string;
  branchId: string;
  sessionId: string;
  userId: string;
  deviceCode: string;
};

type DineInRpcCartInput = {
  orderId: string;
  discountMode?: "percent" | "amount";
  discountValue?: number;
  memberId?: string;
  memberPoints?: number;
  memberStamps?: number;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
};

type DineInCheckoutRpcInput = DineInRpcCartInput & {
  paymentMethod: "cash" | "transfer";
  cashReceived?: number;
  referenceNo?: string | null;
};

type DineInRpcResult = {
  order_id: string;
  order_no: string;
  total: number;
  payment_method?: "cash" | "transfer";
};

export type DineInRpcAttempt =
  | { handled: true; data: DineInRpcResult }
  | { handled: false };

function isMissingRpcSignature(error: unknown) {
  const typed = error as { code?: string; message?: string } | null;
  const message = String(typed?.message ?? error ?? "");
  return typed?.code === "PGRST202" || message.includes("Could not find the function") || message.includes("schema cache");
}

function cartPayload(scope: MobileScope, input: DineInRpcCartInput) {
  return {
    p_tenant_id: scope.tenantId,
    p_branch_id: scope.branchId,
    p_session_id: scope.sessionId,
    p_user_id: scope.userId,
    p_device_code: scope.deviceCode,
    p_order_id: input.orderId,
    p_discount_mode: input.discountMode ?? "amount",
    p_discount_value: input.discountValue ?? 0,
    p_member_id: input.memberId ?? null,
    p_member_points: input.memberPoints ?? 0,
    p_member_stamps: input.memberStamps ?? 0,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    })),
  };
}

export async function tryDineInHoldRpc(
  supabase: ReturnType<typeof createServiceClient>,
  scope: MobileScope,
  input: DineInRpcCartInput,
): Promise<DineInRpcAttempt> {
  const result = await supabase
    .rpc("mobile_dine_in_hold_bill", cartPayload(scope, input))
    .single<DineInRpcResult>();

  if (result.error) {
    if (isMissingRpcSignature(result.error)) return { handled: false };
    throw new Error(result.error.message);
  }
  if (!result.data) throw new Error("draft_order_not_found");
  return { handled: true, data: result.data };
}

export async function tryDineInCheckoutRpc(
  supabase: ReturnType<typeof createServiceClient>,
  scope: MobileScope,
  input: DineInCheckoutRpcInput,
): Promise<DineInRpcAttempt> {
  const result = await supabase
    .rpc("mobile_dine_in_checkout_bill", {
      ...cartPayload(scope, input),
      p_payment_method: input.paymentMethod,
      p_cash_received: input.paymentMethod === "cash" ? input.cashReceived ?? 0 : null,
      p_reference_no: input.paymentMethod === "transfer" ? input.referenceNo ?? null : null,
    })
    .single<DineInRpcResult>();

  if (result.error) {
    if (isMissingRpcSignature(result.error)) return { handled: false };
    throw new Error(result.error.message);
  }
  if (!result.data) throw new Error("draft_order_not_found");
  return { handled: true, data: result.data };
}