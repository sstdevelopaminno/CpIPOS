create table if not exists public.kitchen_queue_counters (
  tenant_id uuid not null,
  branch_id uuid not null,
  business_date date not null,
  last_queue_no integer not null default 0 check (last_queue_no >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, branch_id, business_date),
  constraint kitchen_queue_counters_scope_fkey
    foreign key (tenant_id, branch_id)
    references public.trial_branch_scopes(tenant_id, branch_id)
    on delete cascade
);

alter table public.kitchen_queue_counters enable row level security;
revoke all on table public.kitchen_queue_counters from public, anon, authenticated;
grant select, insert, update, delete on table public.kitchen_queue_counters to service_role;

insert into public.kitchen_queue_counters (tenant_id, branch_id, business_date, last_queue_no, updated_at)
select kt.tenant_id, kt.branch_id, timezone('Asia/Bangkok', kt.created_at)::date, max(kt.queue_no), now()
from public.kitchen_tickets kt
where kt.queue_no is not null
group by kt.tenant_id, kt.branch_id, timezone('Asia/Bangkok', kt.created_at)::date
on conflict (tenant_id, branch_id, business_date) do update
set last_queue_no = greatest(public.kitchen_queue_counters.last_queue_no, excluded.last_queue_no),
    updated_at = now();

create or replace function app.assign_kitchen_ticket_queue_no()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog','public','app','extensions'
as $function$
declare
  v_existing integer;
  v_business_date date;
begin
  if new.queue_no is not null then
    return new;
  end if;

  select kt.queue_no
    into v_existing
  from public.kitchen_tickets kt
  where kt.tenant_id = new.tenant_id
    and kt.branch_id = new.branch_id
    and kt.event_key = new.event_key
    and kt.queue_no is not null
  order by kt.created_at, kt.id
  limit 1;

  if v_existing is not null then
    new.queue_no := v_existing;
    return new;
  end if;

  v_business_date := timezone('Asia/Bangkok', coalesce(new.created_at, now()))::date;

  insert into public.kitchen_queue_counters (
    tenant_id, branch_id, business_date, last_queue_no, updated_at
  ) values (
    new.tenant_id, new.branch_id, v_business_date, 1, now()
  )
  on conflict (tenant_id, branch_id, business_date) do update
  set last_queue_no = public.kitchen_queue_counters.last_queue_no + 1,
      updated_at = now()
  returning last_queue_no into new.queue_no;

  return new;
end;
$function$;

revoke all on function app.assign_kitchen_ticket_queue_no() from public;
