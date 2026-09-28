-- Realtime-safe customer projection for subscription lock/unlock.
-- Browser clients receive only the minimum lifecycle fields required to refresh
-- their authoritative server-side guard.

create table if not exists public.tenant_subscription_runtime (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  lifecycle_status text not null,
  access_locked boolean not null default false,
  lock_reason text,
  expires_at timestamptz,
  payment_review_status text not null default 'none',
  updated_at timestamptz not null default now()
);

alter table public.tenant_subscription_runtime enable row level security;

revoke all on public.tenant_subscription_runtime from public, anon;
grant select on public.tenant_subscription_runtime to authenticated;
grant all on public.tenant_subscription_runtime to service_role;

drop policy if exists tenant_subscription_runtime_select on public.tenant_subscription_runtime;
create policy tenant_subscription_runtime_select
on public.tenant_subscription_runtime
for select
to authenticated
using (app.has_tenant_access(tenant_id));

create or replace function app.sync_tenant_subscription_runtime()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,app
as $$
declare
  v_expiry timestamptz;
begin
  if tg_op='DELETE' then
    delete from public.tenant_subscription_runtime where tenant_id=old.tenant_id;
    return old;
  end if;

  v_expiry := case
    when new.lifecycle_status='trial' then new.trial_expires_at
    when new.lifecycle_status='grace' then new.grace_until
    else new.subscription_expires_at
  end;

  insert into public.tenant_subscription_runtime(
    tenant_id,lifecycle_status,access_locked,lock_reason,expires_at,payment_review_status,updated_at
  ) values (
    new.tenant_id,new.lifecycle_status,new.access_locked,new.lock_reason,v_expiry,new.payment_review_status,now()
  )
  on conflict(tenant_id) do update set
    lifecycle_status=excluded.lifecycle_status,
    access_locked=excluded.access_locked,
    lock_reason=excluded.lock_reason,
    expires_at=excluded.expires_at,
    payment_review_status=excluded.payment_review_status,
    updated_at=excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists trg_sync_tenant_subscription_runtime on public.tenant_data_lifecycle;
create trigger trg_sync_tenant_subscription_runtime
after insert or update or delete on public.tenant_data_lifecycle
for each row execute function app.sync_tenant_subscription_runtime();

insert into public.tenant_subscription_runtime(
  tenant_id,lifecycle_status,access_locked,lock_reason,expires_at,payment_review_status,updated_at
)
select
  tenant_id,
  lifecycle_status,
  access_locked,
  lock_reason,
  case
    when lifecycle_status='trial' then trial_expires_at
    when lifecycle_status='grace' then grace_until
    else subscription_expires_at
  end,
  payment_review_status,
  now()
from public.tenant_data_lifecycle
on conflict(tenant_id) do update set
  lifecycle_status=excluded.lifecycle_status,
  access_locked=excluded.access_locked,
  lock_reason=excluded.lock_reason,
  expires_at=excluded.expires_at,
  payment_review_status=excluded.payment_review_status,
  updated_at=excluded.updated_at;

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='tenant_subscription_runtime'
  ) then
    alter publication supabase_realtime add table public.tenant_subscription_runtime;
  end if;
end $$;
