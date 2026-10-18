-- CUSTOM Optical CRM customer address only, additive and RLS-protected.
-- Requires prior IT CRM menu/RLS migration 20261018100000.
begin;
alter table public.optical_customers
  add column if not exists address text;

create table if not exists public.optical_customer_address_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  customer_id uuid not null references public.optical_customers(id),
  request_id uuid not null,
  previous_address text,
  new_address text,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  constraint optical_customer_address_request_unique unique(tenant_id,branch_id,request_id),
  constraint optical_customer_address_max_length check(length(coalesce(new_address,''))<=1500)
);
create index if not exists optical_customer_address_events_lookup
  on public.optical_customer_address_events(tenant_id,branch_id,customer_id,changed_at desc);
alter table public.optical_customer_address_events enable row level security;
revoke all on table public.optical_customer_address_events from public, anon, authenticated;
grant select on public.optical_customer_address_events to authenticated;
drop policy if exists optical_address_events_read_v1 on public.optical_customer_address_events;
create policy optical_address_events_read_v1
  on public.optical_customer_address_events for select to authenticated
  using (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_customers')
  );

-- Prevent direct authenticated Data API updates from silently bypassing
-- address history. A validated RPC sets the transaction-local request context.
create or replace function app.optical_address_rpc_guard()
returns trigger language plpgsql security invoker
set search_path = ''
as $guard$
begin
  if old.address is distinct from new.address
    and nullif(current_setting('app.optical_address_request_context',true),'') is null
  then
    raise exception 'OPTICAL_ADDRESS_USE_AUDITED_RPC' using errcode='42501';
  end if;
  return new;
end;
$guard$;
drop trigger if exists optical_address_guard_v1 on public.optical_customers;
create trigger optical_address_guard_v1
before update of address on public.optical_customers
for each row execute function app.optical_address_rpc_guard();

-- Immutable audit ledger is written via the only authenticated RPC.
-- auth.uid() and current roles come from the session, never from a browser actor_id.
create or replace function public.optical_save_customer_address_v1(
  p_tenant_id uuid,p_branch_id uuid,p_customer_id uuid,
  p_address text,p_request_id uuid
) returns jsonb
language plpgsql security definer
set search_path = 'pg_catalog','public','app','auth'
as $function$
declare
  v_actor uuid;
  v_previous text;
  v_next text;
  v_prior public.optical_customer_address_events%rowtype;
begin
  v_actor := auth.uid();
  if v_actor is null
    or p_tenant_id is null or p_branch_id is null
    or p_customer_id is null or p_request_id is null
    or not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id)
    or not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_customers')
  then raise exception 'OPTICAL_ADDRESS_ACCESS_DENIED' using errcode='42501';
  end if;
  v_next := nullif(btrim(coalesce(p_address,'')),'');
  if length(coalesce(v_next,'')) > 1500 then
    raise exception 'OPTICAL_ADDRESS_TOO_LONG' using errcode='22023';
  end if;
  select c.address into v_previous
  from public.optical_customers c
  where c.id=p_customer_id and c.tenant_id=p_tenant_id
    and c.branch_id=p_branch_id and c.deleted_at is null
  for update;
  if not found then
    raise exception 'OPTICAL_ADDRESS_CUSTOMER_NOT_FOUND' using errcode='P0002';
  end if;
  select * into v_prior from public.optical_customer_address_events e
  where e.tenant_id=p_tenant_id and e.branch_id=p_branch_id
    and e.request_id=p_request_id;
  if found then
    if v_prior.customer_id<>p_customer_id
       or v_prior.new_address is distinct from v_next then
      raise exception 'OPTICAL_ADDRESS_IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object('customer_id',p_customer_id,'duplicate_request',true);
  end if;
  if v_previous is distinct from v_next then
    perform set_config('app.optical_address_request_context',p_request_id::text,true);
    update public.optical_customers
    set address=v_next,updated_by=v_actor,updated_at=now()
    where id=p_customer_id and tenant_id=p_tenant_id and branch_id=p_branch_id;
    perform set_config('app.optical_address_request_context','',true);
  end if;
  insert into public.optical_customer_address_events
    (tenant_id,branch_id,customer_id,request_id,previous_address,new_address,changed_by)
  values(p_tenant_id,p_branch_id,p_customer_id,p_request_id,v_previous,v_next);
  return jsonb_build_object('customer_id',p_customer_id,'duplicate_request',false);
end;
$function$;
revoke all on function public.optical_save_customer_address_v1(uuid,uuid,uuid,text,uuid)
  from public, anon;
grant execute on function public.optical_save_customer_address_v1(uuid,uuid,uuid,text,uuid)
  to authenticated;
commit;
