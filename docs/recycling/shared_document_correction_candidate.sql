-- Disposable UAT candidate, NOT production migration.
-- Only document-time correction, never amount/stock/GL mutation.
begin;
alter table public.recycling_transactions add column effective_document_at timestamptz
 generated always as (coalesce(document_at,created_at)) stored;
create index recycling_effective_document_at_idx on public.recycling_transactions(tenant_id,branch_id,effective_document_at);
create table public.recycling_document_corrections(
 request_id uuid primary key, tenant_id uuid not null, branch_id uuid not null,
 transaction_id uuid not null, actor_id uuid not null, source text not null check(source in ('pos','finance')),
 before_at timestamptz not null, after_at timestamptz not null,
 reason text not null check(length(reason) between 10 and 500),
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,branch_id,transaction_id) references public.recycling_transactions(tenant_id,branch_id,id)
);
alter table public.recycling_document_corrections enable row level security;
revoke all on public.recycling_document_corrections from public,anon,authenticated;
grant select,insert on public.recycling_document_corrections to service_role;
create function public.recycling_correct_document_time(
 p_tenant_id uuid,p_branch_id uuid,p_transaction_id uuid,p_actor_id uuid,p_request_id uuid,
 p_expected_at timestamptz,p_document_at timestamptz,p_reason text,p_source text
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
 tx public.recycling_transactions%rowtype;
 prior public.recycling_document_corrections%rowtype;
begin
 if p_request_id is null or p_expected_at is null or p_document_at is null
   or not pg_catalog.isfinite(p_document_at) or p_document_at>clock_timestamp()
   or p_document_at<clock_timestamp()-interval '370 days'
   or p_source is null or p_source not in ('pos','finance')
   or length(btrim(coalesce(p_reason,''))) not between 10 and 500 then
  raise exception 'recycling_correction_invalid';
 end if;
 if not exists(select 1 from public.user_branch_roles r join public.users_profiles u on u.id=r.user_id
  join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id
  join public.tenants t on t.id=r.tenant_id
  where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.user_id=p_actor_id
   and u.is_active and b.is_active and t.is_active
   and ((p_source='pos' and r.role::text in ('owner','manager')) or (p_source='finance' and r.role::text='accountant'))) then
  raise exception 'recycling_correction_forbidden';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('recycling-correction:'||p_request_id::text));
 select * into prior from public.recycling_document_corrections where request_id=p_request_id;
 if found then
  if prior.tenant_id is distinct from p_tenant_id or prior.branch_id is distinct from p_branch_id
   or prior.transaction_id is distinct from p_transaction_id or prior.actor_id is distinct from p_actor_id
   or prior.source is distinct from p_source or prior.before_at is distinct from p_expected_at
   or prior.after_at is distinct from p_document_at or prior.reason is distinct from btrim(p_reason) then
   raise exception 'recycling_correction_conflict';
  end if;
  return jsonb_build_object('applied',true,'idempotent',true,'document_at',prior.after_at);
 end if;
 select * into tx from public.recycling_transactions where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_transaction_id for update;
 if not found or tx.status<>'posted' then raise exception 'recycling_correction_unavailable'; end if;
 -- Posted GL and VAT require an adjustment workflow, not an altered document timestamp.
 if tx.finance_document_id is not null or coalesce(tx.vat_minor,0)<>0 or tx.tax_state='vat_recorded'
  or exists(select 1 from public.recycling_tax_invoices where transaction_id=tx.id) then
  raise exception 'recycling_correction_requires_adjustment';
 end if;
 if tx.effective_document_at is distinct from p_expected_at then raise exception 'recycling_correction_conflict'; end if;
 insert into public.recycling_document_corrections(request_id,tenant_id,branch_id,transaction_id,actor_id,source,before_at,after_at,reason)
 values(p_request_id,p_tenant_id,p_branch_id,p_transaction_id,p_actor_id,p_source,tx.effective_document_at,p_document_at,btrim(p_reason));
 update public.recycling_transactions set document_at=p_document_at
 where id=tx.id and tenant_id=p_tenant_id and branch_id=p_branch_id;
 return jsonb_build_object('applied',true,'idempotent',false,'document_at',p_document_at);
end;
$fn$;
revoke all on function public.recycling_correct_document_time(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.recycling_correct_document_time(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text) to service_role;
commit;
