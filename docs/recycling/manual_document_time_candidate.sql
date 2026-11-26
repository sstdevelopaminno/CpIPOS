-- Isolated UAT candidate ONLY. Do not run on Production until every document
-- reader, accounting-period and VAT policy is verified.
begin;
alter table public.recycling_transactions add column document_at timestamptz;
create or replace function public.recycling_post_transaction_with_document_time(
  p_tenant_id uuid,p_branch_id uuid,p_shift_id uuid,p_user_id uuid,p_request_id uuid,
  p_direction text,p_settlement text,p_counterparty_name text,p_lines jsonb,p_document_at timestamptz
) returns jsonb language plpgsql security invoker set search_path='' as $doc$
declare
  v_result jsonb;
  v_tx public.recycling_transactions%rowtype;
begin
  if p_document_at is not null and (not pg_catalog.isfinite(p_document_at) or p_document_at>clock_timestamp()) then
    raise exception 'recycling_document_time_invalid';
  end if;
  -- Same canonical RPC and same transaction: all inventory, cash, ledger
  -- and request-hash validation remains authoritative, no partial writes.
  v_result:=public.recycling_post_transaction_vat(p_tenant_id,p_branch_id,p_shift_id,p_user_id,p_request_id,
    p_direction,p_settlement,p_counterparty_name,p_lines);
  select * into strict v_tx from public.recycling_transactions
    where tenant_id=p_tenant_id and branch_id=p_branch_id and id=(v_result->>'id')::uuid for update;
  if (v_result->>'idempotent')::boolean then
    if v_tx.document_at is distinct from p_document_at then raise exception 'recycling_document_time_conflict'; end if;
    return v_result||jsonb_build_object('document_at',v_tx.document_at);
  end if;
  -- Candidate deliberately refuses VAT sales until historical tax periods
  -- and rate/issuer snapshots are reconciled. Entire posting rolls back.
  if p_document_at is not null and (coalesce(v_tx.vat_minor,0)<>0 or v_tx.tax_state='vat_recorded') then
    raise exception 'recycling_document_time_vat_unsupported';
  end if;
  if p_document_at is null then return v_result; end if;
  update public.recycling_transactions set document_at=p_document_at
    where id=v_tx.id and tenant_id=p_tenant_id and branch_id=p_branch_id;
  return v_result||jsonb_build_object('document_at',p_document_at);
end;
$doc$;
revoke all on function public.recycling_post_transaction_with_document_time(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.recycling_post_transaction_with_document_time(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,timestamptz) to service_role;
commit;
