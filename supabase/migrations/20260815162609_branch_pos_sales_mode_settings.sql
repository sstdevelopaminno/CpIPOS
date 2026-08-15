create table if not exists public.branch_pos_sales_mode_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  mode_order jsonb not null default '["home","dine_in","buffet_table","delivery"]'::jsonb,
  updated_by uuid null references public.users_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, branch_id),
  constraint branch_pos_sales_mode_settings_order_array_check
    check (
      case
        when jsonb_typeof(mode_order) = 'array' then jsonb_array_length(mode_order) = 4
        else false
      end
    )
);

drop trigger if exists trg_branch_pos_sales_mode_settings_touch on public.branch_pos_sales_mode_settings;
create trigger trg_branch_pos_sales_mode_settings_touch
before update on public.branch_pos_sales_mode_settings
for each row execute function app.touch_updated_at();

alter table public.branch_pos_sales_mode_settings enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'branch_pos_sales_mode_settings'
      and policyname = 'branch_pos_sales_mode_settings_select'
  ) then
    create policy branch_pos_sales_mode_settings_select
    on public.branch_pos_sales_mode_settings
    for select
    to authenticated
    using (app.has_branch_access(tenant_id, branch_id) or app.is_it_admin());
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'branch_pos_sales_mode_settings'
      and policyname = 'branch_pos_sales_mode_settings_insert'
  ) then
    create policy branch_pos_sales_mode_settings_insert
    on public.branch_pos_sales_mode_settings
    for insert
    to authenticated
    with check (
      app.has_role(tenant_id, branch_id, array['owner','manager']::public.branch_role[])
      or app.is_it_admin()
    );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'branch_pos_sales_mode_settings'
      and policyname = 'branch_pos_sales_mode_settings_update'
  ) then
    create policy branch_pos_sales_mode_settings_update
    on public.branch_pos_sales_mode_settings
    for update
    to authenticated
    using (
      app.has_role(tenant_id, branch_id, array['owner','manager']::public.branch_role[])
      or app.is_it_admin()
    )
    with check (
      app.has_role(tenant_id, branch_id, array['owner','manager']::public.branch_role[])
      or app.is_it_admin()
    );
  end if;
end $$;

comment on table public.branch_pos_sales_mode_settings is
  'Branch-scoped POS sales mode display order. Control-plane UI preference shared by POS devices in the branch.';
comment on column public.branch_pos_sales_mode_settings.mode_order is
  'JSON array containing the complete supported sales-mode order; visibility remains controlled separately.';
