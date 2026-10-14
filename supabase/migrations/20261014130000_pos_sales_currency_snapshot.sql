-- Persist POS tender currency at the database INSERT boundary, including SQL RPC sales.
-- Existing orders are intentionally unchanged: absent currency_code means historic THB.
-- Subscription billing currency remains independent.
create or replace function app.stamp_pos_order_currency()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $function$
declare
  v_currency text := 'THB';
begin
  select case when c.metadata ->> 'pos_currency_code' = 'LAK' then 'LAK' else 'THB' end
    into v_currency
  from public.tenant_subscription_contracts c
  where c.tenant_id = new.tenant_id
  order by c.created_at desc
  limit 1;
  new.metadata := jsonb_set(
    coalesce(new.metadata, '{}'::jsonb),
    '{currency_code}',
    to_jsonb(coalesce(v_currency, 'THB')),
    true
  );
  return new;
end
$function$;

revoke all on function app.stamp_pos_order_currency() from public, anon, authenticated;

do $block$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'trg_pos_order_currency_on_insert'
      and not tgisinternal
  ) then
    create trigger trg_pos_order_currency_on_insert
    before insert on public.orders
    for each row
    execute function app.stamp_pos_order_currency();
  end if;
end
$block$;
