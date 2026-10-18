-- CUSTOM Optical only. Connect existing per-tenant IT CRM menu switches to
-- Database RLS, not just to client navigation. No transaction data is changed.
-- Existing CRM default: missing switch = enabled; explicit IT false = denied.
-- POS service-role workflows retain their separate session/contract feature checks.
begin;
create or replace function app.custom_optical_crm_menu_allowed(
  p_tenant_id uuid, p_menu_key text
) returns boolean
language sql stable security definer set search_path = ''
as $function$
  select p_tenant_id is not null
    and p_menu_key in (
      'main.crm_optical_customers',
      'main.crm_optical_orders',
      'main.crm_optical_stock',
      'main.crm_optical_reports'
    )
    and not exists (
      select 1 from public.tenant_pos_menu_policies policy
      where policy.tenant_id = p_tenant_id
        and policy.menu_key in ('main.crm_optical', p_menu_key)
        and policy.is_enabled = false
    );
$function$;
revoke all on function app.custom_optical_crm_menu_allowed(uuid,text)
  from public, anon, authenticated;
grant execute on function app.custom_optical_crm_menu_allowed(uuid,text)
  to authenticated;

-- Owner/manager Optical customer and eye examination operations are also
-- server-denied when IT closes the CRM customer submenu or its parent.
drop policy if exists optical_customers_select on public.optical_customers;
create policy optical_customers_select on public.optical_customers
  for select to authenticated
  using (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_customers')
  );
drop policy if exists optical_customers_insert on public.optical_customers;
create policy optical_customers_insert on public.optical_customers
  for insert to authenticated
  with check (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_customers')
  );
drop policy if exists optical_customers_update on public.optical_customers;
create policy optical_customers_update on public.optical_customers
  for update to authenticated
  using (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_customers')
  )
  with check (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_customers')
  );
drop policy if exists optical_exams_select on public.optical_eye_exams;
create policy optical_exams_select on public.optical_eye_exams
  for select to authenticated
  using (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_customers')
  );
drop policy if exists optical_exams_insert on public.optical_eye_exams;
create policy optical_exams_insert on public.optical_eye_exams
  for insert to authenticated
  with check (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_customers')
  );

-- Read-only CRM stock is independent of shared restaurant/retail stock.
drop policy if exists custom_optical_stock_bins_select_v1 on public.optical_stock_bins;
create policy custom_optical_stock_bins_select_v1 on public.optical_stock_bins
  for select to authenticated
  using (
    app.has_branch_access(tenant_id,branch_id)
    and app.custom_optical_stock_read_enabled(tenant_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_stock')
  );
drop policy if exists optical_work_orders_crm_read_v1 on public.optical_work_orders;
create policy optical_work_orders_crm_read_v1 on public.optical_work_orders
  for select to authenticated
  using (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_finance_read_enabled(tenant_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_orders')
  );
drop policy if exists optical_work_order_lines_crm_read_v1 on public.optical_work_order_lines;
create policy optical_work_order_lines_crm_read_v1 on public.optical_work_order_lines
  for select to authenticated
  using (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_finance_read_enabled(tenant_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_orders')
  );
drop policy if exists optical_stock_reservations_crm_read_v1 on public.optical_stock_reservations;
create policy optical_stock_reservations_crm_read_v1 on public.optical_stock_reservations
  for select to authenticated
  using (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_finance_read_enabled(tenant_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_orders')
  );
drop policy if exists optical_payment_ledger_crm_read_v1 on public.optical_payment_ledger;
create policy optical_payment_ledger_crm_read_v1 on public.optical_payment_ledger
  for select to authenticated
  using (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_finance_read_enabled(tenant_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_orders')
  );
drop policy if exists optical_work_order_events_crm_read_v1 on public.optical_work_order_events;
create policy optical_work_order_events_crm_read_v1 on public.optical_work_order_events
  for select to authenticated
  using (
    public.can_manage_optical_customer_data(tenant_id,branch_id)
    and app.custom_optical_finance_read_enabled(tenant_id)
    and app.custom_optical_crm_menu_allowed(tenant_id,'main.crm_optical_orders')
  );
commit;
