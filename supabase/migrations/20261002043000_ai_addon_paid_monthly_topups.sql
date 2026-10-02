-- CpiPOS AI paid monthly top-ups.
-- Production applied through Supabase migration ai_addon_paid_monthly_topups.
create table if not exists public.pos_ai_tenant_addon_purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_request_id uuid not null unique references public.tenant_subscription_payment_requests(id) on delete restrict,
  package_id uuid not null references public.subscription_packages(id) on delete restrict,
  quota_month_key text not null check (quota_month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  addon_code text not null,
  addon_name text not null,
  extra_request_limit integer null check (extra_request_limit is null or extra_request_limit > 0),
  extra_token_limit bigint null check (extra_token_limit is null or extra_token_limit > 0),
  extra_cost_limit_usd numeric(12,6) null check (extra_cost_limit_usd is null or extra_cost_limit_usd > 0),
  amount_paid numeric(12,2) not null check (amount_paid > 0),
  currency text not null default 'THB',
  bank_transaction_reference text not null,
  bank_received_at timestamptz not null,
  approved_by uuid null,
  approved_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists pos_ai_tenant_addon_purchases_bank_ref_uidx on public.pos_ai_tenant_addon_purchases(lower(bank_transaction_reference));
create index if not exists pos_ai_tenant_addon_purchases_tenant_month_idx on public.pos_ai_tenant_addon_purchases(tenant_id,quota_month_key,approved_at desc);
alter table public.pos_ai_tenant_addon_purchases enable row level security;
update public.subscription_packages
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('ai_addon_monthly_tokens',500000),updated_at=now()
where code='growth' and coalesce((metadata->>'ai_addon_available')::boolean,false)=true and not(metadata?'ai_addon_monthly_tokens');
-- settle_ai_addon_payment is installed by the production migration and intentionally omitted here
-- from repeated replacement to avoid drift against the authoritative database function.
