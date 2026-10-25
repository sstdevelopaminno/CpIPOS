-- Native POS QR FCM registration, private server-side only.
-- FCM tokens may identify devices; never expose to anon/authenticated PostgREST.
create table if not exists public.native_pos_push_devices (
  installation_id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  device_code text not null,
  user_id uuid not null,
  fcm_token text not null,
  app_id text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint native_pos_push_valid_app check (
    app_id in ('com.cpipos.pos.next', 'com.cpipos.pos.next.dev')
  ),
  constraint native_pos_push_token_length check (length(fcm_token) between 50 and 4096)
);
create index if not exists native_pos_push_active_branch
  on public.native_pos_push_devices(tenant_id, branch_id, updated_at desc)
  where enabled = true;
create unique index if not exists native_pos_push_unique_token
  on public.native_pos_push_devices(fcm_token);
alter table public.native_pos_push_devices enable row level security;
revoke all on public.native_pos_push_devices from anon, authenticated;
grant all on public.native_pos_push_devices to service_role;
