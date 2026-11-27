-- REVIEW CANDIDATE ONLY. Promote into a CLI-generated migration after schema/UAT review.
-- No live changes performed by this file. Payment settlement remains authoritative.
begin;
create table public.tenant_custom_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  payment_request_id uuid not null unique references public.tenant_subscription_payment_requests(id) on delete restrict,
  package_id uuid not null references public.subscription_packages(id) on delete restrict,
  actor_user_id uuid not null,
  acceptance_channel text not null check (acceptance_channel in ('pos','line')),
  line_binding_id uuid,
  check ((acceptance_channel='line') = (line_binding_id is not null)),
  accepted_at timestamptz not null default clock_timestamp(),
  version text not null,
  signature_png_base64 text not null check (length(signature_png_base64) between 16 and 60000),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  amount_per_cycle numeric not null check (amount_per_cycle > 0),
  currency text not null,
  billing_interval text not null check (billing_interval in ('monthly','yearly'))
);
create table public.tenant_custom_agreement_activations (
  acceptance_id uuid primary key references public.tenant_custom_agreement_acceptances(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  settlement_id uuid not null unique references public.tenant_subscription_settlements(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  recorded_at timestamptz not null default clock_timestamp()
);
create index tenant_custom_agreement_activations_tenant_idx on public.tenant_custom_agreement_activations(tenant_id, ends_at);
alter table public.tenant_custom_agreement_acceptances enable row level security;
alter table public.tenant_custom_agreement_activations enable row level security;
revoke all on public.tenant_custom_agreement_acceptances, public.tenant_custom_agreement_activations from public, anon, authenticated, service_role;
grant select, insert on public.tenant_custom_agreement_acceptances, public.tenant_custom_agreement_activations to service_role;

-- Caller is the trusted server, which verifies the owner session and supplies
-- approved contract clauses/version and authorized issuer configuration.
create function public.custom_agreement_quote_or_accept(
  p_tenant_id uuid, p_request_id uuid, p_actor_user_id uuid,
  p_version text, p_clauses jsonb, p_director_name text, p_expected_snapshot jsonb default null,
  p_channel text default 'pos', p_line_binding_id uuid default null,
  p_signature_png_base64 text default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_req public.tenant_subscription_payment_requests%rowtype;
  v_prior public.tenant_custom_agreement_acceptances%rowtype;
  v_snapshot jsonb; v_amount numeric; v_interval text; v_currency text;
  v_tenant public.tenants%rowtype;
  v_issuer public.it_communication_settings%rowtype;
begin
  if p_signature_png_base64 is null or length(p_signature_png_base64) not between 16 and 60000
    or p_signature_png_base64 !~ '^[A-Za-z0-9+/]+={0,2}
    or nullif(btrim(p_version),'') is null or jsonb_typeof(p_clauses) is distinct from 'array' then
    raise exception 'agreement_configuration_missing';
  end if;
  if p_channel is null or p_channel not in ('pos','line') or (p_channel='line' and not exists (
    select 1 from public.line_support_bindings b join public.tenants t on t.id=b.tenant_id
    where b.id=p_line_binding_id and b.tenant_id=p_tenant_id and b.is_active
      and t.is_active and b.verified_owner_user_id=p_actor_user_id and t.primary_owner_user_id=p_actor_user_id
  )) or (p_channel='pos' and p_line_binding_id is not null) then
    raise exception 'agreement_actor_invalid';
  end if;
  select * into v_req from public.tenant_subscription_payment_requests
    where id=p_request_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'agreement_request_not_found'; end if;
  select * into v_prior from public.tenant_custom_agreement_acceptances
    where payment_request_id=p_request_id and tenant_id=p_tenant_id;
  if found then
    if p_expected_snapshot is not null and p_expected_snapshot is distinct from v_prior.snapshot then
      raise exception 'agreement_quote_changed';
    end if;
    return jsonb_build_object('id',v_prior.id,'snapshot',v_prior.snapshot,'accepted_at',v_prior.accepted_at);
  end if;
  if v_req.status <> 'pending' or v_req.evidence_url is not null or v_req.amount_reported is not null
    or v_req.metadata->>'source' is distinct from 'it_custom_agreement'
    or v_req.metadata->>'kind' is distinct from 'payment_notice'
    or jsonb_typeof(v_req.metadata->'custom_terms_snapshot') is distinct from 'object'
    or not exists(select 1 from public.subscription_packages where id=v_req.requested_package_id and lower(code)='custom')
    or exists(select 1 from public.tenant_subscription_settlements where payment_request_id=v_req.id) then
    raise exception 'agreement_request_not_eligible';
  end if;
  if exists(select 1 from public.tenant_data_lifecycle where tenant_id=p_tenant_id
     and (lifecycle_status='sales_demo' or metadata->>'quota_exempt'='true')) then
    raise exception 'agreement_request_not_eligible';
  end if;
  v_interval := v_req.metadata->>'billing_interval';
  v_currency := coalesce(nullif(v_req.currency,''),'THB');
  if coalesce(v_req.metadata->>'expected_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or v_interval is null or v_interval not in ('monthly','yearly') then
    raise exception 'agreement_price_missing';
  end if;
  v_amount := (v_req.metadata->>'expected_amount')::numeric;
  if v_amount <= 0 then raise exception 'agreement_price_missing'; end if;
  select * into strict v_tenant from public.tenants where id=p_tenant_id;
  select * into strict v_issuer from public.it_communication_settings where id='default';
  if nullif(btrim(v_tenant.company_address),'') is null or
     nullif(btrim(v_issuer.billing_legal_name_th),'') is null or
     nullif(btrim(v_issuer.billing_registration_no),'') is null or
     nullif(btrim(v_issuer.billing_registered_address),'') is null then
    raise exception 'agreement_party_details_missing';
  end if;
  v_snapshot := jsonb_build_object(
    'version',p_version,'clauses',p_clauses,'commitment_months',12,
    'request_id',v_req.id,'tenant_id',p_tenant_id,'package_id',v_req.requested_package_id,
    'store_name',coalesce(nullif(v_tenant.display_name,''),v_tenant.name),
    'company_address',v_tenant.company_address,
    'issuer_name',v_issuer.billing_legal_name_th,'issuer_registration',v_issuer.billing_registration_no,
    'issuer_address',v_issuer.billing_registered_address,'director_name',p_director_name,
    'signature_sha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.decode(p_signature_png_base64,'base64')),'hex'),
    'amount_per_cycle',v_amount,'currency',v_currency,'billing_interval',v_interval,
    'commercial_terms',v_req.metadata->'custom_terms_snapshot'
  );
  if exists(select 1 from public.tenant_custom_agreement_activations
    where tenant_id=p_tenant_id and ends_at>clock_timestamp()) then
    raise exception 'agreement_already_active';
  end if;
  if p_expected_snapshot is null then
    return jsonb_build_object('snapshot',v_snapshot,'accepted_at',null);
  end if;
  if p_expected_snapshot is distinct from v_snapshot then raise exception 'agreement_quote_changed'; end if;
  insert into public.tenant_custom_agreement_acceptances(tenant_id,payment_request_id,package_id,actor_user_id,acceptance_channel,line_binding_id,version,signature_png_base64,snapshot,amount_per_cycle,currency,billing_interval)
  values(p_tenant_id,p_request_id,v_req.requested_package_id,p_actor_user_id,p_channel,p_line_binding_id,p_version,p_signature_png_base64,v_snapshot,v_amount,v_currency,v_interval)
  returning * into v_prior;
  return jsonb_build_object('id',v_prior.id,'snapshot',v_prior.snapshot,'accepted_at',v_prior.accepted_at);
end;
$$;
revoke all on function public.custom_agreement_quote_or_accept(uuid,uuid,uuid,text,jsonb,text,jsonb,text,uuid,text) from public, anon, authenticated;
grant execute on function public.custom_agreement_quote_or_accept(uuid,uuid,uuid,text,jsonb,text,jsonb,text,uuid,text) to service_role;

-- Single activation point for all channels using canonical settlement.
-- Legacy/missing acceptance must not make settlement fail or bind a customer retroactively.
create function app.activate_custom_agreement_from_settlement()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare a public.tenant_custom_agreement_acceptances%rowtype;
begin
  select ca.* into a from public.tenant_custom_agreement_acceptances ca
    where ca.tenant_id=new.tenant_id and ca.payment_request_id=new.payment_request_id
      and package_id=new.package_id and billing_interval=new.billing_interval
      and amount_per_cycle=new.amount_received and currency=new.currency
      and accepted_at<=new.bank_received_at
      and exists(select 1 from public.tenant_subscription_payment_requests r
        where r.id=new.payment_request_id and r.tenant_id=new.tenant_id
          and r.metadata->'custom_terms_snapshot'=ca.snapshot->'commercial_terms');
  if not found then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.tenant_id::text, 572));
  if exists(select 1 from public.tenant_custom_agreement_activations
    where tenant_id=new.tenant_id and ends_at>new.bank_received_at) then return new; end if;
  insert into public.tenant_custom_agreement_activations(acceptance_id,tenant_id,settlement_id,starts_at,ends_at)
  values(a.id,new.tenant_id,new.id,new.bank_received_at,
    ((new.bank_received_at at time zone 'Asia/Bangkok') + interval '12 months') at time zone 'Asia/Bangkok')
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function app.activate_custom_agreement_from_settlement() from public, anon, authenticated;
grant execute on function app.activate_custom_agreement_from_settlement() to service_role;
create trigger trg_activate_custom_agreement_from_settlement after insert on public.tenant_subscription_settlements
for each row execute function app.activate_custom_agreement_from_settlement();
commit;
 then
    raise exception 'agreement_signature_missing';
  end if;
  if substring(pg_catalog.decode(p_signature_png_base64,'base64') from 1 for 8) <> pg_catalog.decode('89504e470d0a1a0a','hex') then
    raise exception 'agreement_signature_invalid';
  end if;
  if p_actor_user_id is null or nullif(btrim(p_director_name),'') is null
    or nullif(btrim(p_version),'') is null or jsonb_typeof(p_clauses) is distinct from 'array' then
    raise exception 'agreement_configuration_missing';
  end if;
  if p_channel is null or p_channel not in ('pos','line') or (p_channel='line' and not exists (
    select 1 from public.line_support_bindings b join public.tenants t on t.id=b.tenant_id
    where b.id=p_line_binding_id and b.tenant_id=p_tenant_id and b.is_active
      and t.is_active and b.verified_owner_user_id=p_actor_user_id and t.primary_owner_user_id=p_actor_user_id
  )) or (p_channel='pos' and p_line_binding_id is not null) then
    raise exception 'agreement_actor_invalid';
  end if;
  select * into v_req from public.tenant_subscription_payment_requests
    where id=p_request_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'agreement_request_not_found'; end if;
  select * into v_prior from public.tenant_custom_agreement_acceptances
    where payment_request_id=p_request_id and tenant_id=p_tenant_id;
  if found then
    if p_expected_snapshot is not null and p_expected_snapshot is distinct from v_prior.snapshot then
      raise exception 'agreement_quote_changed';
    end if;
    return jsonb_build_object('id',v_prior.id,'snapshot',v_prior.snapshot,'accepted_at',v_prior.accepted_at);
  end if;
  if v_req.status <> 'pending' or v_req.evidence_url is not null or v_req.amount_reported is not null
    or v_req.metadata->>'source' is distinct from 'it_custom_agreement'
    or v_req.metadata->>'kind' is distinct from 'payment_notice'
    or jsonb_typeof(v_req.metadata->'custom_terms_snapshot') is distinct from 'object'
    or not exists(select 1 from public.subscription_packages where id=v_req.requested_package_id and lower(code)='custom')
    or exists(select 1 from public.tenant_subscription_settlements where payment_request_id=v_req.id) then
    raise exception 'agreement_request_not_eligible';
  end if;
  if exists(select 1 from public.tenant_data_lifecycle where tenant_id=p_tenant_id
     and (lifecycle_status='sales_demo' or metadata->>'quota_exempt'='true')) then
    raise exception 'agreement_request_not_eligible';
  end if;
  v_interval := v_req.metadata->>'billing_interval';
  v_currency := coalesce(nullif(v_req.currency,''),'THB');
  if coalesce(v_req.metadata->>'expected_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or v_interval is null or v_interval not in ('monthly','yearly') then
    raise exception 'agreement_price_missing';
  end if;
  v_amount := (v_req.metadata->>'expected_amount')::numeric;
  if v_amount <= 0 then raise exception 'agreement_price_missing'; end if;
  select * into strict v_tenant from public.tenants where id=p_tenant_id;
  select * into strict v_issuer from public.it_communication_settings where id='default';
  if nullif(btrim(v_tenant.company_address),'') is null or
     nullif(btrim(v_issuer.billing_legal_name_th),'') is null or
     nullif(btrim(v_issuer.billing_registration_no),'') is null or
     nullif(btrim(v_issuer.billing_registered_address),'') is null then
    raise exception 'agreement_party_details_missing';
  end if;
  v_snapshot := jsonb_build_object(
    'version',p_version,'clauses',p_clauses,'commitment_months',12,
    'request_id',v_req.id,'tenant_id',p_tenant_id,'package_id',v_req.requested_package_id,
    'store_name',coalesce(nullif(v_tenant.display_name,''),v_tenant.name),
    'company_address',v_tenant.company_address,
    'issuer_name',v_issuer.billing_legal_name_th,'issuer_registration',v_issuer.billing_registration_no,
    'issuer_address',v_issuer.billing_registered_address,'director_name',p_director_name,
    'signature_sha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.decode(p_signature_png_base64,'base64')),'hex'),
    'amount_per_cycle',v_amount,'currency',v_currency,'billing_interval',v_interval,
    'commercial_terms',v_req.metadata->'custom_terms_snapshot'
  );
  if exists(select 1 from public.tenant_custom_agreement_activations
    where tenant_id=p_tenant_id and ends_at>clock_timestamp()) then
    raise exception 'agreement_already_active';
  end if;
  if p_expected_snapshot is null then
    return jsonb_build_object('snapshot',v_snapshot,'accepted_at',null);
  end if;
  if p_expected_snapshot is distinct from v_snapshot then raise exception 'agreement_quote_changed'; end if;
  insert into public.tenant_custom_agreement_acceptances(tenant_id,payment_request_id,package_id,actor_user_id,acceptance_channel,line_binding_id,version,signature_png_base64,snapshot,amount_per_cycle,currency,billing_interval)
  values(p_tenant_id,p_request_id,v_req.requested_package_id,p_actor_user_id,p_channel,p_line_binding_id,p_version,p_signature_png_base64,v_snapshot,v_amount,v_currency,v_interval)
  returning * into v_prior;
  return jsonb_build_object('id',v_prior.id,'snapshot',v_prior.snapshot,'accepted_at',v_prior.accepted_at);
end;
$$;
revoke all on function public.custom_agreement_quote_or_accept(uuid,uuid,uuid,text,jsonb,text,jsonb,text,uuid,text) from public, anon, authenticated;
grant execute on function public.custom_agreement_quote_or_accept(uuid,uuid,uuid,text,jsonb,text,jsonb,text,uuid,text) to service_role;

-- Single activation point for all channels using canonical settlement.
-- Legacy/missing acceptance must not make settlement fail or bind a customer retroactively.
create function app.activate_custom_agreement_from_settlement()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare a public.tenant_custom_agreement_acceptances%rowtype;
begin
  select ca.* into a from public.tenant_custom_agreement_acceptances ca
    where ca.tenant_id=new.tenant_id and ca.payment_request_id=new.payment_request_id
      and package_id=new.package_id and billing_interval=new.billing_interval
      and amount_per_cycle=new.amount_received and currency=new.currency
      and accepted_at<=new.bank_received_at
      and exists(select 1 from public.tenant_subscription_payment_requests r
        where r.id=new.payment_request_id and r.tenant_id=new.tenant_id
          and r.metadata->'custom_terms_snapshot'=ca.snapshot->'commercial_terms');
  if not found then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.tenant_id::text, 572));
  if exists(select 1 from public.tenant_custom_agreement_activations
    where tenant_id=new.tenant_id and ends_at>new.bank_received_at) then return new; end if;
  insert into public.tenant_custom_agreement_activations(acceptance_id,tenant_id,settlement_id,starts_at,ends_at)
  values(a.id,new.tenant_id,new.id,new.bank_received_at,
    ((new.bank_received_at at time zone 'Asia/Bangkok') + interval '12 months') at time zone 'Asia/Bangkok')
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function app.activate_custom_agreement_from_settlement() from public, anon, authenticated;
grant execute on function app.activate_custom_agreement_from_settlement() to service_role;
create trigger trg_activate_custom_agreement_from_settlement after insert on public.tenant_subscription_settlements
for each row execute function app.activate_custom_agreement_from_settlement();
commit;
