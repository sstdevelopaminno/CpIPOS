import { fail, ok } from "@/lib/api/response";
import { readMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PaymentAccountRow = {
  id: string;
  branch_id: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  promptpay_phone: string | null;
  promptpay_payload: string | null;
  qr_image_url: string | null;
  qr_mode: string | null;
  applies_to_all_branches: boolean | null;
};

type ProviderSettingRow = {
  provider: string | null;
  environment: string | null;
  is_active: boolean | null;
};

function digitsOnly(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function buildPromptPayQrUrl(account: PaymentAccountRow, amount: number) {
  if (account.qr_mode === "qr_image" && account.qr_image_url) return account.qr_image_url;

  const payload = String(account.promptpay_payload ?? "").trim();
  const amountText = amount.toFixed(2);
  if (payload) {
    if (payload.includes("{amount}")) return payload.replaceAll("{amount}", amountText);
    if (/^https?:\/\//i.test(payload)) return `${payload.replace(/\/$/, "")}/${amountText}.png`;
  }

  const phone = digitsOnly(account.promptpay_phone);
  return phone ? `https://promptpay.io/${phone}/${amountText}.png` : null;
}

export async function GET(request: Request) {
  try {
    const scope = await readMobileSession();
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    if (!["owner", "manager", "staff"].includes(scope.role)) return fail("forbidden", "ไม่มีสิทธิ์ขาย", 403);

    const url = new URL(request.url);
    const amount = Math.max(0, Math.min(1_000_000, Number(url.searchParams.get("amount") ?? 0)));
    if (!Number.isFinite(amount) || amount <= 0) return fail("invalid_amount", "ยอดชำระไม่ถูกต้อง", 422);

    const supabase = createServiceClient();
    const [{ data: accountRows, error: accountError }, { data: providerRows, error: providerError }] = await Promise.all([
      supabase
        .from("tenant_payment_accounts")
        .select("id,branch_id,bank_name,account_name,account_number,promptpay_phone,promptpay_payload,qr_image_url,qr_mode,applies_to_all_branches")
        .eq("tenant_id", scope.tenantId)
        .eq("is_active", true)
        .or(`branch_id.eq.${scope.branchId},applies_to_all_branches.eq.true`)
        .order("applies_to_all_branches", { ascending: true })
        .order("updated_at", { ascending: false }),
      supabase
        .from("pos_payment_provider_settings")
        .select("provider,environment,is_active")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .eq("is_active", true)
    ]);

    if (accountError) throw new Error(accountError.message);
    if (providerError) throw new Error(providerError.message);

    const accounts = (accountRows ?? []) as PaymentAccountRow[];
    const branchAccount = accounts.find((account) => account.branch_id === scope.branchId && account.applies_to_all_branches !== true);
    const tenantAccount = accounts.find((account) => account.applies_to_all_branches === true);
    const account = branchAccount ?? tenantAccount ?? null;
    const inetProvider = ((providerRows ?? []) as ProviderSettingRow[]).find((row) => row.provider === "inet_nops" && row.is_active !== false) ?? null;

    return ok({
      amount,
      manual: account
        ? {
            accountId: account.id,
            bankName: account.bank_name ?? "",
            accountName: account.account_name ?? "",
            accountNumber: account.account_number ?? "",
            promptPayPhone: account.promptpay_phone ?? "",
            qrMode: account.qr_mode === "qr_image" ? "qr_image" : "promptpay_link",
            qrUrl: buildPromptPayQrUrl(account, amount)
          }
        : null,
      inet: inetProvider
        ? {
            enabled: true,
            environment: inetProvider.environment === "production" ? "production" : "uat"
          }
        : {
            enabled: false,
            environment: null
          }
    });
  } catch (error) {
    console.error("[mobile.payments.qr]", error);
    return fail("payment_qr_failed", "โหลด QR ชำระเงินไม่สำเร็จ", 503);
  }
}
