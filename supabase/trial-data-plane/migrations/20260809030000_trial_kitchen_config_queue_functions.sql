-- Trial mirror: Kitchen configuration transactions + KDS ticket status transitions.
-- CpiPOS-002 only.

create or replace function app.replace_kitchen_routes(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_scope_type text,
  p_zone_ids uuid[],
  p_product_id uuid default null,
  p_category_name text default null,
  p_actor_user_id uuid default null
)
returns table (route_id uuid, zone_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_scope text := lower(btrim(coalesce(p_scope_type, '')));
  v_category text := nullif(btrim(coalesce(p_category_name, '')), '');
  v_zone_ids uuid[] := '{}'::uuid[];
  v_requested integer := 0;
  v_found integer := 0;
begin
  if v_scope not in ('product','category','default') then
    raise exception 'KITCHEN_ROUTE_SCOPE_INVALID';
  end if;

  select coalesce(array_agg(distinct u.zone_id), '{}'::uuid[])
    into v_zone_ids
  from unnest(coalesce(p_zone_ids, '{}'::uuid[])) as u(zone_id)
  where u.zone_id is not null;

  select count(*) into v_requested from unnest(v_zone_ids);
  select count(*) into v_found
  from public.kitchen_zones z
  where z.tenant_id = p_tenant_id
    and z.branch_id = p_branch_id
    and z.is_active = true
    and z.id = any(v_zone_ids);

  if v_requested <> v_found then
    raise exception 'KITCHEN_ROUTE_ZONE_INVALID';
  end if;

  if v_scope = 'product' then
    if p_product_id is null then raise exception 'KITCHEN_ROUTE_PRODUCT_REQUIRED'; end if;
    if not exists (
      select 1 from public.products p
      where p.id = p_product_id
        and p.tenant_id = p_tenant_id
        and p.branch_id = p_branch_id
    ) then
      raise exception 'KITCHEN_ROUTE_PRODUCT_NOT_FOUND';
    end if;

    delete from public.kitchen_routing_rules r
    where r.tenant_id = p_tenant_id
      and r.branch_id = p_branch_id
      and r.product_id = p_product_id
      and r.category_name is null;

    insert into public.kitchen_routing_rules(
      tenant_id,branch_id,zone_id,product_id,category_name,priority,is_active,created_by,metadata
    )
    select p_tenant_id,p_branch_id,u.zone_id,p_product_id,null,100,true,p_actor_user_id,
           jsonb_build_object('source','app.replace_kitchen_routes','scope_type','product')
    from unnest(v_zone_ids) as u(zone_id)
    on conflict do nothing;

    return query
    select r.id,r.zone_id
    from public.kitchen_routing_rules r
    where r.tenant_id = p_tenant_id
      and r.branch_id = p_branch_id
      and r.product_id = p_product_id
      and r.category_name is null
      and r.is_active = true
    order by r.created_at,r.id;
    return;
  end if;

  if v_scope = 'category' then
    if v_category is null then raise exception 'KITCHEN_ROUTE_CATEGORY_REQUIRED'; end if;

    delete from public.kitchen_routing_rules r
    where r.tenant_id = p_tenant_id
      and r.branch_id = p_branch_id
      and r.product_id is null
      and r.category_name is not null
      and lower(r.category_name) = lower(v_category);

    insert into public.kitchen_routing_rules(
      tenant_id,branch_id,zone_id,product_id,category_name,priority,is_active,created_by,metadata
    )
    select p_tenant_id,p_branch_id,u.zone_id,null,v_category,100,true,p_actor_user_id,
           jsonb_build_object('source','app.replace_kitchen_routes','scope_type','category')
    from unnest(v_zone_ids) as u(zone_id)
    on conflict do nothing;

    return query
    select r.id,r.zone_id
    from public.kitchen_routing_rules r
    where r.tenant_id = p_tenant_id
      and r.branch_id = p_branch_id
      and r.product_id is null
      and r.category_name is not null
      and lower(r.category_name) = lower(v_category)
      and r.is_active = true
    order by r.created_at,r.id;
    return;
  end if;

  delete from public.kitchen_routing_rules r
  where r.tenant_id = p_tenant_id
    and r.branch_id = p_branch_id
    and r.product_id is null
    and r.category_name is null;

  insert into public.kitchen_routing_rules(
    tenant_id,branch_id,zone_id,product_id,category_name,priority,is_active,created_by,metadata
  )
  select p_tenant_id,p_branch_id,u.zone_id,null,null,100,true,p_actor_user_id,
         jsonb_build_object('source','app.replace_kitchen_routes','scope_type','default')
  from unnest(v_zone_ids) as u(zone_id)
  on conflict do nothing;

  return query
  select r.id,r.zone_id
  from public.kitchen_routing_rules r
  where r.tenant_id = p_tenant_id
    and r.branch_id = p_branch_id
    and r.product_id is null
    and r.category_name is null
    and r.is_active = true
  order by r.created_at,r.id;
end;
$$;

create or replace function app.set_kitchen_ticket_status(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_ticket_id uuid,
  p_status text
)
returns table (
  ticket_id uuid,
  ticket_status text,
  event_type text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_current text;
  v_next text := lower(btrim(coalesce(p_status, '')));
begin
  if v_next not in ('queued','acknowledged','preparing','ready','cancelled') then
    raise exception 'KITCHEN_STATUS_INVALID';
  end if;

  select kt.status into v_current
  from public.kitchen_tickets kt
  where kt.id = p_ticket_id
    and kt.tenant_id = p_tenant_id
    and kt.branch_id = p_branch_id
  for update;

  if not found then raise exception 'KITCHEN_TICKET_NOT_FOUND'; end if;

  if v_current = v_next then
    return query
    select kt.id,kt.status,kt.event_type,kt.updated_at
    from public.kitchen_tickets kt
    where kt.id = p_ticket_id
      and kt.tenant_id = p_tenant_id
      and kt.branch_id = p_branch_id;
    return;
  end if;

  if v_current in ('ready','cancelled') then raise exception 'KITCHEN_STATUS_TERMINAL'; end if;

  if not (
    (v_current = 'queued' and v_next in ('acknowledged','preparing','ready','cancelled'))
    or (v_current = 'acknowledged' and v_next in ('preparing','ready','cancelled'))
    or (v_current = 'preparing' and v_next in ('ready','cancelled'))
  ) then
    raise exception 'KITCHEN_STATUS_TRANSITION_INVALID';
  end if;

  update public.kitchen_tickets kt
  set status = v_next,
      updated_at = now()
  where kt.id = p_ticket_id
    and kt.tenant_id = p_tenant_id
    and kt.branch_id = p_branch_id;

  return query
  select kt.id,kt.status,kt.event_type,kt.updated_at
  from public.kitchen_tickets kt
  where kt.id = p_ticket_id
    and kt.tenant_id = p_tenant_id
    and kt.branch_id = p_branch_id;
end;
$$;

revoke all on function app.replace_kitchen_routes(uuid,uuid,text,uuid[],uuid,text,uuid) from public, anon, authenticated;
revoke all on function app.set_kitchen_ticket_status(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function app.replace_kitchen_routes(uuid,uuid,text,uuid[],uuid,text,uuid) to service_role;
grant execute on function app.set_kitchen_ticket_status(uuid,uuid,uuid,text) to service_role;
