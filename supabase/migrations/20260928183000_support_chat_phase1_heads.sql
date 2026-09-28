-- Support Chat Phase 1 notification/control-plane mirror on CpiPOS-001.
-- Full message history lives in the separate CpiPOS-Communications project.

alter table public.users_profiles
  add column if not exists avatar_url text;

create table if not exists public.support_chat_heads (
  conversation_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  store_code text not null,
  store_name text not null,
  store_logo_url text,
  subject text not null,
  contact_name text not null,
  status text not null default 'new'
    check (status in ('new','unassigned','in_progress','waiting_store','waiting_it','closed')),
  assigned_role text
    check (assigned_role is null or assigned_role in ('it_admin','it_support')),
  assigned_user_id uuid references public.users_profiles(id) on delete set null,
  assigned_user_name text,
  assigned_user_avatar_url text,
  latest_message_at timestamptz,
  latest_message_preview text,
  latest_sender_type text
    check (latest_sender_type is null or latest_sender_type in ('store','it','system')),
  unread_it_count integer not null default 0 check (unread_it_count >= 0),
  unread_store_count integer not null default 0 check (unread_store_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_chat_heads_tenant_latest_idx
  on public.support_chat_heads (tenant_id, latest_message_at desc nulls last);
create index if not exists support_chat_heads_it_inbox_idx
  on public.support_chat_heads (status, unread_it_count desc, latest_message_at desc nulls last);
create index if not exists support_chat_heads_assigned_idx
  on public.support_chat_heads (assigned_user_id, latest_message_at desc nulls last);

alter table public.support_chat_heads enable row level security;

drop policy if exists support_chat_heads_select on public.support_chat_heads;
create policy support_chat_heads_select
on public.support_chat_heads
for select
to authenticated
using (
  app.has_tenant_access(tenant_id)
  or exists (
    select 1
    from public.users_profiles up
    where up.id = auth.uid()
      and up.platform_role in ('it_admin','it_support')
      and up.is_active = true
      and up.archived_at is null
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_chat_heads'
  ) then
    alter publication supabase_realtime add table public.support_chat_heads;
  end if;
end $$;
