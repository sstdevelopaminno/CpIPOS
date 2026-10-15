-- DRAFT ONLY. Deploy *after* inventory/ledger schema and end-to-end QA.
-- This additive guard is necessary before the Optical-only inventory is seeded.
-- It preserves all normal restaurant products because they have no rows in optical_stock_bins.
create or replace function app.prevent_optical_bin_generic_sale_v1()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,app
as $$
begin
  if exists(select 1 from public.optical_stock_bins b
    where b.tenant_id=new.tenant_id and b.branch_id=new.branch_id
      and b.product_id=new.product_id)
  then
    raise exception 'OPTICAL_INVENTORY_ONLY_USE_WORK_ORDER_FLOW';
  end if;
  return new;
end;
$$;
revoke all on function app.prevent_optical_bin_generic_sale_v1() from public,anon,authenticated;
-- Before introducing this trigger to a shared table, verify that no restaurant
-- tenant has (or can create) Optical bins. No data is modified by this draft.
create trigger trg_optical_stock_bins_not_generic_pos
  before insert or update of product_id,tenant_id,branch_id
  on public.order_items for each row
  execute function app.prevent_optical_bin_generic_sale_v1();

-- Deposit payments are not present in public.payments (legacy cash shift).
-- Reconciliation must include the Optical ledger from the same shift.
-- This scope-locked, read-only view is used for an explicit IT/cashier shift
-- cross-check before enabling feature; it does not silently alter shift totals.
create or replace function public.optical_shift_cash_summary_v1(
  p_tenant_id uuid,p_branch_id uuid,p_shift_id uuid
)
returns table(cash_received_lak numeric,bank_transfer_lak numeric,receipt_count bigint)
language sql stable security invoker set search_path=public,pg_temp
as $$
 select coalesce(sum(l.amount) filter(where l.method='cash'),0),
        coalesce(sum(l.amount) filter(where l.method='bank_transfer'),0),
        count(*)::bigint
 from public.optical_payment_ledger l
 join public.shifts s on s.id=l.shift_id and s.tenant_id=l.tenant_id
  and s.branch_id=l.branch_id
 where l.tenant_id=p_tenant_id and l.branch_id=p_branch_id
   and l.shift_id=p_shift_id;
$$;
revoke all on function public.optical_shift_cash_summary_v1(uuid,uuid,uuid)
  from PUBLIC,anon,authenticated;
grant execute on function public.optical_shift_cash_summary_v1(uuid,uuid,uuid)
  to service_role;
-- Go-live BLOCKER: POS cash-close must explicitly include this summary under
-- optical_deposit entitlement and compare with physical counted cash, with audit,
-- tests for shifts crossing midnight and concurrent payments. DO NOT enable
-- the feature merely because this function exists.
