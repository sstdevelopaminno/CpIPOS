-- QR table-order notification / kitchen automation controls.
-- Defaults preserve existing behavior: popup, kitchen dispatch and kitchen printing remain enabled.

alter table public.tenant_pos_notification_settings
  add column if not exists table_qr_popup_store_enabled boolean not null default true,
  add column if not exists table_qr_kitchen_auto_send_enabled boolean not null default true,
  add column if not exists table_qr_kitchen_auto_print_enabled boolean not null default true,
  add column if not exists table_qr_popup_override text not null default 'inherit',
  add column if not exists table_qr_kitchen_auto_send_override text not null default 'inherit',
  add column if not exists table_qr_kitchen_auto_print_override text not null default 'inherit';

update public.tenant_pos_notification_settings
set table_qr_popup_store_enabled = table_qr_popup_enabled
where table_qr_popup_store_enabled is distinct from table_qr_popup_enabled;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_pos_notification_settings_popup_override_check'
      and conrelid = 'public.tenant_pos_notification_settings'::regclass
  ) then
    alter table public.tenant_pos_notification_settings
      add constraint tenant_pos_notification_settings_popup_override_check
      check (table_qr_popup_override in ('inherit','force_on','force_off'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_pos_notification_settings_kitchen_send_override_check'
      and conrelid = 'public.tenant_pos_notification_settings'::regclass
  ) then
    alter table public.tenant_pos_notification_settings
      add constraint tenant_pos_notification_settings_kitchen_send_override_check
      check (table_qr_kitchen_auto_send_override in ('inherit','force_on','force_off'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_pos_notification_settings_kitchen_print_override_check'
      and conrelid = 'public.tenant_pos_notification_settings'::regclass
  ) then
    alter table public.tenant_pos_notification_settings
      add constraint tenant_pos_notification_settings_kitchen_print_override_check
      check (table_qr_kitchen_auto_print_override in ('inherit','force_on','force_off'));
  end if;
end $$;

create or replace function app.route_inserted_order_items_to_kitchen()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app', 'extensions'
as $function$
declare
  v_batch record;
  v_action text;
  v_order_channel text;
  v_store_enabled boolean;
  v_override text;
  v_effective_send boolean;
begin
  for v_batch in
    select
      ni.tenant_id,
      ni.branch_id,
      ni.order_id,
      array_agg(ni.id order by ni.id) as item_ids,
      md5(string_agg(ni.id::text, ',' order by ni.id)) as item_hash
    from new_order_items ni
    group by ni.tenant_id, ni.branch_id, ni.order_id
  loop
    select coalesce(o.channel, '')
      into v_order_channel
    from public.orders o
    where o.id = v_batch.order_id
      and o.tenant_id = v_batch.tenant_id
      and o.branch_id = v_batch.branch_id
    limit 1;

    -- The new controls apply only to orders submitted from the table QR channel.
    -- Staff-created POS orders keep the existing kitchen routing behavior.
    if v_order_channel = 'table_qr' then
      select
        coalesce(s.table_qr_kitchen_auto_send_enabled, true),
        coalesce(s.table_qr_kitchen_auto_send_override, 'inherit')
      into v_store_enabled, v_override
      from public.tenant_pos_notification_settings s
      where s.tenant_id = v_batch.tenant_id
        and s.branch_id = v_batch.branch_id
      limit 1;

      if not found then
        v_store_enabled := true;
        v_override := 'inherit';
      end if;

      v_effective_send := case v_override
        when 'force_on' then true
        when 'force_off' then false
        else coalesce(v_store_enabled, true)
      end;

      if not v_effective_send then
        continue;
      end if;
    end if;

    if exists (
      select 1
      from public.order_items oi
      where oi.tenant_id = v_batch.tenant_id
        and oi.branch_id = v_batch.branch_id
        and oi.order_id = v_batch.order_id
        and not (oi.id = any(v_batch.item_ids))
    ) then
      v_action := 'add';
    else
      v_action := 'new';
    end if;

    perform *
    from app.enqueue_kitchen_order(
      v_batch.tenant_id,
      v_batch.branch_id,
      v_batch.order_id,
      'order:' || v_batch.order_id::text || ':items:' || v_batch.item_hash,
      v_action,
      v_batch.item_ids
    );
  end loop;
  return null;
end;
$function$;
