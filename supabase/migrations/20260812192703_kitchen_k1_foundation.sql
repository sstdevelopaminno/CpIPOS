-- CpIPOS Kitchen K1 foundation.
-- Source-only migration; do not apply to Primary/Trial without review.

create table if not exists public.kitchen_queue_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  zone_id uuid not null,
  work_date date not null,
  last_queue_no integer not null default 0 check (last_queue_no >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, branch_id, zone_id, work_date),
  foreign key (tenant_id, branch_id, zone_id)
    references public.kitchen_zones(tenant_id, branch_id, id) on delete cascade
);

alter table public.kitchen_queue_counters enable row level security;
revoke all on public.kitchen_queue_counters from anon, authenticated;
grant all on public.kitchen_queue_counters to service_role;

alter table public.kitchen_zones
  add column if not exists access_code text,
  add column if not exists kds_enabled boolean not null default true;

alter table public.kitchen_tickets
  add column if not exists queue_no integer,
  add column if not exists round_no integer not null default 1;

create or replace function app.generate_kitchen_access_code()
returns text
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_bytes bytea;
  v_value bigint;
begin
  v_bytes := gen_random_bytes(4);
  v_value :=
    (get_byte(v_bytes, 0)::bigint << 24) +
    (get_byte(v_bytes, 1)::bigint << 16) +
    (get_byte(v_bytes, 2)::bigint << 8) +
    get_byte(v_bytes, 3)::bigint;
  return lpad((v_value % 1000000)::text, 6, '0');
end;
$$;

do $$
declare
  v_zone record;
  v_code text;
  v_attempt integer;
begin
  perform set_config('app.allow_kitchen_access_code_rotation', 'on', true);
  for v_zone in
    select id, tenant_id, branch_id
    from public.kitchen_zones
    where access_code is null
    order by created_at, id
  loop
    v_attempt := 0;
    loop
      v_attempt := v_attempt + 1;
      v_code := app.generate_kitchen_access_code();
      exit when not exists (
        select 1
        from public.kitchen_zones z
        where z.tenant_id = v_zone.tenant_id
          and z.branch_id = v_zone.branch_id
          and z.access_code = v_code
      );
      if v_attempt >= 32 then
        raise exception 'KITCHEN_ACCESS_CODE_COLLISION_RETRY_EXHAUSTED';
      end if;
    end loop;

    update public.kitchen_zones
    set access_code = v_code,
        updated_at = now()
    where id = v_zone.id;
  end loop;
end $$;

alter table public.kitchen_zones
  alter column access_code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kitchen_zones_access_code_format_check'
      and conrelid = 'public.kitchen_zones'::regclass
  ) then
    alter table public.kitchen_zones
      add constraint kitchen_zones_access_code_format_check
      check (access_code ~ '^[0-9]{6}$');
  end if;
end $$;

create unique index if not exists ux_kitchen_zones_scope_access_code
  on public.kitchen_zones(tenant_id, branch_id, access_code);

update public.kitchen_tickets kt
set queue_no = seq.queue_no,
    round_no = seq.round_no
from (
  select id,
         dense_rank() over (
           partition by tenant_id, branch_id, zone_id, (created_at at time zone 'Asia/Bangkok')::date
           order by order_id
         ) as queue_no,
         row_number() over (
           partition by tenant_id, branch_id, zone_id, order_id
           order by created_at, id
         ) as round_no
  from public.kitchen_tickets
  where queue_no is null
) seq
where kt.id = seq.id;

alter table public.kitchen_tickets
  alter column queue_no set not null,
  alter column round_no set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kitchen_tickets_queue_no_positive_check'
      and conrelid = 'public.kitchen_tickets'::regclass
  ) then
    alter table public.kitchen_tickets
      add constraint kitchen_tickets_queue_no_positive_check check (queue_no > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'kitchen_tickets_round_no_positive_check'
      and conrelid = 'public.kitchen_tickets'::regclass
  ) then
    alter table public.kitchen_tickets
      add constraint kitchen_tickets_round_no_positive_check check (round_no > 0);
  end if;
end $$;

create index if not exists idx_kitchen_tickets_order_zone_round
  on public.kitchen_tickets(tenant_id, branch_id, order_id, zone_id, round_no desc);

create index if not exists idx_kitchen_ticket_items_order_item
  on public.kitchen_ticket_items(tenant_id, branch_id, order_item_id);

create or replace function app.prevent_kitchen_access_code_direct_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
begin
  if old.access_code is distinct from new.access_code
     and coalesce(current_setting('app.allow_kitchen_access_code_rotation', true), '') <> 'on' then
    raise exception 'KITCHEN_ACCESS_CODE_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kitchen_zone_access_code_immutable on public.kitchen_zones;
create trigger trg_kitchen_zone_access_code_immutable
before update of access_code on public.kitchen_zones
for each row execute function app.prevent_kitchen_access_code_direct_update();

create or replace function app.rotate_kitchen_zone_access_code(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_zone_id uuid,
  p_actor_user_id uuid default null
)
returns table(zone_id uuid, access_code text, rotated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_code text;
  v_attempt integer := 0;
begin
  if not exists (
    select 1
    from public.kitchen_zones z
    where z.id = p_zone_id
      and z.tenant_id = p_tenant_id
      and z.branch_id = p_branch_id
  ) then
    raise exception 'KITCHEN_ZONE_NOT_FOUND';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := app.generate_kitchen_access_code();
    exit when not exists (
      select 1
      from public.kitchen_zones z
      where z.tenant_id = p_tenant_id
        and z.branch_id = p_branch_id
        and z.access_code = v_code
        and z.id <> p_zone_id
    );
    if v_attempt >= 32 then
      raise exception 'KITCHEN_ACCESS_CODE_COLLISION_RETRY_EXHAUSTED';
    end if;
  end loop;

  perform set_config('app.allow_kitchen_access_code_rotation', 'on', true);

  update public.kitchen_zones z
  set access_code = v_code,
      metadata = coalesce(z.metadata, '{}'::jsonb) || jsonb_build_object(
        'access_code_rotated_at', now(),
        'access_code_rotated_by', p_actor_user_id
      ),
      updated_at = now()
  where z.id = p_zone_id
    and z.tenant_id = p_tenant_id
    and z.branch_id = p_branch_id;

  return query select p_zone_id, v_code, now();
end;
$$;

create or replace function public.rotate_kitchen_zone_access_code(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_zone_id uuid,
  p_actor_user_id uuid default null
)
returns table(zone_id uuid, access_code text, rotated_at timestamptz)
language sql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
  select * from app.rotate_kitchen_zone_access_code(p_tenant_id, p_branch_id, p_zone_id, p_actor_user_id);
$$;

revoke all on function app.rotate_kitchen_zone_access_code(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rotate_kitchen_zone_access_code(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.rotate_kitchen_zone_access_code(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.rotate_kitchen_zone_access_code(uuid, uuid, uuid, uuid) to service_role;

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

  if v_scope = 'category' and v_requested > 1 then
    raise exception 'KITCHEN_ROUTE_CATEGORY_SINGLE_ZONE_REQUIRED';
  end if;

  if v_scope = 'product' then
    if p_product_id is null then
      raise exception 'KITCHEN_ROUTE_PRODUCT_REQUIRED';
    end if;
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
      tenant_id, branch_id, zone_id, product_id, category_name, priority, is_active, created_by, metadata
    )
    select p_tenant_id, p_branch_id, u.zone_id, p_product_id, null, 100, true, p_actor_user_id,
           jsonb_build_object('source','app.replace_kitchen_routes','scope_type','product')
    from unnest(v_zone_ids) as u(zone_id)
    on conflict do nothing;

    return query
    select r.id, r.zone_id
    from public.kitchen_routing_rules r
    where r.tenant_id = p_tenant_id
      and r.branch_id = p_branch_id
      and r.product_id = p_product_id
      and r.category_name is null
      and r.is_active = true
    order by r.created_at, r.id;
    return;
  end if;

  if v_scope = 'category' then
    if v_category is null then
      raise exception 'KITCHEN_ROUTE_CATEGORY_REQUIRED';
    end if;

    delete from public.kitchen_routing_rules r
    where r.tenant_id = p_tenant_id
      and r.branch_id = p_branch_id
      and r.product_id is null
      and r.category_name is not null
      and lower(r.category_name) = lower(v_category);

    insert into public.kitchen_routing_rules(
      tenant_id, branch_id, zone_id, product_id, category_name, priority, is_active, created_by, metadata
    )
    select p_tenant_id, p_branch_id, u.zone_id, null, v_category, 100, true, p_actor_user_id,
           jsonb_build_object('source','app.replace_kitchen_routes','scope_type','category')
    from unnest(v_zone_ids) as u(zone_id)
    on conflict do nothing;

    return query
    select r.id, r.zone_id
    from public.kitchen_routing_rules r
    where r.tenant_id = p_tenant_id
      and r.branch_id = p_branch_id
      and r.product_id is null
      and r.category_name is not null
      and lower(r.category_name) = lower(v_category)
      and r.is_active = true
    order by r.created_at, r.id;
    return;
  end if;

  delete from public.kitchen_routing_rules r
  where r.tenant_id = p_tenant_id
    and r.branch_id = p_branch_id
    and r.product_id is null
    and r.category_name is null;

  insert into public.kitchen_routing_rules(
    tenant_id, branch_id, zone_id, product_id, category_name, priority, is_active, created_by, metadata
  )
  select p_tenant_id, p_branch_id, u.zone_id, null, null, 100, true, p_actor_user_id,
         jsonb_build_object('source','app.replace_kitchen_routes','scope_type','default')
  from unnest(v_zone_ids) as u(zone_id)
  on conflict do nothing;

  return query
  select r.id, r.zone_id
  from public.kitchen_routing_rules r
  where r.tenant_id = p_tenant_id
    and r.branch_id = p_branch_id
    and r.product_id is null
    and r.category_name is null
    and r.is_active = true
  order by r.created_at, r.id;
end;
$$;

drop function if exists public.enqueue_kitchen_order(uuid, uuid, uuid, text, text, uuid[]);
drop function if exists app.enqueue_kitchen_order(uuid, uuid, uuid, text, text, uuid[]);

create or replace function app.enqueue_kitchen_order(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_event_key text,
  p_action text default 'new'::text,
  p_order_item_ids uuid[] default null::uuid[]
)
returns table(kitchen_ticket_id uuid, zone_id uuid, print_job_id uuid, queue_no integer, round_no integer)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $function$
declare
  v_order public.orders%rowtype;
  v_zone_id uuid;
  v_ticket_id uuid;
  v_queue_no integer;
  v_round_no integer;
  v_work_date date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'KITCHEN_EVENT_KEY_REQUIRED';
  end if;
  if p_action not in ('new','add','cancel','reprint') then
    raise exception 'KITCHEN_ACTION_INVALID';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id;

  if not found then
    raise exception 'KITCHEN_ORDER_NOT_FOUND';
  end if;

  for v_zone_id in
    with base_items as (
      select oi.id as order_item_id, oi.product_id, p.category
      from public.order_items oi
      join public.products p
        on p.id = oi.product_id
       and p.tenant_id = oi.tenant_id
       and p.branch_id = oi.branch_id
      where oi.tenant_id = p_tenant_id
        and oi.branch_id = p_branch_id
        and oi.order_id = p_order_id
        and (p_order_item_ids is null or oi.id = any(p_order_item_ids))
    ), candidates as (
      select bi.order_item_id,
             r.zone_id,
             case
               when r.product_id = bi.product_id then 1
               when r.product_id is null and r.category_name is not null and lower(r.category_name) = lower(bi.category) then 2
               else 3
             end as precedence,
             r.priority,
             r.created_at,
             r.id as route_id
      from base_items bi
      join public.kitchen_routing_rules r
        on r.tenant_id = p_tenant_id
       and r.branch_id = p_branch_id
       and r.is_active = true
       and (
         r.product_id = bi.product_id
         or (r.product_id is null and r.category_name is not null and lower(r.category_name) = lower(bi.category))
         or (r.product_id is null and r.category_name is null)
       )
      join public.kitchen_zones z
        on z.id = r.zone_id
       and z.tenant_id = r.tenant_id
       and z.branch_id = r.branch_id
       and z.is_active = true
    ), ranked as (
      select c.*,
             row_number() over (
               partition by c.order_item_id
               order by c.precedence, c.priority, c.created_at, c.route_id
             ) as route_rank
      from candidates c
    )
    select distinct r.zone_id
    from ranked r
    where r.route_rank = 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      p_tenant_id::text || ':' || p_branch_id::text || ':' || p_order_id::text || ':' || v_zone_id::text,
      0
    ));

    v_ticket_id := null;
    v_queue_no := null;
    v_round_no := null;

    select kt.id, kt.queue_no, kt.round_no
      into v_ticket_id, v_queue_no, v_round_no
    from public.kitchen_tickets kt
    where kt.tenant_id = p_tenant_id
      and kt.branch_id = p_branch_id
      and kt.event_key = p_event_key
      and kt.zone_id = v_zone_id;

    if v_ticket_id is null and p_action = 'reprint' then
      select kt.id, kt.queue_no, kt.round_no
        into v_ticket_id, v_queue_no, v_round_no
      from public.kitchen_tickets kt
      where kt.tenant_id = p_tenant_id
        and kt.branch_id = p_branch_id
        and kt.order_id = p_order_id
        and kt.zone_id = v_zone_id
      order by kt.round_no desc, kt.created_at desc
      limit 1;
    end if;

    if v_ticket_id is null and p_action <> 'reprint' then
      select min(kt.queue_no), max(kt.round_no) + 1
        into v_queue_no, v_round_no
      from public.kitchen_tickets kt
      where kt.tenant_id = p_tenant_id
        and kt.branch_id = p_branch_id
        and kt.order_id = p_order_id
        and kt.zone_id = v_zone_id;

      if v_queue_no is null then
        insert into public.kitchen_queue_counters (
          tenant_id, branch_id, zone_id, work_date, last_queue_no, updated_at
        ) values (
          p_tenant_id, p_branch_id, v_zone_id, v_work_date, 1, now()
        )
        on conflict (tenant_id, branch_id, zone_id, work_date)
        do update set last_queue_no = public.kitchen_queue_counters.last_queue_no + 1,
                      updated_at = now()
        returning last_queue_no into v_queue_no;
        v_round_no := 1;
      else
        v_round_no := greatest(1, coalesce(v_round_no, 1));
      end if;

      insert into public.kitchen_tickets (
        tenant_id, branch_id, order_id, zone_id, event_key, event_type,
        status, queue_no, round_no,
        order_no, order_type, table_id, customer_name, order_notes,
        metadata
      ) values (
        p_tenant_id, p_branch_id, p_order_id, v_zone_id, p_event_key, p_action,
        'queued', v_queue_no, v_round_no,
        v_order.order_no, v_order.order_type::text, v_order.table_id,
        v_order.customer_name, v_order.notes,
        jsonb_build_object('source','app.enqueue_kitchen_order','work_date',v_work_date)
      )
      on conflict on constraint kitchen_tickets_tenant_id_branch_id_event_key_zone_id_key do nothing
      returning id into v_ticket_id;

      if v_ticket_id is null then
        select kt.id, kt.queue_no, kt.round_no
          into v_ticket_id, v_queue_no, v_round_no
        from public.kitchen_tickets kt
        where kt.tenant_id = p_tenant_id
          and kt.branch_id = p_branch_id
          and kt.event_key = p_event_key
          and kt.zone_id = v_zone_id;
      end if;

      insert into public.kitchen_ticket_items (
        tenant_id, branch_id, kitchen_ticket_id, order_item_id, product_id,
        action, product_name, category_name, quantity, notes, metadata
      )
      with base_items as (
        select oi.id as order_item_id, oi.product_id, oi.quantity, oi.notes,
               coalesce(nullif(oi.name,''), p.name) as product_name,
               p.category
        from public.order_items oi
        join public.products p
          on p.id = oi.product_id
         and p.tenant_id = oi.tenant_id
         and p.branch_id = oi.branch_id
        where oi.tenant_id = p_tenant_id
          and oi.branch_id = p_branch_id
          and oi.order_id = p_order_id
          and (p_order_item_ids is null or oi.id = any(p_order_item_ids))
      ), candidates as (
        select bi.*,
               r.zone_id,
               case
                 when r.product_id = bi.product_id then 1
                 when r.product_id is null and r.category_name is not null and lower(r.category_name) = lower(bi.category) then 2
                 else 3
               end as precedence,
               r.priority,
               r.created_at,
               r.id as route_id
        from base_items bi
        join public.kitchen_routing_rules r
          on r.tenant_id = p_tenant_id
         and r.branch_id = p_branch_id
         and r.is_active = true
         and (
           r.product_id = bi.product_id
           or (r.product_id is null and r.category_name is not null and lower(r.category_name) = lower(bi.category))
           or (r.product_id is null and r.category_name is null)
         )
      ), ranked as (
        select c.*,
               row_number() over (
                 partition by c.order_item_id
                 order by c.precedence, c.priority, c.created_at, c.route_id
               ) as route_rank
        from candidates c
      )
      select p_tenant_id, p_branch_id, v_ticket_id, r.order_item_id, r.product_id,
             p_action, r.product_name, r.category, r.quantity, r.notes,
             jsonb_build_object('source','app.enqueue_kitchen_order','round_no',v_round_no)
      from ranked r
      where r.zone_id = v_zone_id
        and r.route_rank = 1
      on conflict (kitchen_ticket_id, order_item_id, action) do nothing;
    end if;

    if v_ticket_id is not null then
      kitchen_ticket_id := v_ticket_id;
      zone_id := v_zone_id;
      print_job_id := null;
      queue_no := v_queue_no;
      round_no := v_round_no;
      return next;
    end if;
  end loop;
end;
$function$;

create or replace function public.enqueue_kitchen_order(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_event_key text,
  p_action text default 'new'::text,
  p_order_item_ids uuid[] default null::uuid[]
)
returns table(kitchen_ticket_id uuid, zone_id uuid, print_job_id uuid, queue_no integer, round_no integer)
language sql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
  select * from app.enqueue_kitchen_order(
    p_tenant_id,
    p_branch_id,
    p_order_id,
    p_event_key,
    p_action,
    p_order_item_ids
  );
$$;

revoke all on function app.enqueue_kitchen_order(uuid, uuid, uuid, text, text, uuid[]) from public, anon, authenticated;
revoke all on function public.enqueue_kitchen_order(uuid, uuid, uuid, text, text, uuid[]) from public, anon, authenticated;
grant execute on function app.enqueue_kitchen_order(uuid, uuid, uuid, text, text, uuid[]) to service_role;
grant execute on function public.enqueue_kitchen_order(uuid, uuid, uuid, text, text, uuid[]) to service_role;

create or replace function app.get_kitchen_clearance_for_order(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid
)
returns table(ok boolean, code text, blocking_zone_count integer, unfinished_item_count integer, blockers jsonb)
language sql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
  with unfinished as (
    select
      kt.zone_id,
      z.zone_code,
      z.zone_name,
      kt.queue_no,
      kt.round_no,
      count(ki.id)::integer as item_count
    from public.kitchen_tickets kt
    join public.kitchen_zones z
      on z.id = kt.zone_id
     and z.tenant_id = kt.tenant_id
     and z.branch_id = kt.branch_id
     and z.is_active = true
     and z.kds_enabled = true
    left join public.kitchen_ticket_items ki
      on ki.kitchen_ticket_id = kt.id
     and ki.tenant_id = kt.tenant_id
     and ki.branch_id = kt.branch_id
    where kt.tenant_id = p_tenant_id
      and kt.branch_id = p_branch_id
      and kt.order_id = p_order_id
      and kt.status not in ('ready','cancelled')
    group by kt.zone_id, z.zone_code, z.zone_name, kt.queue_no, kt.round_no
  ), totals as (
    select
      count(*)::integer as zone_count,
      coalesce(sum(item_count), 0)::integer as item_count,
      coalesce(jsonb_agg(jsonb_build_object(
        'zone_id', zone_id,
        'zone_code', zone_code,
        'zone_name', zone_name,
        'queue_no', queue_no,
        'round_no', round_no,
        'unfinished_item_count', item_count
      ) order by zone_name, queue_no, round_no), '[]'::jsonb) as blockers
    from unfinished
  )
  select
    totals.zone_count = 0,
    case when totals.zone_count = 0 then 'kitchen_clear' else 'kitchen_clearance_required' end,
    totals.zone_count,
    totals.item_count,
    totals.blockers
  from totals;
$$;

create or replace function public.get_kitchen_clearance_for_order(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid
)
returns table(ok boolean, code text, blocking_zone_count integer, unfinished_item_count integer, blockers jsonb)
language sql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
  select * from app.get_kitchen_clearance_for_order(p_tenant_id, p_branch_id, p_order_id);
$$;

create or replace function app.assert_kitchen_clearance_for_order(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_clearance record;
begin
  select * into v_clearance
  from app.get_kitchen_clearance_for_order(p_tenant_id, p_branch_id, p_order_id);

  if not coalesce(v_clearance.ok, true) then
    raise exception 'KITCHEN_CLEARANCE_REQUIRED:%', v_clearance.blockers::text;
  end if;
end;
$$;

create or replace function public.assert_kitchen_clearance_for_order(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid
)
returns void
language sql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
  select app.assert_kitchen_clearance_for_order(p_tenant_id, p_branch_id, p_order_id);
$$;

revoke all on function app.get_kitchen_clearance_for_order(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_kitchen_clearance_for_order(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app.assert_kitchen_clearance_for_order(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.assert_kitchen_clearance_for_order(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.get_kitchen_clearance_for_order(uuid, uuid, uuid) to service_role;
grant execute on function public.get_kitchen_clearance_for_order(uuid, uuid, uuid) to service_role;
grant execute on function app.assert_kitchen_clearance_for_order(uuid, uuid, uuid) to service_role;
grant execute on function public.assert_kitchen_clearance_for_order(uuid, uuid, uuid) to service_role;

create or replace function app.prevent_pos_item_change_after_kitchen_acceptance()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_locked boolean;
begin
  if tg_op = 'UPDATE' and coalesce(new.quantity, 0) >= coalesce(old.quantity, 0) then
    return new;
  end if;

  select exists (
    select 1
    from public.kitchen_ticket_items ki
    join public.kitchen_tickets kt
      on kt.id = ki.kitchen_ticket_id
     and kt.tenant_id = ki.tenant_id
     and kt.branch_id = ki.branch_id
    join public.kitchen_zones z
      on z.id = kt.zone_id
     and z.tenant_id = kt.tenant_id
     and z.branch_id = kt.branch_id
     and z.is_active = true
     and z.kds_enabled = true
    where ki.tenant_id = old.tenant_id
      and ki.branch_id = old.branch_id
      and ki.order_item_id = old.id
      and kt.status in ('acknowledged','preparing','ready')
  ) into v_locked;

  if v_locked then
    raise exception 'KITCHEN_POS_ITEM_LOCKED';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_items_kitchen_acceptance_lock on public.order_items;
create trigger trg_order_items_kitchen_acceptance_lock
before update of quantity or delete on public.order_items
for each row execute function app.prevent_pos_item_change_after_kitchen_acceptance();

notify pgrst, 'reload schema';
