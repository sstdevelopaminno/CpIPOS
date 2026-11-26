-- Synthetic UAT only. No production migration.
-- Atomic void and replacement for latest movements in an open shift.
-- Never overwrite posted tax invoices or issued GL; never silently replay later stock.
begin;
create table public.recycling_amount_corrections(
 request_id uuid primary key, tenant_id uuid not null, branch_id uuid not null,
 original_id uuid not null, replacement_id uuid not null, actor_id uuid not null,
 payload jsonb not null, result jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,branch_id,original_id) references public.recycling_transactions(tenant_id,branch_id,id),
 foreign key(tenant_id,branch_id,replacement_id) references public.recycling_transactions(tenant_id,branch_id,id),
 unique(tenant_id,branch_id,original_id),unique(tenant_id,branch_id,replacement_id)
);
alter table public.recycling_amount_corrections enable row level security;
revoke all on public.recycling_amount_corrections from public,anon,authenticated;
grant select,insert on public.recycling_amount_corrections to service_role;
create function public.recycling_replace_eligible_bill(
 p_tenant_id uuid,p_branch_id uuid,p_original_id uuid,p_actor_id uuid,p_request_id uuid,
 p_expected_at timestamptz,p_expected_total bigint,p_lines jsonb,p_reason text,p_source text,
 p_stock_verified boolean,p_cash_verified boolean
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
 old_tx public.recycling_transactions%rowtype;
 new_tx public.recycling_transactions%rowtype;
 prior public.recycling_amount_corrections%rowtype;
 payload jsonb;
 posted jsonb;
 outcome jsonb;
 deltas jsonb;
 accounting_day date;
begin
 if p_request_id is null or p_expected_at is null or p_expected_total is null
    or p_stock_verified is distinct from true or p_source is null or p_source not in ('pos','finance')
    or length(btrim(coalesce(p_reason,''))) not between 10 and 500
    or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'recycling_amount_correction_invalid'; end if;
 if jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'recycling_amount_correction_invalid'; end if;
 if not exists(select 1 from public.user_branch_roles r join public.users_profiles u on u.id=r.user_id
  join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id
  join public.tenants t on t.id=r.tenant_id
  where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.user_id=p_actor_id
   and u.is_active and b.is_active and t.is_active
   and ((p_source='pos' and r.role::text in ('owner','manager')) or (p_source='finance' and r.role::text='accountant'))) then
  raise exception 'recycling_amount_correction_forbidden';
 end if;
 payload:=jsonb_build_object('expected_at',p_expected_at,'expected_total',p_expected_total,'lines',p_lines,'reason',btrim(p_reason),'source',p_source,'stock_verified',p_stock_verified,'cash_verified',p_cash_verified);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('recycling-amount-correction:'||p_request_id::text));
 select * into prior from public.recycling_amount_corrections where request_id=p_request_id;
 if found then
  if prior.tenant_id is distinct from p_tenant_id or prior.branch_id is distinct from p_branch_id
   or prior.original_id is distinct from p_original_id or prior.actor_id is distinct from p_actor_id
   or prior.payload is distinct from payload then raise exception 'recycling_amount_correction_conflict'; end if;
  return prior.result||jsonb_build_object('idempotent',true);
 end if;
 select * into old_tx from public.recycling_transactions where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_original_id;
 if not found then raise exception 'recycling_amount_correction_unavailable'; end if;
 -- Same lock order as canonical posting and VOID.
 perform 1 from public.shifts where tenant_id=p_tenant_id and branch_id=p_branch_id and id=old_tx.shift_id and status='open' for update;
 if not found then raise exception 'recycling_amount_correction_closed_shift'; end if;
 select * into strict old_tx from public.recycling_transactions where tenant_id=p_tenant_id and branch_id=p_branch_id and id=p_original_id for update;
 if old_tx.status<>'posted' or old_tx.effective_document_at is distinct from p_expected_at or old_tx.total_minor is distinct from p_expected_total then raise exception 'recycling_amount_correction_conflict'; end if;
 if old_tx.finance_document_id is not null then raise exception 'recycling_amount_correction_gl_reversal_required'; end if;
 if exists(select 1 from public.recycling_tax_invoices where transaction_id=old_tx.id) then raise exception 'recycling_amount_correction_tax_note_required'; end if;
 accounting_day:=(old_tx.effective_document_at at time zone 'Asia/Bangkok')::date;
 if exists(select 1 from public.finance_accounting_periods where tenant_id=p_tenant_id and branch_id=p_branch_id
  and period_month in (date_trunc('month',accounting_day)::date,date_trunc('month',now() at time zone 'Asia/Bangkok')::date) and locked_at is not null)
 then raise exception 'recycling_amount_correction_period_locked'; end if;
 if old_tx.tax_state is null then raise exception 'recycling_amount_correction_legacy_tax_unknown'; end if;
 if old_tx.tax_state='vat_recorded' and accounting_day<>(now() at time zone 'Asia/Bangkok')::date then raise exception 'recycling_amount_correction_historical_vat_review'; end if;
 if old_tx.settlement='cash' and p_cash_verified is distinct from true then raise exception 'recycling_amount_correction_cash_unverified'; end if;
 -- Existing RPC validates current catalog price, stock snapshots, cash and rights.
 -- A failure anywhere below rolls back both operations including receipt numbering.
 perform public.recycling_void_unposted_transaction(p_tenant_id,p_branch_id,old_tx.id,p_actor_id,p_request_id,btrim(p_reason),p_stock_verified,p_cash_verified);
 posted:=public.recycling_post_transaction_vat(p_tenant_id,p_branch_id,old_tx.shift_id,p_actor_id,p_request_id,old_tx.direction,old_tx.settlement,old_tx.counterparty_name,p_lines);
 if (posted->>'idempotent')::boolean then raise exception 'recycling_amount_correction_conflict'; end if;
 select * into strict new_tx from public.recycling_transactions where id=(posted->>'id')::uuid and tenant_id=p_tenant_id and branch_id=p_branch_id;
 if new_tx.tax_state is distinct from old_tx.tax_state
 or (new_tx.tax_snapshot-'calculated_at') is distinct from (old_tx.tax_snapshot-'calculated_at') then
  raise exception 'recycling_amount_correction_tax_regime_changed';
 end if;
 update public.recycling_transactions set document_at=old_tx.effective_document_at where id=new_tx.id and tenant_id=p_tenant_id and branch_id=p_branch_id;
 -- Audit net accounting impact as signed debit minus credit. No posted GL is modified.
 select coalesce(jsonb_agg(jsonb_build_object('account_code',account_code,'net_debit_minor',delta) order by account_code),'[]'::jsonb) into deltas
 from (select account_code,sum(case when transaction_id=new_tx.id then debit_minor-credit_minor else credit_minor-debit_minor end) delta
  from public.recycling_accounting_entries where tenant_id=p_tenant_id and branch_id=p_branch_id and transaction_id in (old_tx.id,new_tx.id)
  group by account_code having sum(case when transaction_id=new_tx.id then debit_minor-credit_minor else credit_minor-debit_minor end)<>0) d;
 outcome:=jsonb_build_object('applied',true,'idempotent',false,'original_id',old_tx.id,'original_receipt_no',old_tx.receipt_no,
  'replacement_id',new_tx.id,'replacement_receipt_no',new_tx.receipt_no,'old_total_minor',old_tx.total_minor,'new_total_minor',new_tx.total_minor,
  'vat_delta_minor',coalesce(new_tx.vat_minor,0)-coalesce(old_tx.vat_minor,0),'cogs_delta_minor',new_tx.cogs_minor-old_tx.cogs_minor,'subledger_delta',deltas);
 insert into public.recycling_amount_corrections(request_id,tenant_id,branch_id,original_id,replacement_id,actor_id,payload,result)
 values(p_request_id,p_tenant_id,p_branch_id,old_tx.id,new_tx.id,p_actor_id,payload,outcome);
 return outcome;
end;
$fn$;
revoke all on function public.recycling_replace_eligible_bill(uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,jsonb,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.recycling_replace_eligible_bill(uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,jsonb,text,text,boolean,boolean) to service_role;
commit;
