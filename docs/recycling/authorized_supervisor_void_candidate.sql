-- Candidate only: do not apply to production or include in migration history.
-- Based on the existing service-role-only VOID RPC; retain its cash, stock,
-- closed shift, posted GL and issued tax invoice guards.
BEGIN;
create or replace function public.recycling_void_unposted_transaction(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_transaction_id uuid,
  p_approver_user_id uuid,
  p_void_request_id uuid,
  p_reason text,
  p_stock_verified boolean,
  p_cash_returned_confirmed boolean
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $void$
declare
  v_original public.recycling_transactions%rowtype;
  v_shift public.shifts%rowtype;
  v_snapshot record;
  v_stock record;
  v_count integer;
  v_opening_cash_minor bigint;
  v_cash_net_minor bigint;
begin
  if p_tenant_id is null or p_branch_id is null or
     p_transaction_id is null or p_approver_user_id is null or
     p_void_request_id is null then
    raise exception 'recycling_void_identity_required';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 500 then
    raise exception 'recycling_void_reason_required';
  end if;
  if p_stock_verified is distinct from true then
    raise exception 'recycling_void_stock_confirmation_required';
  end if;

  -- First resolve the shift without holding the transaction row lock.
  -- Both ordinary posting and VOID acquire the shift row lock FIRST,
  -- guaranteeing a consistent lock order with close-shift operations.
  select * into v_original from public.recycling_transactions
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and id=p_transaction_id;
  if not found then raise exception 'recycling_void_original_missing'; end if;

  select * into v_shift from public.shifts
    where id=v_original.shift_id and tenant_id=p_tenant_id
      and branch_id=p_branch_id for update;
  if not found or v_shift.status<>'open' then
    raise exception 'recycling_void_shift_already_closed';
  end if;

  select * into v_original from public.recycling_transactions
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and id=p_transaction_id for update;
  if not found then raise exception 'recycling_void_original_missing'; end if;

  if v_original.status='voided' then
    if v_original.void_request_id=p_void_request_id and
       v_original.voided_by=p_approver_user_id and
       v_original.void_reason=btrim(p_reason) and
       v_original.void_stock_confirmed is true and
       v_original.void_cash_confirmed is not distinct from
         p_cash_returned_confirmed then
      return pg_catalog.jsonb_build_object(
        'id',v_original.id,'receipt_no',v_original.receipt_no,
        'status','voided','idempotent',true);
    end if;
    raise exception 'recycling_void_already_voided';
  end if;
  if v_original.status<>'posted' then raise exception 'recycling_void_invalid_status'; end if;
  if v_original.finance_document_id is not null then
    raise exception 'recycling_void_finance_already_posted';
  end if;
  if v_original.settlement='bank_transfer' then
    raise exception 'recycling_void_bank_reversal_requires_finance';
  end if;
  if v_original.settlement='cash' and
     p_cash_returned_confirmed is distinct from true then
    raise exception 'recycling_void_cash_confirmation_required';
  end if;
  -- An active owner/manager of this exact branch may correct their own
  -- receipt. A cashier or accountant cannot self-approve through this rule.
  if p_approver_user_id=v_original.operator_user_id and not exists (
    select 1 from public.user_branch_roles r
      join public.users_profiles u on u.id=r.user_id
      join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id
      join public.tenants t on t.id=r.tenant_id
    where r.user_id=p_approver_user_id and r.tenant_id=p_tenant_id
      and r.branch_id=p_branch_id and r.role::text in ('owner','manager')
      and u.is_active=true and b.is_active=true and t.is_active=true
  ) then
    raise exception 'recycling_void_self_approval_forbidden';
  end if;

  -- Check that actor is an authenticated, currently
  -- active manager/owner/accountant of exactly this tenant and branch.
  if not exists (
    select 1 from public.user_branch_roles r
      join public.users_profiles u on u.id=r.user_id
      join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id
      join public.tenants t on t.id=r.tenant_id
    where r.user_id=p_approver_user_id and r.tenant_id=p_tenant_id
      and r.branch_id=p_branch_id and r.role::text in ('owner','manager','accountant')
      and u.is_active=true and b.is_active=true and t.is_active=true
  ) then raise exception 'recycling_void_approver_forbidden'; end if;

  select count(*) into v_count from public.recycling_transaction_lines
  where tenant_id=p_tenant_id and branch_id=p_branch_id
    and transaction_id=v_original.id;
  if v_count<1 then raise exception 'recycling_void_lines_missing'; end if;

  -- DISTINCT ON picks the earliest original line for each material.
  -- Its before-snapshot represents the stock state to restore.
  -- The original may have repeated SKUs; all their writes share one
  -- transaction id in last_transaction_id.
  for v_snapshot in
    select distinct on (product_id)
      product_id,stock_qty_before,stock_cost_before_minor,
      stock_last_transaction_before
    from public.recycling_transaction_lines
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and transaction_id=v_original.id
    order by product_id,line_no
  loop
    select quantity_base,carrying_cost_minor,last_transaction_id
      into v_stock from public.recycling_stock_balances
      where tenant_id=p_tenant_id and branch_id=p_branch_id
        and product_id=v_snapshot.product_id for update;
    if not found or v_stock.last_transaction_id is distinct from v_original.id then
      raise exception 'recycling_void_material_has_later_movement';
    end if;
    -- A historical correction can change stock without replacing the last
    -- movement ID. Never restore a pre-correction snapshot over that change.
    -- The historical table is optional until its candidate is installed.
    if pg_catalog.to_regclass('public.recycling_historical_corrections') is not null then
      execute 'select count(*) from public.recycling_historical_corrections
        where tenant_id=$1 and branch_id=$2 and product_id=$3 and recorded_at >= $4'
        into v_count using p_tenant_id,p_branch_id,v_snapshot.product_id,v_original.created_at;
      if v_count>0 then
        raise exception 'recycling_void_historical_replay_required';
      end if;
    end if;
    update public.recycling_stock_balances set
      quantity_base=v_snapshot.stock_qty_before,
      carrying_cost_minor=v_snapshot.stock_cost_before_minor,
      last_transaction_id=v_snapshot.stock_last_transaction_before,
      updated_at=now()
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and product_id=v_snapshot.product_id;
  end loop;

  -- Existing posted subledger rows remain immutable evidence of the
  -- original receipt. Reports must exclude voided transactions from totals.
  -- Finance GL posting checks status='posted' under the same row lock.
  update public.recycling_transactions set
    status='voided',
    voided_at=now(),
    voided_by=p_approver_user_id,
    void_reason=btrim(p_reason),
    void_request_id=p_void_request_id,
    void_stock_confirmed=true,
    void_cash_confirmed=p_cash_returned_confirmed
  where id=v_original.id and tenant_id=p_tenant_id and branch_id=p_branch_id;

  -- If cancelling an earlier CASH sale requires returning cash to buyer,
  -- prevent a negative drawer. By holding shift lock we serialize with
  -- all buy/sell postings and any concurrent close-shift.
  if v_original.settlement='cash' then
    v_opening_cash_minor := pg_catalog.round(
      coalesce(v_shift.opening_cash,0)*100)::bigint;
    select coalesce(sum(
      case when direction='sell' then total_minor else -total_minor end),0)
      into v_cash_net_minor
      from public.recycling_transactions
      where tenant_id=p_tenant_id and branch_id=p_branch_id
        and shift_id=v_shift.id and status='posted' and settlement='cash';
    if v_opening_cash_minor+v_cash_net_minor<0 then
      raise exception 'recycling_void_cash_drawer_insufficient';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'id',v_original.id,'receipt_no',v_original.receipt_no,
    'status','voided','idempotent',false);
end;
$void$;

revoke all on function public.recycling_void_unposted_transaction(
  uuid,uuid,uuid,uuid,uuid,text,boolean,boolean
) from public,anon,authenticated;
grant execute on function public.recycling_void_unposted_transaction(
  uuid,uuid,uuid,uuid,uuid,text,boolean,boolean
) to service_role;

COMMIT;
