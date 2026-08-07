create table if not exists public.tenant_access_codes (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  access_code text not null unique,
  purpose text not null default 'customer',
  is_active boolean not null default true,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint tenant_access_codes_format_chk check (access_code ~ '^[0-9]{6}$'),
  constraint tenant_access_codes_purpose_chk check (purpose in ('customer','sales_demo','internal_test')),
  constraint tenant_access_codes_range_chk check (
    (purpose = 'customer' and access_code::integer between 100000 and 799999)
    or (purpose = 'internal_test' and access_code::integer between 800000 and 899999)
    or (purpose = 'sales_demo' and access_code::integer between 900000 and 999999)
  )
);

comment on table public.tenant_access_codes is 'Immutable six-digit human-facing store code registry. Authentication/authorization must never rely on this code alone.';
comment on column public.tenant_access_codes.access_code is 'Human-facing immutable six-digit store code. Customer codes use 100000-799999; internal tests 800000-899999; sales demo 900000-999999.';

alter table public.tenant_access_codes enable row level security;
revoke all on table public.tenant_access_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_access_codes to service_role;

create or replace function app.enforce_tenant_access_code_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
begin
  if new.access_code is distinct from old.access_code then
    raise exception using errcode = '23514', message = 'tenant_access_code_immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app.enforce_tenant_access_code_immutable() from public, anon, authenticated;
grant execute on function app.enforce_tenant_access_code_immutable() to service_role;

drop trigger if exists trg_tenant_access_code_immutable on public.tenant_access_codes;
create trigger trg_tenant_access_code_immutable
before update on public.tenant_access_codes
for each row execute function app.enforce_tenant_access_code_immutable();

create table if not exists public.tenant_data_lifecycle (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  lifecycle_status text not null default 'trial',
  data_home text not null default 'primary',
  desired_data_home text not null default 'primary',
  migration_status text not null default 'idle',
  source_home text,
  target_home text,
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  grace_until timestamptz,
  archive_after timestamptz,
  migration_started_at timestamptz,
  migration_completed_at timestamptz,
  last_snapshot_at timestamptz,
  last_verified_at timestamptz,
  routing_version bigint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_data_lifecycle_status_chk check (lifecycle_status in ('sales_demo','trial','active','grace','suspended','expired','migrating','archived')),
  constraint tenant_data_lifecycle_home_chk check (data_home in ('primary','trial','archive')),
  constraint tenant_data_lifecycle_desired_home_chk check (desired_data_home in ('primary','trial','archive')),
  constraint tenant_data_lifecycle_source_home_chk check (source_home is null or source_home in ('primary','trial','archive')),
  constraint tenant_data_lifecycle_target_home_chk check (target_home is null or target_home in ('primary','trial','archive')),
  constraint tenant_data_lifecycle_migration_status_chk check (migration_status in ('idle','planned','copying','verifying','cutover','complete','failed')),
  constraint tenant_data_lifecycle_trial_window_chk check (trial_expires_at is null or trial_started_at is null or trial_expires_at > trial_started_at),
  constraint tenant_data_lifecycle_grace_window_chk check (grace_until is null or trial_expires_at is null or grace_until >= trial_expires_at)
);

comment on table public.tenant_data_lifecycle is 'Server-only control-plane routing/lifecycle state. data_home is authoritative current location; desired_data_home is a migration target only.';

alter table public.tenant_data_lifecycle enable row level security;
revoke all on table public.tenant_data_lifecycle from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_data_lifecycle to service_role;

create index if not exists idx_tenant_data_lifecycle_status_home
  on public.tenant_data_lifecycle (lifecycle_status, data_home);
create index if not exists idx_tenant_data_lifecycle_migration
  on public.tenant_data_lifecycle (migration_status, desired_data_home)
  where migration_status <> 'idle';

create or replace function app.bump_tenant_data_lifecycle_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
begin
  if new.lifecycle_status is distinct from old.lifecycle_status
     or new.data_home is distinct from old.data_home
     or new.desired_data_home is distinct from old.desired_data_home
     or new.migration_status is distinct from old.migration_status
     or new.source_home is distinct from old.source_home
     or new.target_home is distinct from old.target_home then
    new.routing_version := old.routing_version + 1;
  else
    new.routing_version := old.routing_version;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app.bump_tenant_data_lifecycle_version() from public, anon, authenticated;
grant execute on function app.bump_tenant_data_lifecycle_version() to service_role;

drop trigger if exists trg_tenant_data_lifecycle_version on public.tenant_data_lifecycle;
create trigger trg_tenant_data_lifecycle_version
before update on public.tenant_data_lifecycle
for each row execute function app.bump_tenant_data_lifecycle_version();

insert into public.tenant_access_codes (tenant_id, access_code, purpose, metadata)
select id,
       case code
         when 'NDL-TH-001' then '900001'
         when 'BBQ-TH-002' then '800001'
         when 'TEST-TH-003' then '800002'
       end,
       case code
         when 'NDL-TH-001' then 'sales_demo'
         else 'internal_test'
       end,
       jsonb_build_object('legacy_code', code, 'assigned_for', case when code = 'NDL-TH-001' then 'sales_it_demo' else 'prelaunch_internal_trial' end)
from public.tenants
where code in ('NDL-TH-001','BBQ-TH-002','TEST-TH-003')
on conflict (tenant_id) do nothing;

insert into public.tenant_data_lifecycle (
  tenant_id,
  lifecycle_status,
  data_home,
  desired_data_home,
  migration_status,
  source_home,
  target_home,
  metadata
)
select id,
       case when code = 'NDL-TH-001' then 'sales_demo' else 'trial' end,
       'primary',
       case when code = 'NDL-TH-001' then 'primary' else 'trial' end,
       case when code = 'NDL-TH-001' then 'idle' else 'planned' end,
       case when code = 'NDL-TH-001' then null else 'primary' end,
       case when code = 'NDL-TH-001' then null else 'trial' end,
       jsonb_build_object('legacy_code', code, 'prelaunch_baseline', true)
from public.tenants
where code in ('NDL-TH-001','BBQ-TH-002','TEST-TH-003')
on conflict (tenant_id) do nothing;
