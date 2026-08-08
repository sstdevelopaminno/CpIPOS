-- CpIPOS Kitchen routing + print queue foundation
-- Primary data plane (CpiPOS-001).
-- Hardware-specific transports/drivers stay outside this migration.

create table if not exists kitchen_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  zone_code text not null,
  zone_name text not null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  default_printer_id uuid references printer_profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, zone_code),
  unique (tenant_id, branch_id, id)
);

create table if not exists kitchen_routing_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  zone_id uuid not null,
  product_id uuid references products(id) on delete cascade,
  category_name text,
  priority integer not null default 100,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id, zone_id)
    references kitchen_zones(tenant_id, branch_id, id) on delete cascade,
  check (category_name is null or btrim(category_name) <> '')
);

-- Product routes have precedence over category routes; category routes have
-- precedence over branch defaults (product_id/category_name both null).
create unique index if not exists ux_kitchen_route_product_zone
  on kitchen_routing_rules(tenant_id, branch_id, product_id, zone_id)
  where product_id is not null and category_name is null;
create unique index if not exists ux_kitchen_route_category_zone
  on kitchen_routing_rules(tenant_id, branch_id, lower(category_name), zone_id)
  where product_id is null and category_name is not null;
create unique index if not exists ux_kitchen_route_default_zone
  on kitchen_routing_rules(tenant_id, branch_id, zone_id)
  where product_id is null and category_name is null;
create index if not exists idx_kitchen_routes_scope_active
  on kitchen_routing_rules(tenant_id, branch_id, is_active, priority, created_at);

create table if not exists kitchen_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  zone_id uuid not null,
  event_key text not null,
  event_type text not null check (event_type in ('new','add','cancel','reprint')),
  status text not null default 'queued' check (status in ('queued','acknowledged','preparing','ready','cancelled')),
  order_no text not null,
  order_type text not null,
  table_id uuid,
  customer_name text,
  order_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id, zone_id)
    references kitchen_zones(tenant_id, branch_id, id) on delete restrict,
  unique (tenant_id, branch_id, event_key, zone_id)
);
create index if not exists idx_kitchen_tickets_scope_status
  on kitchen_tickets(tenant_id, branch_id, status, created_at desc);
create index if not exists idx_kitchen_tickets_order
  on kitchen_tickets(tenant_id, branch_id, order_id, created_at desc);

create table if not exists kitchen_ticket_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  kitchen_ticket_id uuid not null references kitchen_tickets(id) on delete cascade,
  order_item_id uuid not null references order_items(id) on delete cascade,
  product_id uuid not null references products(id),
  action text not null check (action in ('new','add','cancel','reprint')),
  product_name text not null,
  category_name text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (kitchen_ticket_id, order_item_id, action)
);
create index if not exists idx_kitchen_ticket_items_ticket
  on kitchen_ticket_items(kitchen_ticket_id, created_at);

alter table print_jobs
  add column if not exists kitchen_ticket_id uuid references kitchen_tickets(id) on delete set null,
  add column if not exists idempotency_key text;
create unique index if not exists ux_print_jobs_scope_idempotency
  on print_jobs(tenant_id, branch_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_print_jobs_kitchen_ticket
  on print_jobs(kitchen_ticket_id)
  where kitchen_ticket_id is not null;

alter table kitchen_zones enable row level security;
alter table kitchen_routing_rules enable row level security;
alter table kitchen_tickets enable row level security;
alter table kitchen_ticket_items enable row level security;

-- These rows are brokered by trusted CpIPOS server APIs. Native/Web clients
-- never receive service_role credentials and do not write them directly.
revoke all on kitchen_zones, kitchen_routing_rules, kitchen_tickets, kitchen_ticket_items from anon, authenticated;
grant all on kitchen_zones, kitchen_routing_rules, kitchen_tickets, kitchen_ticket_items to service_role;

create or replace function app.enqueue_kitchen_order(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_event_key text,
  p_action text default 'new',
  p_order_item_ids uuid[] default null
)
returns table (
  kitchen_ticket_id uuid,
  zone_id uuid,
  print_job_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_order orders%rowtype;
  v_zone_id uuid;
  v_ticket_id uuid;
  v_printer_id uuid;
  v_connection_type printer_connection_type;
  v_print_job_id uuid;
  v_payload jsonb;
  v_payload_text text;
begin
  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'KITCHEN_EVENT_KEY_REQUIRED';
  end if;
  if p_action not in ('new','add','cancel','reprint') then
    raise exception 'KITCHEN_ACTION_INVALID';
  end if;

  select * into v_order
  from orders o
  where o.id = p_order_id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id;

  if not found then
    raise exception 'KITCHEN_ORDER_NOT_FOUND';
  end if;

  for v_zone_id in
    with base_items as (
      select oi.id as order_item_id, oi.product_id, p.category
      from order_items oi
      join products p
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
             end as precedence
      from base_items bi
      join kitchen_routing_rules r
        on r.tenant_id = p_tenant_id
       and r.branch_id = p_branch_id
       and r.is_active = true
       and (
         r.product_id = bi.product_id
         or (r.product_id is null and r.category_name is not null and lower(r.category_name) = lower(bi.category))
         or (r.product_id is null and r.category_name is null)
       )
      join kitchen_zones z
        on z.id = r.zone_id
       and z.tenant_id = r.tenant_id
       and z.branch_id = r.branch_id
       and z.is_active = true
    ), ranked as (
      select c.*, min(c.precedence) over (partition by c.order_item_id) as best_precedence
      from candidates c
    )
    select distinct r.zone_id
    from ranked r
    where r.precedence = r.best_precedence
  loop
    insert into kitchen_tickets (
      tenant_id, branch_id, order_id, zone_id, event_key, event_type,
      order_no, order_type, table_id, customer_name, order_notes,
      metadata
    ) values (
      p_tenant_id, p_branch_id, p_order_id, v_zone_id, p_event_key, p_action,
      v_order.order_no, v_order.order_type::text, v_order.table_id,
      v_order.customer_name, v_order.notes,
      jsonb_build_object('source','app.enqueue_kitchen_order')
    )
    on conflict (tenant_id, branch_id, event_key, zone_id) do nothing
    returning id into v_ticket_id;

    if v_ticket_id is null then
      select kt.id into v_ticket_id
      from kitchen_tickets kt
      where kt.tenant_id = p_tenant_id
        and kt.branch_id = p_branch_id
        and kt.event_key = p_event_key
        and kt.zone_id = v_zone_id;
    end if;

    insert into kitchen_ticket_items (
      tenant_id, branch_id, kitchen_ticket_id, order_item_id, product_id,
      action, product_name, category_name, quantity, notes, metadata
    )
    with base_items as (
      select oi.id as order_item_id, oi.product_id, oi.quantity, oi.notes,
             coalesce(nullif(oi.name,''), p.name) as product_name,
             p.category
      from order_items oi
      join products p
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
             end as precedence
      from base_items bi
      join kitchen_routing_rules r
        on r.tenant_id = p_tenant_id
       and r.branch_id = p_branch_id
       and r.is_active = true
       and (
         r.product_id = bi.product_id
         or (r.product_id is null and r.category_name is not null and lower(r.category_name) = lower(bi.category))
         or (r.product_id is null and r.category_name is null)
       )
    ), ranked as (
      select c.*, min(c.precedence) over (partition by c.order_item_id) as best_precedence
      from candidates c
    )
    select p_tenant_id, p_branch_id, v_ticket_id, r.order_item_id, r.product_id,
           p_action, r.product_name, r.category, r.quantity, r.notes,
           jsonb_build_object('source','app.enqueue_kitchen_order')
    from ranked r
    where r.zone_id = v_zone_id
      and r.precedence = r.best_precedence
    on conflict (kitchen_ticket_id, order_item_id, action) do nothing;

    select z.default_printer_id, pp.connection_type
      into v_printer_id, v_connection_type
    from kitchen_zones z
    join printer_profiles pp
      on pp.id = z.default_printer_id
     and pp.tenant_id = z.tenant_id
     and pp.branch_id = z.branch_id
     and pp.enabled = true
     and pp.printer_role = 'kitchen'
    where z.id = v_zone_id
      and z.tenant_id = p_tenant_id
      and z.branch_id = p_branch_id;

    v_print_job_id := null;
    if v_printer_id is not null then
      select jsonb_build_object(
        'schema_version', 1,
        'kind', 'kitchen_ticket',
        'ticket_id', kt.id,
        'event_type', kt.event_type,
        'order_id', kt.order_id,
        'order_no', kt.order_no,
        'order_type', kt.order_type,
        'table_id', kt.table_id,
        'zone', jsonb_build_object('id', z.id, 'code', z.zone_code, 'name', z.zone_name),
        'customer_name', kt.customer_name,
        'order_notes', kt.order_notes,
        'created_at', kt.created_at,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_item_id', ki.order_item_id,
            'product_id', ki.product_id,
            'name', ki.product_name,
            'category', ki.category_name,
            'quantity', ki.quantity,
            'notes', ki.notes,
            'action', ki.action
          ) order by ki.created_at, ki.id)
          from kitchen_ticket_items ki
          where ki.kitchen_ticket_id = kt.id
        ), '[]'::jsonb)
      ) into v_payload
      from kitchen_tickets kt
      join kitchen_zones z on z.id = kt.zone_id
      where kt.id = v_ticket_id;

      v_payload_text := concat(
        '[', coalesce(v_payload #>> '{zone,name}','Kitchen'), '] ',
        coalesce(v_payload ->> 'order_no',''), ' ', upper(p_action)
      );

      insert into print_jobs (
        tenant_id, branch_id, order_id, printer_id, printer_role,
        connection_type, status, payload_text, payload_json,
        kitchen_ticket_id, idempotency_key, metadata
      ) values (
        p_tenant_id, p_branch_id, p_order_id, v_printer_id, 'kitchen',
        v_connection_type, 'pending', v_payload_text, v_payload,
        v_ticket_id, 'kitchen:' || v_ticket_id::text,
        jsonb_build_object('source','app.enqueue_kitchen_order','schema_version',1)
      )
      on conflict do nothing
      returning id into v_print_job_id;

      if v_print_job_id is null then
        select pj.id into v_print_job_id
        from print_jobs pj
        where pj.tenant_id = p_tenant_id
          and pj.branch_id = p_branch_id
          and pj.idempotency_key = 'kitchen:' || v_ticket_id::text;
      end if;
    end if;

    kitchen_ticket_id := v_ticket_id;
    zone_id := v_zone_id;
    print_job_id := v_print_job_id;
    return next;
  end loop;
end;
$$;

revoke all on function app.enqueue_kitchen_order(uuid,uuid,uuid,text,text,uuid[]) from public, anon, authenticated;
grant execute on function app.enqueue_kitchen_order(uuid,uuid,uuid,text,text,uuid[]) to service_role;
