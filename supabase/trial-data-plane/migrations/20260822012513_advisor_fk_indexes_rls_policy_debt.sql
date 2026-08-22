-- Advisor debt hardening for production and trial data planes.
-- Safe-by-default: adds missing FK indexes, keeps RLS no-policy tables fail-closed,
-- and removes SELECT overlap from broad authenticated ALL policies without widening writes.

set lock_timeout = '5s';
set statement_timeout = '10min';

-- Create covering indexes for every public foreign key that does not already have one.
do $$
declare
  r record;
  idx_name text;
begin
  for r in
    select
      n.nspname as schema_name,
      c.relname as table_name,
      con.conname as constraint_name,
      array_agg(a.attname order by u.ord) as column_names,
      string_agg(format('%I', a.attname), ', ' order by u.ord) as column_sql,
      con.conrelid,
      con.conkey
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join unnest(con.conkey) with ordinality as u(attnum, ord) on true
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = u.attnum
    where con.contype = 'f'
      and n.nspname = 'public'
      and c.relkind in ('r', 'p')
    group by n.nspname, c.relname, con.conname, con.conrelid, con.conkey
  loop
    if not exists (
      select 1
      from pg_index i
      where i.indrelid = r.conrelid
        and i.indisvalid
        and (i.indkey::smallint[])[1:array_length(r.conkey, 1)] = r.conkey
    ) then
      idx_name := left('idx_fk_' || r.table_name || '_' || array_to_string(r.column_names, '_'), 50)
        || '_' || substr(md5(r.schema_name || '.' || r.table_name || '.' || r.constraint_name), 1, 8);

      execute format('create index if not exists %I on %I.%I (%s)', idx_name, r.schema_name, r.table_name, r.column_sql);
    end if;
  end loop;
end
$$;

-- Supabase advisor flags RLS-enabled tables with no policy. Keep them service-role-only
-- by adding an explicit deny-all client policy instead of opening tenant data accidentally.
do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and not exists (
        select 1
        from pg_policies p
        where p.schemaname = n.nspname
          and p.tablename = c.relname
      )
  loop
    execute format(
      'create policy %I on %I.%I for all to public using (false) with check (false)',
      'deny_client_access_until_scoped_policy',
      r.schema_name,
      r.table_name
    );
  end loop;
end
$$;

create or replace function pg_temp.cpipos_policy_exists(target_table text, target_policy text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = target_table
      and policyname = target_policy
  );
$$;

create or replace function pg_temp.cpipos_split_authenticated_all_policy(
  target_table text,
  all_policy text,
  select_policy text,
  insert_policy text,
  update_policy text,
  delete_policy text,
  using_sql text,
  check_sql text
)
returns void
language plpgsql
as $$
begin
  if not pg_temp.cpipos_policy_exists(target_table, all_policy)
    or not pg_temp.cpipos_policy_exists(target_table, select_policy) then
    return;
  end if;

  if not pg_temp.cpipos_policy_exists(target_table, insert_policy) then
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%s)',
      insert_policy,
      target_table,
      check_sql
    );
  end if;

  if not pg_temp.cpipos_policy_exists(target_table, update_policy) then
    execute format(
      'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
      update_policy,
      target_table,
      using_sql,
      check_sql
    );
  end if;

  if not pg_temp.cpipos_policy_exists(target_table, delete_policy) then
    execute format(
      'create policy %I on public.%I for delete to authenticated using (%s)',
      delete_policy,
      target_table,
      using_sql
    );
  end if;

  execute format('drop policy if exists %I on public.%I', all_policy, target_table);
end;
$$;

-- Split ALL policies that overlap dedicated SELECT policies. This preserves SELECT behavior
-- while leaving write/delete paths scoped to the old ALL policy predicates.
select pg_temp.cpipos_split_authenticated_all_policy(
  'branch_device_shift_sessions',
  'branch_device_shift_sessions_manage',
  'branch_device_shift_sessions_select',
  'branch_device_shift_sessions_insert',
  'branch_device_shift_sessions_update',
  'branch_device_shift_sessions_delete',
  'app.has_branch_access(tenant_id, branch_id)',
  'app.has_branch_access(tenant_id, branch_id)'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'branch_devices',
  'branch_devices_manage',
  'branch_devices_select',
  'branch_devices_manage_insert',
  'branch_devices_manage_update',
  'branch_devices_manage_delete',
  '(app.has_role(tenant_id, branch_id, array[''owner''::public.branch_role, ''manager''::public.branch_role]) or app.is_it_admin())',
  '(app.has_role(tenant_id, branch_id, array[''owner''::public.branch_role, ''manager''::public.branch_role]) or app.is_it_admin())'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'branch_login_policies',
  'branch_login_policies_manage',
  'branch_login_policies_select',
  'branch_login_policies_manage_insert',
  'branch_login_policies_manage_update',
  'branch_login_policies_manage_delete',
  '(app.has_role(tenant_id, branch_id, array[''owner''::public.branch_role, ''manager''::public.branch_role]) or app.is_it_admin())',
  '(app.has_role(tenant_id, branch_id, array[''owner''::public.branch_role, ''manager''::public.branch_role]) or app.is_it_admin())'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'branches',
  'branches_owner_manage',
  'branches_tenant_select',
  'branches_owner_insert',
  'branches_owner_update',
  'branches_owner_delete',
  '(app.has_role(tenant_id, id, array[''owner''::public.branch_role]) or app.is_it_admin())',
  '(app.has_role(tenant_id, id, array[''owner''::public.branch_role]) or app.is_it_admin())'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'orders',
  'tenant_branch_tables_isolation_orders',
  'orders_pos_scope_select',
  'orders_branch_insert',
  'orders_branch_update',
  'orders_branch_delete',
  'app.has_branch_access(tenant_id, branch_id)',
  'app.has_branch_access(tenant_id, branch_id)'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'order_items',
  'tenant_branch_tables_isolation_order_items',
  'order_items_pos_scope_select',
  'order_items_branch_insert',
  'order_items_branch_update',
  'order_items_branch_delete',
  'app.has_branch_access(tenant_id, branch_id)',
  'app.has_branch_access(tenant_id, branch_id)'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'payments',
  'tenant_branch_tables_isolation_payments',
  'payments_pos_scope_select',
  'payments_branch_insert',
  'payments_branch_update',
  'payments_branch_delete',
  'app.has_branch_access(tenant_id, branch_id)',
  'app.has_branch_access(tenant_id, branch_id)'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'products',
  'tenant_branch_tables_isolation_products',
  'products_pos_scope_select',
  'products_branch_insert',
  'products_branch_update',
  'products_branch_delete',
  'app.has_branch_access(tenant_id, branch_id)',
  'app.has_branch_access(tenant_id, branch_id)'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'package_feature_catalog',
  'package_feature_catalog_it_admin_manage',
  'package_feature_catalog_read',
  'package_feature_catalog_it_admin_insert',
  'package_feature_catalog_it_admin_update',
  'package_feature_catalog_it_admin_delete',
  'app.is_it_admin()',
  'app.is_it_admin()'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'pos_customer_display_pairings',
  'pos_customer_display_pairings_write',
  'pos_customer_display_pairings_select',
  'pos_customer_display_pairings_insert',
  'pos_customer_display_pairings_update',
  'pos_customer_display_pairings_delete',
  'app.has_branch_access(tenant_id, branch_id)',
  'app.has_branch_access(tenant_id, branch_id)'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'pos_customer_display_policies',
  'pos_customer_display_policies_write',
  'pos_customer_display_policies_select',
  'pos_customer_display_policies_insert',
  'pos_customer_display_policies_update',
  'pos_customer_display_policies_delete',
  'app.has_branch_access(tenant_id, branch_id)',
  'app.has_branch_access(tenant_id, branch_id)'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'pos_customer_display_states',
  'pos_customer_display_states_write',
  'pos_customer_display_states_select',
  'pos_customer_display_states_insert',
  'pos_customer_display_states_update',
  'pos_customer_display_states_delete',
  'app.has_branch_access(tenant_id, branch_id)',
  'app.has_branch_access(tenant_id, branch_id)'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'pos_user_approval_permissions',
  'pos_user_approval_permissions_owner_manage',
  'pos_user_approval_permissions_select',
  'pos_user_approval_permissions_owner_insert',
  'pos_user_approval_permissions_owner_update',
  'pos_user_approval_permissions_owner_delete',
  'app.has_role(tenant_id, branch_id, array[''owner''::public.branch_role])',
  'app.has_role(tenant_id, branch_id, array[''owner''::public.branch_role])'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'staff_attendance_records',
  'staff_attendance_records_manage',
  'staff_attendance_records_select_self_or_branch_manage',
  'staff_attendance_records_manage_insert',
  'staff_attendance_records_manage_update',
  'staff_attendance_records_manage_delete',
  '(app.is_it_admin() or app.has_role(tenant_id, branch_id, array[''owner''::public.branch_role, ''manager''::public.branch_role]))',
  '(app.is_it_admin() or app.has_role(tenant_id, branch_id, array[''owner''::public.branch_role, ''manager''::public.branch_role]))'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'subscription_package_features',
  'subscription_package_features_it_admin_manage',
  'subscription_package_features_read',
  'subscription_package_features_it_admin_insert',
  'subscription_package_features_it_admin_update',
  'subscription_package_features_it_admin_delete',
  'app.is_it_admin()',
  'app.is_it_admin()'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'tenant_billing_cycles',
  'billing_cycles_it_admin_manage',
  'billing_cycles_owner_read',
  'billing_cycles_it_admin_insert',
  'billing_cycles_it_admin_update',
  'billing_cycles_it_admin_delete',
  'app.is_it_admin()',
  'app.is_it_admin()'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'tenant_feature_subscriptions',
  'tenant_feature_subscriptions_it_admin_manage',
  'tenant_feature_subscriptions_tenant_read',
  'tenant_feature_subscriptions_it_admin_insert',
  'tenant_feature_subscriptions_it_admin_update',
  'tenant_feature_subscriptions_it_admin_delete',
  'app.is_it_admin()',
  'app.is_it_admin()'
);

select pg_temp.cpipos_split_authenticated_all_policy(
  'user_branch_roles',
  'user_branch_roles_owner_manage',
  'user_branch_roles_isolation',
  'user_branch_roles_owner_insert',
  'user_branch_roles_owner_update',
  'user_branch_roles_owner_delete',
  '(app.has_role(tenant_id, branch_id, array[''owner''::public.branch_role]) or app.is_it_admin())',
  '(app.has_role(tenant_id, branch_id, array[''owner''::public.branch_role]) or app.is_it_admin())'
);
