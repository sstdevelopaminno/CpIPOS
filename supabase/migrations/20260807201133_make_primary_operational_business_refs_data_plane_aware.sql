alter table public.print_jobs drop constraint if exists print_jobs_order_id_fkey;
alter table public.cash_drawer_events drop constraint if exists cash_drawer_events_order_id_fkey;
alter table public.cash_drawer_events drop constraint if exists cash_drawer_events_payment_id_fkey;
alter table public.mobile_member_qr_tokens drop constraint if exists mobile_member_qr_tokens_redeemed_order_id_fkey;
alter table public.mobile_member_transactions drop constraint if exists mobile_member_transactions_order_id_fkey;

create or replace function app.business_object_route_matches(
  p_object_type text,
  p_object_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app, extensions
as $$
begin
  if p_object_id is null then return true; end if;

  if p_object_type = 'orders' and exists (
    select 1 from public.orders o
    where o.id=p_object_id and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id
  ) then return true; end if;

  if p_object_type = 'payments' and exists (
    select 1 from public.payments p
    where p.id=p_object_id and p.tenant_id=p_tenant_id and p.branch_id=p_branch_id
  ) then return true; end if;

  return exists (
    select 1 from public.tenant_data_object_routes r
    where r.object_type=p_object_type
      and r.object_id=p_object_id
      and r.tenant_id=p_tenant_id
      and r.branch_id=p_branch_id
  );
end;
$$;

revoke all on function app.business_object_route_matches(text,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function app.business_object_route_matches(text,uuid,uuid,uuid) to service_role;

create or replace function app.enforce_primary_operational_business_refs()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
begin
  if tg_table_name = 'print_jobs' then
    if new.order_id is not null and not app.business_object_route_matches('orders',new.order_id,new.tenant_id,new.branch_id) then
      raise exception 'PRINT_JOB_ORDER_ROUTE_MISMATCH:%', new.order_id;
    end if;
  elsif tg_table_name = 'cash_drawer_events' then
    if new.order_id is not null and not app.business_object_route_matches('orders',new.order_id,new.tenant_id,new.branch_id) then
      raise exception 'CASH_DRAWER_ORDER_ROUTE_MISMATCH:%', new.order_id;
    end if;
    if new.payment_id is not null and not app.business_object_route_matches('payments',new.payment_id,new.tenant_id,new.branch_id) then
      raise exception 'CASH_DRAWER_PAYMENT_ROUTE_MISMATCH:%', new.payment_id;
    end if;
  elsif tg_table_name = 'mobile_member_qr_tokens' then
    if new.redeemed_order_id is not null and not app.business_object_route_matches('orders',new.redeemed_order_id,new.tenant_id,new.branch_id) then
      raise exception 'MEMBER_QR_ORDER_ROUTE_MISMATCH:%', new.redeemed_order_id;
    end if;
  elsif tg_table_name = 'mobile_member_transactions' then
    if new.order_id is not null and not app.business_object_route_matches('orders',new.order_id,new.tenant_id,new.branch_id) then
      raise exception 'MEMBER_TRANSACTION_ORDER_ROUTE_MISMATCH:%', new.order_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app.enforce_primary_operational_business_refs() from public, anon, authenticated;
grant execute on function app.enforce_primary_operational_business_refs() to service_role;

drop trigger if exists trg_print_jobs_business_refs on public.print_jobs;
create trigger trg_print_jobs_business_refs before insert or update of tenant_id,branch_id,order_id on public.print_jobs
for each row execute function app.enforce_primary_operational_business_refs();

drop trigger if exists trg_cash_drawer_events_business_refs on public.cash_drawer_events;
create trigger trg_cash_drawer_events_business_refs before insert or update of tenant_id,branch_id,order_id,payment_id on public.cash_drawer_events
for each row execute function app.enforce_primary_operational_business_refs();

drop trigger if exists trg_mobile_member_qr_tokens_business_refs on public.mobile_member_qr_tokens;
create trigger trg_mobile_member_qr_tokens_business_refs before insert or update of tenant_id,branch_id,redeemed_order_id on public.mobile_member_qr_tokens
for each row execute function app.enforce_primary_operational_business_refs();

drop trigger if exists trg_mobile_member_transactions_business_refs on public.mobile_member_transactions;
create trigger trg_mobile_member_transactions_business_refs before insert or update of tenant_id,branch_id,order_id on public.mobile_member_transactions
for each row execute function app.enforce_primary_operational_business_refs();
