import { fail, ok } from "@/lib/http";
import { requirePosSession } from "@/lib/pos-session-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Input = { billing_interval?: unknown };
type Contract = {
  package_id: string; billing_interval: string; amount_per_cycle: number | null; status: string
};
type Plan = {
  id: string; code: string; name: string; is_active: boolean;
  quota_mode: string | null; monthly_price: number | null; yearly_price: number | null;
};
type OpenRequest = { id: string; status: string };

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    if (scope.session.role !== "owner" && scope.session.role !== "manager") {
      return fail("forbidden", "Only the store owner or manager can request a subscription renewal.", 403);
    }
    const limited = await enforceRateLimit({
      namespace: "pos_subscription_renewal_request",
      key: scope.session.user_id,
      max: 3,
      windowMs: 60_000
    });
    if (!limited.ok) return fail("rate_limited", "Please wait before submitting another request.", 429);

    const raw = await request.text();
    if (raw.length > 4096) return fail("payload_too_large", "Request is too large.", 413);
    let body: Input;
    try { body = JSON.parse(raw) as Input; }
    catch { return fail("invalid_json", "Invalid request.", 422); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail("invalid_request", "Request is required.", 422);
    }
    const interval = body.billing_interval;
    if (interval !== "monthly" && interval !== "yearly") {
      return fail("invalid_interval", "Select monthly or yearly billing.", 422);
    }

    // Never trust a tenant ID, amount, approval state or package price from the browser.
    const tenantId = scope.session.tenant_id;
    const primary = getPrimarySupabaseServiceClient();
    const [contractResult, openResult] = await Promise.all([
      primary.from("tenant_subscription_contracts")
        .select("package_id,billing_interval,amount_per_cycle,status")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false })
        .limit(1).maybeSingle<Contract>(),
      primary.from("tenant_subscription_payment_requests")
        .select("id,status").eq("tenant_id", tenantId)
        .in("status", ["pending", "under_review"])
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle<OpenRequest>()
    ]);
    if (contractResult.error || openResult.error) throw new Error("Subscription lookup failed.");
    if (openResult.data) {
      return fail("request_already_open", "There is already a pending subscription request for this store.", 409);
    }
    const contract = contractResult.data;
    if (!contract?.package_id || contract.status === "cancelled") {
      return fail("contract_not_ready", "Please contact IT to assign a subscription package.", 409);
    }
    const planResult = await primary.from("subscription_packages")
      .select("id,code,name,is_active,quota_mode,monthly_price,yearly_price")
      .eq("id", contract.package_id).maybeSingle<Plan>();
    if (planResult.error || !planResult.data) throw new Error("Package lookup failed.");
    const plan = planResult.data;
    if (!plan.is_active || plan.quota_mode === "custom" || plan.quota_mode === "exempt") {
      return fail("manual_quote_required", "Contact IT for a custom package quotation.", 409);
    }
    const catalogPrice = interval === "yearly" ? plan.yearly_price : plan.monthly_price;
    const agreedPrice = contract.billing_interval === interval ? contract.amount_per_cycle : null;
    const due = Number(agreedPrice && agreedPrice > 0 ? agreedPrice : catalogPrice);
    if (!Number.isFinite(due) || due <= 0 || (interval === "yearly" && Number(plan.yearly_price ?? 0) <= 0)) {
      return fail("price_not_configured", "IT has not configured this billing interval. Contact support.", 409);
    }
    const requestType = contract.status === "trial" ? "trial_conversion"
      : contract.status === "active" || contract.status === "expired" || contract.status === "suspended"
        ? "renewal" : "new_subscription";
    const saved = await primary.from("tenant_subscription_payment_requests")
      .insert({
        tenant_id: tenantId,
        requested_package_id: plan.id,
        request_type: requestType,
        currency: "THB",
        amount_reported: null,
        evidence_url: null,
        status: "pending",
        metadata: {
          billing_interval: interval,
          expected_amount: due,
          package_code: plan.code,
          request_source: "pos_subscription_workspace",
          requested_by: scope.session.user_id
        }
      })
      .select("id,status,submitted_at,request_type").single();
    if (saved.error || !saved.data) throw new Error("Unable to create renewal request.");
    const response = ok({
      request: saved.data,
      quoted_amount: due,
      billing_interval: interval,
      message: "Request received; the package has not been renewed or marked paid."
    }, 201);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    console.error("[subscription-request] failed", error instanceof Error ? error.message : "unknown");
    return fail("subscription_request_failed", "Unable to submit the request. Please try again or contact Support.", 500);
  }
}
