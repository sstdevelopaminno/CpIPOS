-- CpiPOS-002 Trial data-plane mirror for Kitchen routing.
-- Trial is server-only. This keeps business data migration-compatible with CpiPOS-001.

create table if not exists public.printer_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  printer_name text not null,
  printer_role text not null check (printer_role in ('receipt','kitchen','report')),
  connection_type text not null check (connection_type in ('NETWORK_ESC_POS','STAR_WEBPRNT','LOCAL_BRIDGE')),
  ip_address text,
  port integer,
  paper_width_mm integer not null check (paper_width_mm in (58,80)),
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, printer_name),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade
);

create table if not exists public.kitchen_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  zone_code text not null,
  zone_name text not null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  default_printer_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, zone_code),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, default_printer_id) references public.printer_profiles(tenant_id, branch_id, id) on delete set null
);

create table if not exists public.kitchen_routing_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  zone_id uuid not null,
  product_id uuid,
  category_name text,
  priority integer not null default 100,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, zone_id) references public.kitchen_zones(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, product_id) references public.products(tenant_id, branch_id, id) on delete cascade,
  check (category_name is null or btrim(category_name) <> '')
);
create unique index if not exists ux_trial_kitchen_route_product_zone
  on public.kitchen_routing_rules(tenant_id, branch_id, product_id, zone_id)
  where product_id is not null and category_name is null;
create unique index if not exists ux_trial_kitchen_route_category_zone
  on public.kitchen_routing_rules(tenant_id, branch_id, lower(category_name), zone_id)
  where product_id is null and category_name is not null;
create unique index if not exists ux_trial_kitchen_route_default_zone
  on public.kitchen_routing_rules(tenant_id, branch_id, zone_id)
  where product_id is null and category_name is null;

create table if not exists public.kitchen_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
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
  unique (tenant_id, branch_id, event_key, zone_id),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, order_id) references public.orders(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, zone_id) references public.kitchen_zones(tenant_id, branch_id, id) on delete restrict
);
create index if not exists idx_trial_kitchen_tickets_scope_status
  on public.kitchen_tickets(tenant_id, branch_id, status, created_at desc);

create table if not exists public.kitchen_ticket_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  kitchen_ticket_id uuid not null,
  order_item_id uuid not null,
  product_id uuid not null,
  action text not null check (action in ('new','add','cancel','reprint')),
  product_name text not null,
  category_name text not null,
  quantity numeric not null check (quantity > 0),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (kitchen_ticket_id, order_item_id, action),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, kitchen_ticket_id) references public.kitchen_tickets(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, order_item_id) references public.order_items(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, product_id) references public.products(tenant_id, branch_id, id)
);

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  order_id uuid,
  printer_id uuid,
  printer_role text not null check (printer_role in ('receipt','kitchen','report')),
  connection_type text not null check (connection_type in ('NETWORK_ESC_POS','STAR_WEBPRNT','LOCAL_BRIDGE')),
  status text not null default 'pending' check (status in ('pending','printing','printed','failed','retrying')),
  payload_text text not null,
  payload_json jsonb not null default '{}'::jsonb,
  retry_count integer not null default 0 check (retry_count >= 0),
  max_retry_count integer not null default 3 check (max_retry_count >= 0),
  last_error text,
  printed_at timestamptz,
  failed_at timestamptz,
  kitchen_ticket_id uuid,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, order_id) references public.orders(tenant_id, branch_id, id) on delete set null,
  foreign key (tenant_id, branch_id, printer_id) references public.printer_profiles(tenant_id, branch_id, id) on delete set null,
  foreign key (tenant_id, branch_id, kitchen_ticket_id) references public.kitchen_tickets(tenant_id, branch_id, id) on delete set null
);
create unique index if not exists ux_trial_print_jobs_scope_idempotency
  on public.print_jobs(tenant_id, branch_id, idempotency_key) where idempotency_key is not null;
create index if not exists idx_trial_print_jobs_scope_status
  on public.print_jobs(tenant_id, branch_id, status, created_at desc);

alter table public.printer_profiles enable row level security;
alter table public.kitchen_zones enable row level security;
alter table public.kitchen_routing_rules enable row level security;
alter table public.kitchen_tickets enable row level security;
alter table public.kitchen_ticket_items enable row level security;
alter table public.print_jobs enable row level security;
revoke all on public.printer_profiles, public.kitchen_zones, public.kitchen_routing_rules,
  public.kitchen_tickets, public.kitchen_ticket_items, public.print_jobs from anon, authenticated;
grant all on public.printer_profiles, public.kitchen_zones, public.kitchen_routing_rules,
  public.kitchen_tickets, public.kitchen_ticket_items, public.print_jobs to service_role;

create or replace function app.enqueue_kitchen_order(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_event_key text,
  p_action text default 'new',
  p_order_item_ids uuid[] default null
)
returns table (kitchen_ticket_id uuid, zone_id uuid, print_job_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_order public.orders%rowtype;
  v_zone_id uuid;
  v_ticket_id uuid;
  v_printer_id uuid;
  v_connection_type text;
  v_print_job_id uuid;
  v_payload jsonb;
begin
  if p_event_key is null or btrim(p_event_key) = '' then raise exception 'KITCHEN_EVENT_KEY_REQUIRED'; end if;
  if p_action not in ('new','add','cancel','reprint') then raise exception 'KITCHEN_ACTION_INVALID'; end if;

  select * into v_order from public.orders o
  where o.id=p_order_id and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id;
  if not found then raise exception 'KITCHEN_ORDER_NOT_FOUND'; end if;

  for v_zone_id in
    with base_items as (
      select oi.id order_item_id, oi.product_id, p.category
      from public.order_items oi
      join public.products p on p.id=oi.product_id and p.tenant_id=oi.tenant_id and p.branch_id=oi.branch_id
      where oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id
        and (p_order_item_ids is null or oi.id=any(p_order_item_ids))
    ), candidates as (
      select bi.order_item_id, r.zone_id,
        case when r.product_id=bi.product_id then 1
             when r.product_id is null and r.category_name is not null and lower(r.category_name)=lower(bi.category) then 2
             else 3 end precedence
      from base_items bi
      join public.kitchen_routing_rules r on r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.is_active
        and (r.product_id=bi.product_id
          or (r.product_id is null and r.category_name is not null and lower(r.category_name)=lower(bi.category))
          or (r.product_id is null and r.category_name is null))
      join public.kitchen_zones z on z.id=r.zone_id and z.is_active
    ), ranked as (
      select c.*, min(c.precedence) over(partition by c.order_item_id) best_precedence from candidates c
    )
    select distinct zone_id from ranked where precedence=best_precedence
  loop
    insert into public.kitchen_tickets(
      tenant_id,branch_id,order_id,zone_id,event_key,event_type,order_no,order_type,table_id,customer_name,order_notes,metadata
    ) values (
      p_tenant_id,p_branch_id,p_order_id,v_zone_id,p_event_key,p_action,v_order.order_no,v_order.order_type::text,
      v_order.table_id,v_order.customer_name,v_order.notes,jsonb_build_object('source','app.enqueue_kitchen_order')
    ) on conflict (tenant_id,branch_id,event_key,zone_id) do nothing returning id into v_ticket_id;

    if v_ticket_id is null then
      select id into v_ticket_id from public.kitchen_tickets
      where tenant_id=p_tenant_id and branch_id=p_branch_id and event_key=p_event_key and zone_id=v_zone_id;
    end if;

    insert into public.kitchen_ticket_items(
      tenant_id,branch_id,kitchen_ticket_id,order_item_id,product_id,action,product_name,category_name,quantity,notes,metadata
    )
    with base_items as (
      select oi.id order_item_id, oi.product_id, oi.quantity, oi.notes,
             coalesce(nullif(oi.name,''),p.name) product_name, p.category
      from public.order_items oi
      join public.products p on p.id=oi.product_id and p.tenant_id=oi.tenant_id and p.branch_id=oi.branch_id
      where oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id
        and (p_order_item_ids is null or oi.id=any(p_order_item_ids))
    ), candidates as (
      select bi.*,r.zone_id,
        case when r.product_id=bi.product_id then 1
             when r.product_id is null and r.category_name is not null and lower(r.category_name)=lower(bi.category) then 2
             else 3 end precedence
      from base_items bi
      join public.kitchen_routing_rules r on r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.is_active
        and (r.product_id=bi.product_id
          or (r.product_id is null and r.category_name is not null and lower(r.category_name)=lower(bi.category))
          or (r.product_id is null and r.category_name is null))
    ), ranked as (
      select c.*,min(c.precedence) over(partition by c.order_item_id) best_precedence from candidates c
    )
    select p_tenant_id,p_branch_id,v_ticket_id,r.order_item_id,r.product_id,p_action,r.product_name,r.category,r.quantity,r.notes,
           jsonb_build_object('source','app.enqueue_kitchen_order')
    from ranked r where r.zone_id=v_zone_id and r.precedence=r.best_precedence
    on conflict (kitchen_ticket_id,order_item_id,action) do nothing;

    select z.default_printer_id, pp.connection_type into v_printer_id,v_connection_type
    from public.kitchen_zones z
    join public.printer_profiles pp on pp.id=z.default_printer_id and pp.tenant_id=z.tenant_id and pp.branch_id=z.branch_id
      and pp.enabled and pp.printer_role='kitchen'
    where z.id=v_zone_id and z.tenant_id=p_tenant_id and z.branch_id=p_branch_id;

    v_print_job_id := null;
    if v_printer_id is not null then
      select jsonb_build_object(
        'schema_version',1,'kind','kitchen_ticket','ticket_id',kt.id,'event_type',kt.event_type,
        'order_id',kt.order_id,'order_no',kt.order_no,'order_type',kt.order_type,'table_id',kt.table_id,
        'zone',jsonb_build_object('id',z.id,'code',z.zone_code,'name',z.zone_name),
        'customer_name',kt.customer_name,'order_notes',kt.order_notes,'created_at',kt.created_at,
        'items',coalesce((select jsonb_agg(jsonb_build_object(
          'order_item_id',ki.order_item_id,'product_id',ki.product_id,'name',ki.product_name,'category',ki.category_name,
          'quantity',ki.quantity,'notes',ki.notes,'action',ki.action
        ) order by ki.created_at,ki.id) from public.kitchen_ticket_items ki where ki.kitchen_ticket_id=kt.id),'[]'::jsonb)
      ) into v_payload
      from public.kitchen_tickets kt join public.kitchen_zones z on z.id=kt.zone_id where kt.id=v_ticket_id;

      insert into public.print_jobs(
        tenant_id,branch_id,order_id,printer_id,printer_role,connection_type,status,payload_text,payload_json,
        kitchen_ticket_id,idempotency_key,metadata
      ) values (
        p_tenant_id,p_branch_id,p_order_id,v_printer_id,'kitchen',v_connection_type,'pending',
        concat('[',coalesce(v_payload #>> '{zone,name}','Kitchen'),'] ',coalesce(v_payload->>'order_no',''),' ',upper(p_action)),
        v_payload,v_ticket_id,'kitchen:'||v_ticket_id::text,jsonb_build_object('source','app.enqueue_kitchen_order','schema_version',1)
      ) on conflict do nothing returning id into v_print_job_id;
      if v_print_job_id is null then
        select id into v_print_job_id from public.print_jobs
        where tenant_id=p_tenant_id and branch_id=p_branch_id and idempotency_key='kitchen:'||v_ticket_id::text;
      end if;
    end if;

    kitchen_ticket_id:=v_ticket_id; zone_id:=v_zone_id; print_job_id:=v_print_job_id; return next;
  end loop;
end;
$$;

revoke all on function app.enqueue_kitchen_order(uuid,uuid,uuid,text,text,uuid[]) from public, anon, authenticated;
grant execute on function app.enqueue_kitchen_order(uuid,uuid,uuid,text,text,uuid[]) to service_role;
