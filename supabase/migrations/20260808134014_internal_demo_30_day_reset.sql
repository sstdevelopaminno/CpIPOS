-- Automatic 30-day reset for internal IT/Sales demo tenants.
-- Structural identity/configuration is preserved; only demo business/runtime data is purged.

create or replace function app.delete_tenant_rows(p_table_name text,p_tenant_id uuid)
returns bigint
language plpgsql
security definer
set search_path=public,app
as $$
declare v_rows bigint:=0;
begin
  if to_regclass(format('public.%I',p_table_name)) is null then return 0; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=p_table_name and column_name='tenant_id') then return 0; end if;
  execute format('delete from public.%I where tenant_id=$1',p_table_name) using p_tenant_id;
  get diagnostics v_rows=row_count;
  return v_rows;
end;$$;
revoke all on function app.delete_tenant_rows(text,uuid) from public,anon,authenticated;
grant execute on function app.delete_tenant_rows(text,uuid) to service_role;

create or replace function app.purge_tenant_business_data(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,app
as $$
declare v_total bigint:=0; v_rows bigint; v_result jsonb:='{}'::jsonb; v_table text;
begin
  -- Child/transaction rows first, then catalog/runtime roots. Never include tenants, branches,
  -- users, roles, branch_devices, login policies, subscription/lifecycle or printer configuration.
  foreach v_table in array array[
    'table_qr_orders','table_qr_sessions','table_bill_sessions',
    'payments','transfer_payment_verifications','order_items','orders',
    'stock_movements','recipes','product_combo_items','ingredient_packages',
    'products','product_categories','ingredients',
    'mobile_member_transactions','mobile_member_qr_tokens','mobile_members',
    'staff_attendance_events','cash_drawer_events','manager_pin_approvals','print_jobs',
    'desktop_sales_order_items','desktop_sales_orders','native_desktop_sync_receipts',
    'pos_sessions','pos_login_contexts','shifts',
    'table_layout_objects','dining_tables','table_zones'
  ] loop
    v_rows:=app.delete_tenant_rows(v_table,p_tenant_id);
    v_total:=v_total+v_rows;
    if v_rows>0 then v_result:=v_result||jsonb_build_object(v_table,v_rows); end if;
  end loop;
  return jsonb_build_object('total_rows',v_total,'tables',v_result);
end;$$;
revoke all on function app.purge_tenant_business_data(uuid) from public,anon,authenticated;
grant execute on function app.purge_tenant_business_data(uuid) to service_role;

create or replace function app.reset_internal_demo_tenant(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,app
as $$
declare v_policy public.tenant_demo_reset_policies%rowtype; v_lifecycle public.tenant_data_lifecycle%rowtype; v_audit uuid; v_result jsonb;
begin
  select * into v_policy from public.tenant_demo_reset_policies where tenant_id=p_tenant_id and is_enabled=true for update;
  if not found then raise exception 'demo_reset_policy_not_found'; end if;
  select * into v_lifecycle from public.tenant_data_lifecycle where tenant_id=p_tenant_id for update;
  if not found or v_lifecycle.lifecycle_status<>'sales_demo' or coalesce((v_lifecycle.metadata->>'internal_demo')::boolean,false) is not true then raise exception 'tenant_not_internal_demo'; end if;

  insert into public.tenant_demo_reset_audit(tenant_id,status,metadata) values(p_tenant_id,'started',jsonb_build_object('scheduled_for',v_policy.next_reset_at)) returning id into v_audit;
  begin
    v_result:=app.purge_tenant_business_data(p_tenant_id);
    update public.tenant_demo_reset_policies set last_reset_at=now(),next_reset_at=now()+make_interval(days=>reset_interval_days),updated_at=now() where tenant_id=p_tenant_id;
    update public.tenant_demo_reset_audit set status='completed',reset_completed_at=now(),metadata=metadata||v_result where id=v_audit;
    update public.tenant_data_lifecycle set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_demo_reset_at',now()) where tenant_id=p_tenant_id;
    return v_result;
  exception when others then
    update public.tenant_demo_reset_audit set status='failed',reset_completed_at=now(),metadata=metadata||jsonb_build_object('error',sqlerrm) where id=v_audit;
    raise;
  end;
end;$$;
revoke all on function app.reset_internal_demo_tenant(uuid) from public,anon,authenticated;
grant execute on function app.reset_internal_demo_tenant(uuid) to service_role;

create or replace function app.run_due_internal_demo_resets()
returns integer
language plpgsql
security definer
set search_path=public,app
as $$
declare v_row record; v_count integer:=0;
begin
  for v_row in select tenant_id from public.tenant_demo_reset_policies where is_enabled=true and next_reset_at<=now() order by next_reset_at loop
    perform app.reset_internal_demo_tenant(v_row.tenant_id);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;$$;
revoke all on function app.run_due_internal_demo_resets() from public,anon,authenticated;
grant execute on function app.run_due_internal_demo_resets() to service_role;

-- pg_cron runs a daily due check. A tenant only resets when its own next_reset_at has reached day 30.
create extension if not exists pg_cron with schema pg_catalog;
do $$ declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='cpipos_internal_demo_reset_daily' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('cpipos_internal_demo_reset_daily','15 19 * * *','select app.run_due_internal_demo_resets();');
end $$;
