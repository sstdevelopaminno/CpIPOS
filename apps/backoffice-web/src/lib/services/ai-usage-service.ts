import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type UsageLike = {
  input_tokens?: number | null;
  input_tokens_details?: {
    cached_tokens?: number | null;
    cache_write_tokens?: number | null;
  } | null;
  output_tokens?: number | null;
  output_tokens_details?: {
    reasoning_tokens?: number | null;
  } | null;
  total_tokens?: number | null;
};

type PackageQuotaRow = {
  package_id: string;
  is_enabled: boolean;
  monthly_request_limit: number | null;
  monthly_token_limit: number | null;
  monthly_cost_limit_usd: number | string | null;
  history_retention_days: number | null;
  document_retention_days: number | null;
  document_storage_mb: number | null;
  document_file_limit: number | null;
};

type TenantOverrideRow = {
  tenant_id: string;
  quota_mode: "inherit" | "custom" | "unlimited";
  is_enabled_override: boolean | null;
  monthly_request_limit: number | null;
  monthly_token_limit: number | null;
  monthly_cost_limit_usd: number | string | null;
  history_retention_days: number | null;
  document_retention_days: number | null;
  document_storage_mb: number | null;
  document_file_limit: number | null;
};

type UsageSummaryRow = {
  request_count: number | string | null;
  input_tokens: number | string | null;
  cached_input_tokens: number | string | null;
  cache_write_tokens: number | string | null;
  output_tokens: number | string | null;
  reasoning_tokens: number | string | null;
  total_tokens: number | string | null;
  total_cost_usd: number | string | null;
};

type ContractRow = {
  package_id: string;
  status: string;
};

export type AiQuotaStatus = {
  enabled: boolean;
  source: "package" | "tenant_custom" | "tenant_unlimited";
  package_id: string | null;
  month_key: string;
  period_start: string;
  period_end: string;
  limits: {
    requests: number | null;
    tokens: number | null;
    cost_usd: number | null;
  };
  usage: {
    requests: number;
    input_tokens: number;
    cached_input_tokens: number;
    cache_write_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
  exhausted: boolean;
  exhausted_by: Array<"requests" | "tokens" | "cost">;
  history_retention_days: number | null;
  documents: {
    retention_days: number | null;
    storage_mb: number | null;
    file_limit: number | null;
  };
};

export class AiQuotaError extends Error {
  code: string;
  status: number;
  quota: AiQuotaStatus;

  constructor(code: string, message: string, quota: AiQuotaStatus, status = 429) {
    super(message);
    this.name = "AiQuotaError";
    this.code = code;
    this.status = status;
    this.quota = quota;
  }
}

const PRICING: Record<string, {
  short: { input: number; cachedInput: number; cacheWrite: number; output: number };
  long: { input: number; cachedInput: number; cacheWrite: number; output: number };
  longContextThreshold: number;
  source: string;
}> = {
  "gpt-6-luna": {
    short: { input: 0.10, cachedInput: 0.01, cacheWrite: 0.125, output: 0.50 },
    long: { input: 0.20, cachedInput: 0.02, cacheWrite: 0.25, output: 0.75 },
    longContextThreshold: 272_000,
    source: "openai:gpt-6-luna:2026-09-29:standard"
  }
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolvePricing(model: string, inputTokens: number) {
  const exact = PRICING[model];
  const key = exact ? model : Object.keys(PRICING).find((candidate) => model.startsWith(candidate));
  if (!key) return null;
  const table = PRICING[key];
  return {
    ...((inputTokens > table.longContextThreshold) ? table.long : table.short),
    source: table.source + (inputTokens > table.longContextThreshold ? ":long-context" : ":short-context")
  };
}

export function bangkokMonthBounds(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(at);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? at.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? (at.getUTCMonth() + 1));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const start = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+07:00`);
  const end = new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+07:00`);
  return {
    monthKey: `${year}-${String(month).padStart(2, "0")}`,
    start: start.toISOString(),
    end: end.toISOString()
  };
}

export async function loadAiQuotaStatus(tenantId: string): Promise<AiQuotaStatus> {
  const supabase = getSupabaseServiceClient();
  const bounds = bangkokMonthBounds();

  const contractResult = await supabase
    .from("tenant_subscription_contracts")
    .select("package_id,status")
    .eq("tenant_id", tenantId)
    .in("status", ["active", "trial"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ContractRow>();
  if (contractResult.error) throw new Error(`ai_quota_contract_lookup_failed:${contractResult.error.message}`);

  const packageId = contractResult.data?.package_id ?? null;
  const [packageResult, overrideResult, usageResult] = await Promise.all([
    packageId
      ? supabase
          .from("pos_ai_package_quotas")
          .select("package_id,is_enabled,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd,history_retention_days,document_retention_days,document_storage_mb,document_file_limit")
          .eq("package_id", packageId)
          .maybeSingle<PackageQuotaRow>()
      : Promise.resolve({ data: null as PackageQuotaRow | null, error: null }),
    supabase
      .from("pos_ai_tenant_quota_overrides")
      .select("tenant_id,quota_mode,is_enabled_override,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd,history_retention_days,document_retention_days,document_storage_mb,document_file_limit")
      .eq("tenant_id", tenantId)
      .maybeSingle<TenantOverrideRow>(),
    supabase.rpc("pos_ai_usage_summary", {
      p_tenant_id: tenantId,
      p_started_at: bounds.start,
      p_ended_at: bounds.end
    })
  ]);

  if (packageResult.error) throw new Error(`ai_package_quota_lookup_failed:${packageResult.error.message}`);
  if (overrideResult.error) throw new Error(`ai_tenant_quota_lookup_failed:${overrideResult.error.message}`);
  if (usageResult.error) throw new Error(`ai_usage_summary_failed:${usageResult.error.message}`);

  const packageQuota = packageResult.data;
  const override = overrideResult.data;
  const mode = override?.quota_mode ?? "inherit";
  const source: AiQuotaStatus["source"] =
    mode === "unlimited" ? "tenant_unlimited" :
    mode === "custom" ? "tenant_custom" :
    "package";

  const limits = mode === "unlimited"
    ? { requests: null, tokens: null, cost_usd: null }
    : mode === "custom"
      ? {
          requests: nullableLimit(override?.monthly_request_limit),
          tokens: nullableLimit(override?.monthly_token_limit),
          cost_usd: nullableLimit(override?.monthly_cost_limit_usd)
        }
      : {
          requests: nullableLimit(packageQuota?.monthly_request_limit),
          tokens: nullableLimit(packageQuota?.monthly_token_limit),
          cost_usd: nullableLimit(packageQuota?.monthly_cost_limit_usd)
        };

  const enabled = override?.is_enabled_override ?? packageQuota?.is_enabled ?? true;
  const historyRetentionDays =
    nullableLimit(override?.history_retention_days) ??
    nullableLimit(packageQuota?.history_retention_days);
  const documentPolicy = {
    retention_days: nullableLimit(override?.document_retention_days) ?? nullableLimit(packageQuota?.document_retention_days),
    storage_mb: nullableLimit(override?.document_storage_mb) ?? nullableLimit(packageQuota?.document_storage_mb),
    file_limit: nullableLimit(override?.document_file_limit) ?? nullableLimit(packageQuota?.document_file_limit)
  };
  const row = ((usageResult.data ?? []) as UsageSummaryRow[])[0] ?? null;
  const usage = {
    requests: Math.max(0, Math.trunc(numberValue(row?.request_count))),
    input_tokens: Math.max(0, Math.trunc(numberValue(row?.input_tokens))),
    cached_input_tokens: Math.max(0, Math.trunc(numberValue(row?.cached_input_tokens))),
    cache_write_tokens: Math.max(0, Math.trunc(numberValue(row?.cache_write_tokens))),
    output_tokens: Math.max(0, Math.trunc(numberValue(row?.output_tokens))),
    reasoning_tokens: Math.max(0, Math.trunc(numberValue(row?.reasoning_tokens))),
    total_tokens: Math.max(0, Math.trunc(numberValue(row?.total_tokens))),
    cost_usd: Number(numberValue(row?.total_cost_usd).toFixed(8))
  };

  const exhaustedBy: AiQuotaStatus["exhausted_by"] = [];
  if (limits.requests !== null && usage.requests >= limits.requests) exhaustedBy.push("requests");
  if (limits.tokens !== null && usage.total_tokens >= limits.tokens) exhaustedBy.push("tokens");
  if (limits.cost_usd !== null && usage.cost_usd >= limits.cost_usd) exhaustedBy.push("cost");

  return {
    enabled,
    source,
    package_id: packageId,
    month_key: bounds.monthKey,
    period_start: bounds.start,
    period_end: bounds.end,
    limits,
    usage,
    exhausted: exhaustedBy.length > 0,
    exhausted_by: exhaustedBy,
    history_retention_days: historyRetentionDays,
    documents: documentPolicy
  };
}

export async function assertAiQuotaAvailable(tenantId: string) {
  const quota = await loadAiQuotaStatus(tenantId);
  if (!quota.enabled) {
    throw new AiQuotaError("ai_quota_disabled", "CpiPOS AI ถูกปิดตามนโยบายแพ็กเกจหรือร้านค้า", quota, 403);
  }
  if (quota.exhausted) {
    throw new AiQuotaError(
      "ai_monthly_quota_exhausted",
      "โควตา CpiPOS AI ประจำเดือนของร้านนี้ครบแล้ว กรุณาติดต่อผู้ดูแลแพ็กเกจ",
      quota,
      429
    );
  }
  return quota;
}

export async function recordAiUsage(input: {
  tenantId: string;
  branchId: string;
  userId: string;
  conversationId: string;
  promptText: string;
  responsePayload: unknown;
  fallbackModel: string;
}) {
  const payload = (input.responsePayload ?? {}) as {
    id?: string | null;
    model?: string | null;
    status?: string | null;
    service_tier?: string | null;
    usage?: UsageLike | null;
  };
  const usage = payload.usage ?? {};
  const model = String(payload.model ?? input.fallbackModel ?? "unknown");
  const inputTokens = Math.max(0, Math.trunc(numberValue(usage.input_tokens)));
  const pricing = resolvePricing(model, inputTokens);
  const cachedTokens = Math.max(0, Math.min(inputTokens, Math.trunc(numberValue(usage.input_tokens_details?.cached_tokens))));
  const cacheWriteTokens = Math.max(0, Math.min(inputTokens - cachedTokens, Math.trunc(numberValue(usage.input_tokens_details?.cache_write_tokens))));
  const ordinaryInputTokens = Math.max(0, inputTokens - cachedTokens - cacheWriteTokens);
  const outputTokens = Math.max(0, Math.trunc(numberValue(usage.output_tokens)));
  const reasoningTokens = Math.max(0, Math.trunc(numberValue(usage.output_tokens_details?.reasoning_tokens)));
  const totalTokens = Math.max(0, Math.trunc(numberValue(usage.total_tokens || (inputTokens + outputTokens))));

  const inputCost = pricing ? ordinaryInputTokens * pricing.input / 1_000_000 : 0;
  const cachedCost = pricing ? cachedTokens * pricing.cachedInput / 1_000_000 : 0;
  const cacheWriteCost = pricing ? cacheWriteTokens * pricing.cacheWrite / 1_000_000 : 0;
  const outputCost = pricing ? outputTokens * pricing.output / 1_000_000 : 0;
  const totalCost = inputCost + cachedCost + cacheWriteCost + outputCost;

  const { error } = await getSupabaseServiceClient()
    .from("pos_ai_usage_events")
    .insert({
      tenant_id: input.tenantId,
      branch_id: input.branchId,
      user_id: input.userId,
      openai_conversation_id: input.conversationId,
      response_id: payload.id ?? null,
      model,
      prompt_text: input.promptText.slice(0, 1200),
      input_tokens: inputTokens,
      cached_input_tokens: cachedTokens,
      cache_write_tokens: cacheWriteTokens,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      total_tokens: totalTokens,
      input_cost_usd: Number(inputCost.toFixed(8)),
      cached_input_cost_usd: Number(cachedCost.toFixed(8)),
      cache_write_cost_usd: Number(cacheWriteCost.toFixed(8)),
      output_cost_usd: Number(outputCost.toFixed(8)),
      total_cost_usd: Number(totalCost.toFixed(8)),
      pricing_source: pricing?.source ?? "unpriced_model",
      service_tier: payload.service_tier ?? null,
      status: payload.status === "incomplete" ? "incomplete" : payload.status === "failed" ? "failed" : "completed"
    });
  if (error) throw new Error(`ai_usage_write_failed:${error.message}`);

  return {
    model,
    response_id: payload.id ?? null,
    usage: {
      input_tokens: inputTokens,
      cached_input_tokens: cachedTokens,
      cache_write_tokens: cacheWriteTokens,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      total_tokens: totalTokens
    },
    cost_usd: Number(totalCost.toFixed(8)),
    pricing_source: pricing?.source ?? "unpriced_model"
  };
}
