import "server-only";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const SUBSCRIPTION_SLIP_BUCKET = "subscription-payment-evidence";

type Tenant = { id: string; code: string | null; name: string; display_name: string | null; package_id: string | null };
type Contract = { id: string; package_id: string; status: string; billing_interval: string; amount_per_cycle: number | null;
  currency: string; started_at: string | null; ended_at: string | null;
  max_branches: number | null; branch_limit: number | null; max_devices: number | null;
  terminal_limit_per_branch: number | null; max_users: number | null };
type Lifecycle = { lifecycle_status: string; subscription_expires_at: string | null; trial_expires_at: string | null;
  access_locked: boolean; lock_reason: string | null; metadata: Record<string, unknown> | null };
type Package = { id: string; code: string; name: string; monthly_price: number | null; yearly_price: number | null;
  max_branches: number | null; max_devices: number | null; max_users: number | null; metadata: Record<string, unknown> | null };
type Issuer = { billing_legal_name_th: string; billing_bank_name: string; billing_bank_account_name: string;
  billing_bank_account_number: string; billing_promptpay_id: string; billing_email: string;
  support_email: string; billing_vat_registered: boolean };
type RequestRow = { id: string; request_type: string; requested_package_id: string | null; status: string; amount_reported: number | null;
  currency: string; submitted_at: string; reviewed_at: string | null; review_note: string | null;
  evidence_url: string | null; metadata: Record<string, unknown> | null };
type Cycle = { id: string; status: string; amount_due: number; amount_paid: number; period_start: string; period_end: string };
type Receipt = {
  id: string; payment_request_id: string; billing_cycle_id: string; receipt_number: string;
  issued_at: string; amount: number; currency: string; package_snapshot: Record<string, unknown> | null
};

function positive(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 999999 ? Math.trunc(n) : null;
}
function amount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function loadPosSubscriptionCenter(tenantId: string) {
  // Commercial authority lives in CpiPOS-001, never in a trial tenant sales data plane.
  const db = getPrimarySupabaseServiceClient();
  const [tenantResult, contractResult, lifecycleResult, issuerResult, packagesResult, requestResult, cycleResult, receiptResult] = await Promise.all([
    db.from("tenants").select("id,code,name,display_name,package_id")
      .eq("id",tenantId).maybeSingle<Tenant>(),
    db.from("tenant_subscription_contracts")
      .select("id,package_id,status,billing_interval,amount_per_cycle,currency,started_at,ended_at,max_branches,branch_limit,max_devices,terminal_limit_per_branch,max_users")
      .eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(1).maybeSingle<Contract>(),
    db.from("tenant_data_lifecycle")
      .select("lifecycle_status,subscription_expires_at,trial_expires_at,access_locked,lock_reason,metadata")
      .eq("tenant_id",tenantId).maybeSingle<Lifecycle>(),
    db.from("it_communication_settings")
      .select("billing_legal_name_th,billing_bank_name,billing_bank_account_name,billing_bank_account_number,billing_promptpay_id,billing_email,support_email,billing_vat_registered")
      .eq("id","default").maybeSingle<Issuer>(),
    db.from("subscription_packages")
      .select("id,code,name,monthly_price,yearly_price,max_branches,max_devices,max_users,metadata")
      .eq("is_active",true).order("display_order",{ascending:true}).limit(30).returns<Package[]>(),
    db.from("tenant_subscription_payment_requests")
      .select("id,request_type,requested_package_id,status,amount_reported,currency,submitted_at,reviewed_at,review_note,evidence_url,metadata")
      .eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(30).returns<RequestRow[]>(),
    db.from("tenant_billing_cycles")
      .select("id,status,amount_due,amount_paid,period_start,period_end")
      .eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(30).returns<Cycle[]>(),
    db.from("tenant_subscription_receipts")
      .select("id,payment_request_id,billing_cycle_id,receipt_number,issued_at,amount,currency,package_snapshot")
      .eq("tenant_id",tenantId).order("issued_at",{ascending:false}).limit(50).returns<Receipt[]>()
  ]);
  for (const item of [tenantResult,contractResult,lifecycleResult,issuerResult,packagesResult,requestResult,cycleResult,receiptResult]) {
    if (item.error) throw new Error("Subscription information is temporarily unavailable.");
  }
  const tenant = tenantResult.data;
  if (!tenant) throw new Error("Store not found.");
  const contract = contractResult.data;
  const lifecycle = lifecycleResult.data;
  const packages = packagesResult.data ?? [];
  const pkg = packages.find((entry)=>entry.id === (contract?.package_id || tenant.package_id));
  const isInternalDemo = lifecycle?.lifecycle_status === "sales_demo" || lifecycle?.metadata?.quota_exempt === true;
  const cyclePrice = contract?.billing_interval === "yearly" ? pkg?.yearly_price : pkg?.monthly_price;
  const activePrice = amount(contract?.amount_per_cycle) ?? amount(cyclePrice);
  const expiry = isInternalDemo ? null
    : lifecycle?.lifecycle_status === "trial" || contract?.status === "trial"
      ? lifecycle?.trial_expires_at ?? contract?.ended_at ?? null
      : lifecycle?.subscription_expires_at ?? contract?.ended_at ?? null;
  const now = Date.now();
  const remaining = expiry && Number.isFinite(Date.parse(expiry))
    ? Math.ceil((Date.parse(expiry)-now)/86400000) : null;
  const issuer = issuerResult.data;
  return {
    store: { id: tenant.id, code: tenant.code || tenant.id.slice(0,8).toUpperCase(),
      name: tenant.display_name || tenant.name },
    contract: {
      id: contract?.id ?? null, package_id: pkg?.id ?? null, package_code: pkg?.code ?? null,
      package_name: pkg?.name ?? "ยังไม่กำหนดแพ็กเกจ",
      status: lifecycle?.access_locked ? "locked" : (contract?.status ?? lifecycle?.lifecycle_status ?? "no_contract"),
      billing_interval: contract?.billing_interval ?? "monthly", started_at: contract?.started_at ?? null,
      expires_at: expiry, days_remaining: remaining, is_internal_demo: isInternalDemo,
      amount_per_cycle: isInternalDemo ? null : activePrice, currency: contract?.currency ?? "THB",
      max_branches: positive(contract?.max_branches ?? contract?.branch_limit ?? pkg?.max_branches),
      max_devices: positive(contract?.max_devices ?? contract?.terminal_limit_per_branch ?? pkg?.max_devices),
      max_users: positive(contract?.max_users ?? pkg?.max_users)
    },
    packages: packages.map((row)=>({
      id: row.id, code: row.code, name: row.name,
      monthly_price: amount(row.monthly_price), yearly_price: amount(row.yearly_price),
      contact_sales: row.code === "custom" || row.metadata?.contact_sales === true
    })),
    issuer: {
      name: issuer?.billing_legal_name_th || "บริษัท คัตติ้งพอยท์ เทค จำกัด",
      bank_name: issuer?.billing_bank_name ?? "", account_name: issuer?.billing_bank_account_name ?? "",
      account_number: issuer?.billing_bank_account_number ?? "",
      promptpay_id: issuer?.billing_promptpay_id ?? "",
      billing_email: issuer?.billing_email || "cuttingpointtech@gmail.com",
      support_email: issuer?.support_email || "cuttingpointtech.support@gmail.com",
      vat_registered: issuer?.billing_vat_registered === true
    },
    requests: (requestResult.data ?? []).map((row)=>{
      const requestedPackage = packages.find((item) => item.id === row.requested_package_id);
      const expectedRaw = row.metadata?.expected_amount;
      const expected = expectedRaw == null || !Number.isFinite(Number(expectedRaw)) ? null : Number(expectedRaw);
      const issuedReceipt = (receiptResult.data ?? []).find((receipt) => receipt.payment_request_id === row.id);
      return {
        id:row.id,type:row.request_type,status:row.status,package_id:row.requested_package_id,
        package_name: requestedPackage?.name ?? "", package_code: requestedPackage?.code ?? "",
        billing_interval:row.metadata?.billing_interval === "yearly" ? "yearly" : "monthly",
        amount:row.amount_reported, expected_amount: expected,
        currency:row.currency,submitted_at:row.submitted_at,reviewed_at:row.reviewed_at,
        review_note:row.review_note,has_evidence:Boolean(row.evidence_url),
        kind: row.metadata?.kind === "payment_notice" ? "payment_notice" : "renewal_intent",
        receipt: issuedReceipt ? {
          id: issuedReceipt.id,
          number: issuedReceipt.receipt_number,
          issued_at: issuedReceipt.issued_at,
          amount: Number(issuedReceipt.amount),
          currency: issuedReceipt.currency || "THB"
        } : null
      };
    }),
    cycles: (cycleResult.data ?? []).map((row)=>({...row})),
    payment_summary: (() => {
      const receipts = receiptResult.data ?? [];
      const monthly = receipts.filter((row) => row.package_snapshot?.billing_interval !== "yearly");
      const yearly = receipts.filter((row) => row.package_snapshot?.billing_interval === "yearly");
      const sum = (rows: Receipt[]) => rows.reduce((total, row) => {
        const value = Number(row.amount);
        return total + (Number.isFinite(value) ? value : 0);
      }, 0);
      return {
        total_paid: sum(receipts),
        monthly_paid: sum(monthly),
        yearly_paid: sum(yearly),
        receipt_count: receipts.length,
        monthly_count: monthly.length,
        yearly_count: yearly.length
      };
    })(),
    control_plane: {
      authority: "CpIPOS-IT",
      source: "CpiPOS-001",
      connected: true,
      refreshed_at: new Date().toISOString(),
      open_request_count: (requestResult.data ?? []).filter((row) =>
        ["pending", "under_review"].includes(row.status)
      ).length
    },
    // Only immutable issued documents are exposed here. Customer-uploaded slips never create documents.
    documents: (receiptResult.data ?? []).map((row) => ({
      id: row.id,
      payment_request_id: row.payment_request_id,
      billing_cycle_id: row.billing_cycle_id,
      type: "receipt" as const,
      number: row.receipt_number,
      issued_at: row.issued_at,
      amount: Number(row.amount),
      currency: row.currency || "THB",
      package_name: typeof row.package_snapshot?.package_name === "string" ? row.package_snapshot.package_name : "",
      package_code: typeof row.package_snapshot?.package_code === "string" ? row.package_snapshot.package_code : "",
      billing_interval: row.package_snapshot?.billing_interval === "yearly" ? "yearly" : "monthly",
      period_start: typeof row.package_snapshot?.period_start === "string" ? row.package_snapshot.period_start : "",
      period_end: typeof row.package_snapshot?.period_end === "string" ? row.package_snapshot.period_end : ""
    }))
  };
}

export type PosSubscriptionCenterData = Awaited<ReturnType<typeof loadPosSubscriptionCenter>>;
