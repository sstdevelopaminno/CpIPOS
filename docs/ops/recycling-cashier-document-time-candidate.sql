-- REVIEW CANDIDATE: no production DDL executed.
-- Reuse the canonical atomic stock/cash/ledger post and audited document date
-- correction in ONE PostgreSQL transaction. Never change created_at or shift.
begin;
create function public.recycling_post_transaction_with_document_time(
 p_tenant_id uuid,p_branch_id uuid,p_shift_id uuid,p_user_id uuid,p_request_id uuid,
 p_direction text,p_settlement text,p_counterparty_name text,p_lines jsonb,
 p_document_at timestamptz,p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
 v_result jsonb; tx public.recycling_transactions%rowtype;
 prior public.recycling_document_corrections%rowtype;
 v_enabled boolean;
begin
 if p_document_at is null or not pg_catalog.isfinite(p_document_at) or p_document_at>clock_timestamp()
  or p_document_at<clock_timestamp()-interval '370 days' or length(btrim(coalesce(p_reason,''))) not between 10 and 500 then
   raise exception 'recycling_correction_invalid';
 end if;
 if not exists(select 1 from public.user_branch_roles r join public.users_profiles u on u.id=r.user_id
  where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.user_id=p_user_id
  and r.role::text in ('owner','manager') and u.is_active) then raise exception 'recycling_correction_forbidden'; end if;
 -- Same lock as canonical posting: serializes retries with the ordinary RPC.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_tenant_id::text||':'||p_branch_id::text||':'||p_request_id::text));
 select * into tx from public.recycling_transactions where tenant_id=p_tenant_id and branch_id=p_branch_id and request_id=p_request_id;
 if found then
   select * into prior from public.recycling_document_corrections where request_id=p_request_id;
   if not found or prior.transaction_id is distinct from tx.id or prior.tenant_id is distinct from p_tenant_id
    or prior.branch_id is distinct from p_branch_id or prior.actor_id is distinct from p_user_id
    or prior.after_at is distinct from p_document_at or prior.reason is distinct from btrim(p_reason)
    or prior.source is distinct from 'pos' then raise exception 'recycling_request_key_reused'; end if;
   return public.recycling_post_transaction_vat(p_tenant_id,p_branch_id,p_shift_id,p_user_id,p_request_id,p_direction,p_settlement,p_counterparty_name,p_lines);
 end if;
 select (metadata->'recycling_cashier_document_time_v1'->p_branch_id::text->'enabled')='true'::jsonb
 into v_enabled from public.tenants where id=p_tenant_id and is_active for share;
 if v_enabled is distinct from true then raise exception 'recycling_cashier_date_disabled'; end if;
 v_result:=public.recycling_post_transaction_vat(p_tenant_id,p_branch_id,p_shift_id,p_user_id,p_request_id,p_direction,p_settlement,p_counterparty_name,p_lines);
 select * into strict tx from public.recycling_transactions where tenant_id=p_tenant_id and branch_id=p_branch_id and id=(v_result->>'id')::uuid;
 -- The existing correction function rejects VAT, already-posted GL, locked periods,
 -- invalid dates and unauthorized actors. Any rejection rolls back the whole bill.
 perform public.recycling_correct_document_time(p_tenant_id,p_branch_id,tx.id,p_user_id,p_request_id,tx.effective_document_at,p_document_at,p_reason,'pos');
 return v_result||jsonb_build_object('document_at',p_document_at);
end;
$fn$;
revoke all on function public.recycling_post_transaction_with_document_time(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.recycling_post_transaction_with_document_time(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,timestamptz,text) to service_role;
commit;
