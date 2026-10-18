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

-- Existing authenticated SECURITY DEFINER Optical write RPCs bypass table RLS.
-- Recompile unchanged functions with an additional IT tenant-card guard so a
-- direct /rest/v1/rpc call cannot circumvent disabled CRM submenus.
-- Service-role POS customer writes are separately protected by the POS server API.

CREATE OR REPLACE FUNCTION public.customer_portal_optical_product_create_v1(p_tenant_id uuid, p_branch_id uuid, p_product jsonb, p_currency text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare v_kind text;v_category text;v_name text;v_sku text;v_price numeric;
 v_id uuid;v_enabled boolean;v_fields jsonb;
begin
 if not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_stock') then
   raise exception 'OPTICAL_CRM_STOCK_IT_DISABLED' using errcode='42501';
 end if;
 if auth.uid() is null then raise exception 'OPTICAL_AUTH_REQUIRED'; end if;
 if not exists (
  select 1 from public.user_branch_roles r
  join public.users_profiles u on u.id=r.user_id and u.is_active=true
  where r.user_id=auth.uid() and r.tenant_id=p_tenant_id
   and r.branch_id=p_branch_id and r.role::text in ('owner','manager')
 ) then raise exception 'OPTICAL_BRANCH_FORBIDDEN'; end if;
 if not exists (
  select 1 from public.branches b where b.id=p_branch_id
   and b.tenant_id=p_tenant_id and b.is_active=true
 ) then raise exception 'OPTICAL_BRANCH_INACTIVE'; end if;
 select exists(
  select 1 from public.tenant_subscription_contracts c
  join public.subscription_packages p on p.id=c.package_id
  where c.id=(select d.id from public.tenant_subscription_contracts d
    where d.tenant_id=p_tenant_id order by d.created_at desc limit 1)
   and c.status in ('active','trial')
   and (c.ended_at is null or c.ended_at>now())
   and lower(p.code)='custom'
   and c.metadata->'sales_modes'->>'optical_retail'='true'
 ) into v_enabled;
 if not v_enabled then raise exception 'OPTICAL_CUSTOM_ONLY'; end if;
 if jsonb_typeof(p_product)<>'object' then raise exception 'OPTICAL_INVALID_PRODUCT'; end if;
 v_kind=coalesce(p_product->>'kind','');
 v_name=btrim(coalesce(p_product->>'name',''));
 v_sku=btrim(coalesce(p_product->>'sku',''));
 if v_kind not in ('frame','lens','accessory') or length(v_name)<1 or length(v_name)>180 or
   length(v_sku)<1 or length(v_sku)>90 or v_sku ~ '[[:space:],;()]'
 then raise exception 'OPTICAL_INVALID_PRODUCT'; end if;
 if coalesce(p_product->>'price','') !~ '^[0-9]+([.][0-9]{1,2})? then raise exception 'OPTICAL_INVALID_PRICE'; end if;
 v_price=(p_product->>'price')::numeric;
 if v_price>999999999 or (p_currency='LAK' and v_price<>trunc(v_price))
 then raise exception 'OPTICAL_INVALID_PRICE'; end if;
 if p_currency not in ('THB','LAK','USD') then raise exception 'OPTICAL_INVALID_CURRENCY'; end if;
 if exists(select 1 from public.products
   where tenant_id=p_tenant_id and branch_id=p_branch_id
     and lower(sku)=lower(v_sku))
 then raise exception 'OPTICAL_SKU_DUPLICATE'; end if;
 if v_kind='lens' and (
    (nullif(p_product->>'lens_sph','') is not null and
      (p_product->>'lens_sph' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?       or abs((p_product->>'lens_sph')::numeric)>30))
    or
    (nullif(p_product->>'lens_cyl','') is not null and
      (p_product->>'lens_cyl' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?       or abs((p_product->>'lens_cyl')::numeric)>15))
   ) then raise exception 'OPTICAL_INVALID_PRESCRIPTION'; end if;
 v_category=case v_kind when 'frame' then 'กรอบแว่น'
  when 'lens' then 'เลนส์' else 'อุปกรณ์เสริม' end;
 v_fields=jsonb_build_object(
  'business_mode','optical_retail','optical_kind',v_kind,
  'optical_brand',left(coalesce(p_product->>'brand',''),120),
  'optical_model',left(coalesce(p_product->>'model',''),120),
  'optical_color',left(coalesce(p_product->>'color',''),80),
  'optical_frame_size',left(coalesce(p_product->>'frame_size',''),60),
  'optical_lens_name',left(coalesce(p_product->>'lens_name',''),120),
  'optical_lens_index',left(coalesce(p_product->>'lens_index',''),40),
  'optical_lens_sph',nullif(p_product->>'lens_sph',''),
  'optical_lens_cyl',nullif(p_product->>'lens_cyl',''),
  'currency_code',p_currency,'stock_verification','pending'
 );
 insert into public.products
 (tenant_id,branch_id,sku,name,category,price,sell_unit,stock_deduction_mode,is_combo,is_active,metadata)
 values (p_tenant_id,p_branch_id,v_sku,v_name,v_category,v_price,'ชิ้น','unit_only',false,true,v_fields)
 returning id into v_id;
 return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.optical_save_customer_exam(p_tenant_id uuid, p_branch_id uuid, p_customer_code text, p_full_name text, p_phone text DEFAULT NULL::text, p_age smallint DEFAULT NULL::smallint, p_exam_date date DEFAULT NULL::date, p_previous_prescription text DEFAULT NULL::text, p_pd_mm numeric DEFAULT NULL::numeric, p_examiner_name text DEFAULT NULL::text, p_right_sph numeric DEFAULT NULL::numeric, p_right_cyl numeric DEFAULT NULL::numeric, p_right_axis smallint DEFAULT NULL::smallint, p_right_add numeric DEFAULT NULL::numeric, p_left_sph numeric DEFAULT NULL::numeric, p_left_cyl numeric DEFAULT NULL::numeric, p_left_axis smallint DEFAULT NULL::smallint, p_left_add numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_customer_id uuid; v_exam_id uuid; v_request_id uuid;
begin
  if auth.uid() is not null
    and not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_customers') then
    raise exception 'OPTICAL_CRM_CUSTOMERS_IT_DISABLED' using errcode='42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id) then
    raise exception 'optical_customer_forbidden' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null
     or length(trim(coalesce(p_customer_code,''))) not between 1 and 48
     or length(trim(coalesce(p_full_name,''))) not between 1 and 240 then
    raise exception 'invalid_optical_customer' using errcode='22023';
  end if;
  if p_age is not null and p_age not between 0 and 130 then
    raise exception 'invalid_customer_age' using errcode='22023';
  end if;
  if p_pd_mm is not null and p_pd_mm not between 30 and 90 then
    raise exception 'invalid_pd_mm' using errcode='22023';
  end if;
  if p_exam_date is null then
    raise exception 'exam_date_required' using errcode='22023';
  end if;
  v_request_id := coalesce(p_request_id, gen_random_uuid());
  insert into public.optical_customers
    (tenant_id,branch_id,customer_code,full_name,phone,age,
     previous_prescription,last_exam_date,examiner_name,notes,created_by,updated_by)
  values
    (p_tenant_id,p_branch_id,trim(p_customer_code),trim(p_full_name),
     nullif(trim(coalesce(p_phone,'')),''),p_age,p_previous_prescription,
     p_exam_date,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),coalesce(auth.uid(),p_actor))
  on conflict (tenant_id,branch_id,customer_code) do update set
    full_name=excluded.full_name,phone=excluded.phone,age=excluded.age,
    previous_prescription=excluded.previous_prescription,
    last_exam_date=excluded.last_exam_date,examiner_name=excluded.examiner_name,
    notes=excluded.notes,updated_at=now(),updated_by=coalesce(auth.uid(),p_actor),deleted_at=null
  returning id into v_customer_id;

  insert into public.optical_eye_exams
    (tenant_id,branch_id,customer_id,examined_at,age_at_exam,right_sph,right_cyl,right_axis,
     right_add,left_sph,left_cyl,left_axis,left_add,pd_mm,previous_prescription,examiner_name,notes,created_by,request_id)
  values
    (p_tenant_id,p_branch_id,v_customer_id,p_exam_date,p_age,p_right_sph,p_right_cyl,p_right_axis,
     p_right_add,p_left_sph,p_left_cyl,p_left_axis,p_left_add,p_pd_mm,p_previous_prescription,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),v_request_id)
  on conflict (tenant_id,branch_id,request_id) do nothing
  returning id into v_exam_id;

  if v_exam_id is null then
    select id into v_exam_id from public.optical_eye_exams
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and request_id=v_request_id and customer_id=v_customer_id;
    if v_exam_id is null then
      raise exception 'optical_exam_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object('customer_id',v_customer_id,'exam_id',v_exam_id,'request_id',v_request_id);
end;
$function$;

commit;

 then raise exception 'OPTICAL_INVALID_PRICE'; end if;
 v_price=(p_product->>'price')::numeric;
 if v_price>999999999 or (p_currency='LAK' and v_price<>trunc(v_price))
 then raise exception 'OPTICAL_INVALID_PRICE'; end if;
 if p_currency not in ('THB','LAK','USD') then raise exception 'OPTICAL_INVALID_CURRENCY'; end if;
 if exists(select 1 from public.products
   where tenant_id=p_tenant_id and branch_id=p_branch_id
     and lower(sku)=lower(v_sku))
 then raise exception 'OPTICAL_SKU_DUPLICATE'; end if;
 if v_kind='lens' and (
    (nullif(p_product->>'lens_sph','') is not null and
      (p_product->>'lens_sph' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?
       or abs((p_product->>'lens_sph')::numeric)>30))
    or
    (nullif(p_product->>'lens_cyl','') is not null and
      (p_product->>'lens_cyl' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?
       or abs((p_product->>'lens_cyl')::numeric)>15))
   ) then raise exception 'OPTICAL_INVALID_PRESCRIPTION'; end if;
 v_category=case v_kind when 'frame' then 'กรอบแว่น'
  when 'lens' then 'เลนส์' else 'อุปกรณ์เสริม' end;
 v_fields=jsonb_build_object(
  'business_mode','optical_retail','optical_kind',v_kind,
  'optical_brand',left(coalesce(p_product->>'brand',''),120),
  'optical_model',left(coalesce(p_product->>'model',''),120),
  'optical_color',left(coalesce(p_product->>'color',''),80),
  'optical_frame_size',left(coalesce(p_product->>'frame_size',''),60),
  'optical_lens_name',left(coalesce(p_product->>'lens_name',''),120),
  'optical_lens_index',left(coalesce(p_product->>'lens_index',''),40),
  'optical_lens_sph',nullif(p_product->>'lens_sph',''),
  'optical_lens_cyl',nullif(p_product->>'lens_cyl',''),
  'currency_code',p_currency,'stock_verification','pending'
 );
 insert into public.products
 (tenant_id,branch_id,sku,name,category,price,sell_unit,stock_deduction_mode,is_combo,is_active,metadata)
 values (p_tenant_id,p_branch_id,v_sku,v_name,v_category,v_price,'ชิ้น','unit_only',false,true,v_fields)
 returning id into v_id;
 return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.optical_save_customer_exam(p_tenant_id uuid, p_branch_id uuid, p_customer_code text, p_full_name text, p_phone text DEFAULT NULL::text, p_age smallint DEFAULT NULL::smallint, p_exam_date date DEFAULT NULL::date, p_previous_prescription text DEFAULT NULL::text, p_pd_mm numeric DEFAULT NULL::numeric, p_examiner_name text DEFAULT NULL::text, p_right_sph numeric DEFAULT NULL::numeric, p_right_cyl numeric DEFAULT NULL::numeric, p_right_axis smallint DEFAULT NULL::smallint, p_right_add numeric DEFAULT NULL::numeric, p_left_sph numeric DEFAULT NULL::numeric, p_left_cyl numeric DEFAULT NULL::numeric, p_left_axis smallint DEFAULT NULL::smallint, p_left_add numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_customer_id uuid; v_exam_id uuid; v_request_id uuid;
begin
  if auth.uid() is not null
    and not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_customers') then
    raise exception 'OPTICAL_CRM_CUSTOMERS_IT_DISABLED' using errcode='42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id) then
    raise exception 'optical_customer_forbidden' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null
     or length(trim(coalesce(p_customer_code,''))) not between 1 and 48
     or length(trim(coalesce(p_full_name,''))) not between 1 and 240 then
    raise exception 'invalid_optical_customer' using errcode='22023';
  end if;
  if p_age is not null and p_age not between 0 and 130 then
    raise exception 'invalid_customer_age' using errcode='22023';
  end if;
  if p_pd_mm is not null and p_pd_mm not between 30 and 90 then
    raise exception 'invalid_pd_mm' using errcode='22023';
  end if;
  if p_exam_date is null then
    raise exception 'exam_date_required' using errcode='22023';
  end if;
  v_request_id := coalesce(p_request_id, gen_random_uuid());
  insert into public.optical_customers
    (tenant_id,branch_id,customer_code,full_name,phone,age,
     previous_prescription,last_exam_date,examiner_name,notes,created_by,updated_by)
  values
    (p_tenant_id,p_branch_id,trim(p_customer_code),trim(p_full_name),
     nullif(trim(coalesce(p_phone,'')),''),p_age,p_previous_prescription,
     p_exam_date,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),coalesce(auth.uid(),p_actor))
  on conflict (tenant_id,branch_id,customer_code) do update set
    full_name=excluded.full_name,phone=excluded.phone,age=excluded.age,
    previous_prescription=excluded.previous_prescription,
    last_exam_date=excluded.last_exam_date,examiner_name=excluded.examiner_name,
    notes=excluded.notes,updated_at=now(),updated_by=coalesce(auth.uid(),p_actor),deleted_at=null
  returning id into v_customer_id;

  insert into public.optical_eye_exams
    (tenant_id,branch_id,customer_id,examined_at,age_at_exam,right_sph,right_cyl,right_axis,
     right_add,left_sph,left_cyl,left_axis,left_add,pd_mm,previous_prescription,examiner_name,notes,created_by,request_id)
  values
    (p_tenant_id,p_branch_id,v_customer_id,p_exam_date,p_age,p_right_sph,p_right_cyl,p_right_axis,
     p_right_add,p_left_sph,p_left_cyl,p_left_axis,p_left_add,p_pd_mm,p_previous_prescription,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),v_request_id)
  on conflict (tenant_id,branch_id,request_id) do nothing
  returning id into v_exam_id;

  if v_exam_id is null then
    select id into v_exam_id from public.optical_eye_exams
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and request_id=v_request_id and customer_id=v_customer_id;
    if v_exam_id is null then
      raise exception 'optical_exam_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object('customer_id',v_customer_id,'exam_id',v_exam_id,'request_id',v_request_id);
end;
$function$;

commit;

       or abs((p_product->>'lens_sph')::numeric)>30))
    or
    (nullif(p_product->>'lens_cyl','') is not null and
      (p_product->>'lens_cyl' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?
       or abs((p_product->>'lens_cyl')::numeric)>15))
   ) then raise exception 'OPTICAL_INVALID_PRESCRIPTION'; end if;
 v_category=case v_kind when 'frame' then 'กรอบแว่น'
  when 'lens' then 'เลนส์' else 'อุปกรณ์เสริม' end;
 v_fields=jsonb_build_object(
  'business_mode','optical_retail','optical_kind',v_kind,
  'optical_brand',left(coalesce(p_product->>'brand',''),120),
  'optical_model',left(coalesce(p_product->>'model',''),120),
  'optical_color',left(coalesce(p_product->>'color',''),80),
  'optical_frame_size',left(coalesce(p_product->>'frame_size',''),60),
  'optical_lens_name',left(coalesce(p_product->>'lens_name',''),120),
  'optical_lens_index',left(coalesce(p_product->>'lens_index',''),40),
  'optical_lens_sph',nullif(p_product->>'lens_sph',''),
  'optical_lens_cyl',nullif(p_product->>'lens_cyl',''),
  'currency_code',p_currency,'stock_verification','pending'
 );
 insert into public.products
 (tenant_id,branch_id,sku,name,category,price,sell_unit,stock_deduction_mode,is_combo,is_active,metadata)
 values (p_tenant_id,p_branch_id,v_sku,v_name,v_category,v_price,'ชิ้น','unit_only',false,true,v_fields)
 returning id into v_id;
 return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.optical_save_customer_exam(p_tenant_id uuid, p_branch_id uuid, p_customer_code text, p_full_name text, p_phone text DEFAULT NULL::text, p_age smallint DEFAULT NULL::smallint, p_exam_date date DEFAULT NULL::date, p_previous_prescription text DEFAULT NULL::text, p_pd_mm numeric DEFAULT NULL::numeric, p_examiner_name text DEFAULT NULL::text, p_right_sph numeric DEFAULT NULL::numeric, p_right_cyl numeric DEFAULT NULL::numeric, p_right_axis smallint DEFAULT NULL::smallint, p_right_add numeric DEFAULT NULL::numeric, p_left_sph numeric DEFAULT NULL::numeric, p_left_cyl numeric DEFAULT NULL::numeric, p_left_axis smallint DEFAULT NULL::smallint, p_left_add numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_customer_id uuid; v_exam_id uuid; v_request_id uuid;
begin
  if auth.uid() is not null
    and not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_customers') then
    raise exception 'OPTICAL_CRM_CUSTOMERS_IT_DISABLED' using errcode='42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id) then
    raise exception 'optical_customer_forbidden' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null
     or length(trim(coalesce(p_customer_code,''))) not between 1 and 48
     or length(trim(coalesce(p_full_name,''))) not between 1 and 240 then
    raise exception 'invalid_optical_customer' using errcode='22023';
  end if;
  if p_age is not null and p_age not between 0 and 130 then
    raise exception 'invalid_customer_age' using errcode='22023';
  end if;
  if p_pd_mm is not null and p_pd_mm not between 30 and 90 then
    raise exception 'invalid_pd_mm' using errcode='22023';
  end if;
  if p_exam_date is null then
    raise exception 'exam_date_required' using errcode='22023';
  end if;
  v_request_id := coalesce(p_request_id, gen_random_uuid());
  insert into public.optical_customers
    (tenant_id,branch_id,customer_code,full_name,phone,age,
     previous_prescription,last_exam_date,examiner_name,notes,created_by,updated_by)
  values
    (p_tenant_id,p_branch_id,trim(p_customer_code),trim(p_full_name),
     nullif(trim(coalesce(p_phone,'')),''),p_age,p_previous_prescription,
     p_exam_date,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),coalesce(auth.uid(),p_actor))
  on conflict (tenant_id,branch_id,customer_code) do update set
    full_name=excluded.full_name,phone=excluded.phone,age=excluded.age,
    previous_prescription=excluded.previous_prescription,
    last_exam_date=excluded.last_exam_date,examiner_name=excluded.examiner_name,
    notes=excluded.notes,updated_at=now(),updated_by=coalesce(auth.uid(),p_actor),deleted_at=null
  returning id into v_customer_id;

  insert into public.optical_eye_exams
    (tenant_id,branch_id,customer_id,examined_at,age_at_exam,right_sph,right_cyl,right_axis,
     right_add,left_sph,left_cyl,left_axis,left_add,pd_mm,previous_prescription,examiner_name,notes,created_by,request_id)
  values
    (p_tenant_id,p_branch_id,v_customer_id,p_exam_date,p_age,p_right_sph,p_right_cyl,p_right_axis,
     p_right_add,p_left_sph,p_left_cyl,p_left_axis,p_left_add,p_pd_mm,p_previous_prescription,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),v_request_id)
  on conflict (tenant_id,branch_id,request_id) do nothing
  returning id into v_exam_id;

  if v_exam_id is null then
    select id into v_exam_id from public.optical_eye_exams
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and request_id=v_request_id and customer_id=v_customer_id;
    if v_exam_id is null then
      raise exception 'optical_exam_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object('customer_id',v_customer_id,'exam_id',v_exam_id,'request_id',v_request_id);
end;
$function$;

commit;

 then raise exception 'OPTICAL_INVALID_PRICE'; end if;
 v_price=(p_product->>'price')::numeric;
 if v_price>999999999 or (p_currency='LAK' and v_price<>trunc(v_price))
 then raise exception 'OPTICAL_INVALID_PRICE'; end if;
 if p_currency not in ('THB','LAK','USD') then raise exception 'OPTICAL_INVALID_CURRENCY'; end if;
 if exists(select 1 from public.products
   where tenant_id=p_tenant_id and branch_id=p_branch_id
     and lower(sku)=lower(v_sku))
 then raise exception 'OPTICAL_SKU_DUPLICATE'; end if;
 if v_kind='lens' and (
    (nullif(p_product->>'lens_sph','') is not null and
      (p_product->>'lens_sph' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?
       or abs((p_product->>'lens_sph')::numeric)>30))
    or
    (nullif(p_product->>'lens_cyl','') is not null and
      (p_product->>'lens_cyl' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?
       or abs((p_product->>'lens_cyl')::numeric)>15))
   ) then raise exception 'OPTICAL_INVALID_PRESCRIPTION'; end if;
 v_category=case v_kind when 'frame' then 'กรอบแว่น'
  when 'lens' then 'เลนส์' else 'อุปกรณ์เสริม' end;
 v_fields=jsonb_build_object(
  'business_mode','optical_retail','optical_kind',v_kind,
  'optical_brand',left(coalesce(p_product->>'brand',''),120),
  'optical_model',left(coalesce(p_product->>'model',''),120),
  'optical_color',left(coalesce(p_product->>'color',''),80),
  'optical_frame_size',left(coalesce(p_product->>'frame_size',''),60),
  'optical_lens_name',left(coalesce(p_product->>'lens_name',''),120),
  'optical_lens_index',left(coalesce(p_product->>'lens_index',''),40),
  'optical_lens_sph',nullif(p_product->>'lens_sph',''),
  'optical_lens_cyl',nullif(p_product->>'lens_cyl',''),
  'currency_code',p_currency,'stock_verification','pending'
 );
 insert into public.products
 (tenant_id,branch_id,sku,name,category,price,sell_unit,stock_deduction_mode,is_combo,is_active,metadata)
 values (p_tenant_id,p_branch_id,v_sku,v_name,v_category,v_price,'ชิ้น','unit_only',false,true,v_fields)
 returning id into v_id;
 return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.optical_save_customer_exam(p_tenant_id uuid, p_branch_id uuid, p_customer_code text, p_full_name text, p_phone text DEFAULT NULL::text, p_age smallint DEFAULT NULL::smallint, p_exam_date date DEFAULT NULL::date, p_previous_prescription text DEFAULT NULL::text, p_pd_mm numeric DEFAULT NULL::numeric, p_examiner_name text DEFAULT NULL::text, p_right_sph numeric DEFAULT NULL::numeric, p_right_cyl numeric DEFAULT NULL::numeric, p_right_axis smallint DEFAULT NULL::smallint, p_right_add numeric DEFAULT NULL::numeric, p_left_sph numeric DEFAULT NULL::numeric, p_left_cyl numeric DEFAULT NULL::numeric, p_left_axis smallint DEFAULT NULL::smallint, p_left_add numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_customer_id uuid; v_exam_id uuid; v_request_id uuid;
begin
  if auth.uid() is not null
    and not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_customers') then
    raise exception 'OPTICAL_CRM_CUSTOMERS_IT_DISABLED' using errcode='42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id) then
    raise exception 'optical_customer_forbidden' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null
     or length(trim(coalesce(p_customer_code,''))) not between 1 and 48
     or length(trim(coalesce(p_full_name,''))) not between 1 and 240 then
    raise exception 'invalid_optical_customer' using errcode='22023';
  end if;
  if p_age is not null and p_age not between 0 and 130 then
    raise exception 'invalid_customer_age' using errcode='22023';
  end if;
  if p_pd_mm is not null and p_pd_mm not between 30 and 90 then
    raise exception 'invalid_pd_mm' using errcode='22023';
  end if;
  if p_exam_date is null then
    raise exception 'exam_date_required' using errcode='22023';
  end if;
  v_request_id := coalesce(p_request_id, gen_random_uuid());
  insert into public.optical_customers
    (tenant_id,branch_id,customer_code,full_name,phone,age,
     previous_prescription,last_exam_date,examiner_name,notes,created_by,updated_by)
  values
    (p_tenant_id,p_branch_id,trim(p_customer_code),trim(p_full_name),
     nullif(trim(coalesce(p_phone,'')),''),p_age,p_previous_prescription,
     p_exam_date,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),coalesce(auth.uid(),p_actor))
  on conflict (tenant_id,branch_id,customer_code) do update set
    full_name=excluded.full_name,phone=excluded.phone,age=excluded.age,
    previous_prescription=excluded.previous_prescription,
    last_exam_date=excluded.last_exam_date,examiner_name=excluded.examiner_name,
    notes=excluded.notes,updated_at=now(),updated_by=coalesce(auth.uid(),p_actor),deleted_at=null
  returning id into v_customer_id;

  insert into public.optical_eye_exams
    (tenant_id,branch_id,customer_id,examined_at,age_at_exam,right_sph,right_cyl,right_axis,
     right_add,left_sph,left_cyl,left_axis,left_add,pd_mm,previous_prescription,examiner_name,notes,created_by,request_id)
  values
    (p_tenant_id,p_branch_id,v_customer_id,p_exam_date,p_age,p_right_sph,p_right_cyl,p_right_axis,
     p_right_add,p_left_sph,p_left_cyl,p_left_axis,p_left_add,p_pd_mm,p_previous_prescription,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),v_request_id)
  on conflict (tenant_id,branch_id,request_id) do nothing
  returning id into v_exam_id;

  if v_exam_id is null then
    select id into v_exam_id from public.optical_eye_exams
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and request_id=v_request_id and customer_id=v_customer_id;
    if v_exam_id is null then
      raise exception 'optical_exam_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object('customer_id',v_customer_id,'exam_id',v_exam_id,'request_id',v_request_id);
end;
$function$;

commit;

       or abs((p_product->>'lens_cyl')::numeric)>15))
   ) then raise exception 'OPTICAL_INVALID_PRESCRIPTION'; end if;
 v_category=case v_kind when 'frame' then 'กรอบแว่น'
  when 'lens' then 'เลนส์' else 'อุปกรณ์เสริม' end;
 v_fields=jsonb_build_object(
  'business_mode','optical_retail','optical_kind',v_kind,
  'optical_brand',left(coalesce(p_product->>'brand',''),120),
  'optical_model',left(coalesce(p_product->>'model',''),120),
  'optical_color',left(coalesce(p_product->>'color',''),80),
  'optical_frame_size',left(coalesce(p_product->>'frame_size',''),60),
  'optical_lens_name',left(coalesce(p_product->>'lens_name',''),120),
  'optical_lens_index',left(coalesce(p_product->>'lens_index',''),40),
  'optical_lens_sph',nullif(p_product->>'lens_sph',''),
  'optical_lens_cyl',nullif(p_product->>'lens_cyl',''),
  'currency_code',p_currency,'stock_verification','pending'
 );
 insert into public.products
 (tenant_id,branch_id,sku,name,category,price,sell_unit,stock_deduction_mode,is_combo,is_active,metadata)
 values (p_tenant_id,p_branch_id,v_sku,v_name,v_category,v_price,'ชิ้น','unit_only',false,true,v_fields)
 returning id into v_id;
 return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.optical_save_customer_exam(p_tenant_id uuid, p_branch_id uuid, p_customer_code text, p_full_name text, p_phone text DEFAULT NULL::text, p_age smallint DEFAULT NULL::smallint, p_exam_date date DEFAULT NULL::date, p_previous_prescription text DEFAULT NULL::text, p_pd_mm numeric DEFAULT NULL::numeric, p_examiner_name text DEFAULT NULL::text, p_right_sph numeric DEFAULT NULL::numeric, p_right_cyl numeric DEFAULT NULL::numeric, p_right_axis smallint DEFAULT NULL::smallint, p_right_add numeric DEFAULT NULL::numeric, p_left_sph numeric DEFAULT NULL::numeric, p_left_cyl numeric DEFAULT NULL::numeric, p_left_axis smallint DEFAULT NULL::smallint, p_left_add numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_customer_id uuid; v_exam_id uuid; v_request_id uuid;
begin
  if auth.uid() is not null
    and not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_customers') then
    raise exception 'OPTICAL_CRM_CUSTOMERS_IT_DISABLED' using errcode='42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id) then
    raise exception 'optical_customer_forbidden' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null
     or length(trim(coalesce(p_customer_code,''))) not between 1 and 48
     or length(trim(coalesce(p_full_name,''))) not between 1 and 240 then
    raise exception 'invalid_optical_customer' using errcode='22023';
  end if;
  if p_age is not null and p_age not between 0 and 130 then
    raise exception 'invalid_customer_age' using errcode='22023';
  end if;
  if p_pd_mm is not null and p_pd_mm not between 30 and 90 then
    raise exception 'invalid_pd_mm' using errcode='22023';
  end if;
  if p_exam_date is null then
    raise exception 'exam_date_required' using errcode='22023';
  end if;
  v_request_id := coalesce(p_request_id, gen_random_uuid());
  insert into public.optical_customers
    (tenant_id,branch_id,customer_code,full_name,phone,age,
     previous_prescription,last_exam_date,examiner_name,notes,created_by,updated_by)
  values
    (p_tenant_id,p_branch_id,trim(p_customer_code),trim(p_full_name),
     nullif(trim(coalesce(p_phone,'')),''),p_age,p_previous_prescription,
     p_exam_date,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),coalesce(auth.uid(),p_actor))
  on conflict (tenant_id,branch_id,customer_code) do update set
    full_name=excluded.full_name,phone=excluded.phone,age=excluded.age,
    previous_prescription=excluded.previous_prescription,
    last_exam_date=excluded.last_exam_date,examiner_name=excluded.examiner_name,
    notes=excluded.notes,updated_at=now(),updated_by=coalesce(auth.uid(),p_actor),deleted_at=null
  returning id into v_customer_id;

  insert into public.optical_eye_exams
    (tenant_id,branch_id,customer_id,examined_at,age_at_exam,right_sph,right_cyl,right_axis,
     right_add,left_sph,left_cyl,left_axis,left_add,pd_mm,previous_prescription,examiner_name,notes,created_by,request_id)
  values
    (p_tenant_id,p_branch_id,v_customer_id,p_exam_date,p_age,p_right_sph,p_right_cyl,p_right_axis,
     p_right_add,p_left_sph,p_left_cyl,p_left_axis,p_left_add,p_pd_mm,p_previous_prescription,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),v_request_id)
  on conflict (tenant_id,branch_id,request_id) do nothing
  returning id into v_exam_id;

  if v_exam_id is null then
    select id into v_exam_id from public.optical_eye_exams
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and request_id=v_request_id and customer_id=v_customer_id;
    if v_exam_id is null then
      raise exception 'optical_exam_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object('customer_id',v_customer_id,'exam_id',v_exam_id,'request_id',v_request_id);
end;
$function$;

commit;

 then raise exception 'OPTICAL_INVALID_PRICE'; end if;
 v_price=(p_product->>'price')::numeric;
 if v_price>999999999 or (p_currency='LAK' and v_price<>trunc(v_price))
 then raise exception 'OPTICAL_INVALID_PRICE'; end if;
 if p_currency not in ('THB','LAK','USD') then raise exception 'OPTICAL_INVALID_CURRENCY'; end if;
 if exists(select 1 from public.products
   where tenant_id=p_tenant_id and branch_id=p_branch_id
     and lower(sku)=lower(v_sku))
 then raise exception 'OPTICAL_SKU_DUPLICATE'; end if;
 if v_kind='lens' and (
    (nullif(p_product->>'lens_sph','') is not null and
      (p_product->>'lens_sph' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?
       or abs((p_product->>'lens_sph')::numeric)>30))
    or
    (nullif(p_product->>'lens_cyl','') is not null and
      (p_product->>'lens_cyl' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?
       or abs((p_product->>'lens_cyl')::numeric)>15))
   ) then raise exception 'OPTICAL_INVALID_PRESCRIPTION'; end if;
 v_category=case v_kind when 'frame' then 'กรอบแว่น'
  when 'lens' then 'เลนส์' else 'อุปกรณ์เสริม' end;
 v_fields=jsonb_build_object(
  'business_mode','optical_retail','optical_kind',v_kind,
  'optical_brand',left(coalesce(p_product->>'brand',''),120),
  'optical_model',left(coalesce(p_product->>'model',''),120),
  'optical_color',left(coalesce(p_product->>'color',''),80),
  'optical_frame_size',left(coalesce(p_product->>'frame_size',''),60),
  'optical_lens_name',left(coalesce(p_product->>'lens_name',''),120),
  'optical_lens_index',left(coalesce(p_product->>'lens_index',''),40),
  'optical_lens_sph',nullif(p_product->>'lens_sph',''),
  'optical_lens_cyl',nullif(p_product->>'lens_cyl',''),
  'currency_code',p_currency,'stock_verification','pending'
 );
 insert into public.products
 (tenant_id,branch_id,sku,name,category,price,sell_unit,stock_deduction_mode,is_combo,is_active,metadata)
 values (p_tenant_id,p_branch_id,v_sku,v_name,v_category,v_price,'ชิ้น','unit_only',false,true,v_fields)
 returning id into v_id;
 return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.optical_save_customer_exam(p_tenant_id uuid, p_branch_id uuid, p_customer_code text, p_full_name text, p_phone text DEFAULT NULL::text, p_age smallint DEFAULT NULL::smallint, p_exam_date date DEFAULT NULL::date, p_previous_prescription text DEFAULT NULL::text, p_pd_mm numeric DEFAULT NULL::numeric, p_examiner_name text DEFAULT NULL::text, p_right_sph numeric DEFAULT NULL::numeric, p_right_cyl numeric DEFAULT NULL::numeric, p_right_axis smallint DEFAULT NULL::smallint, p_right_add numeric DEFAULT NULL::numeric, p_left_sph numeric DEFAULT NULL::numeric, p_left_cyl numeric DEFAULT NULL::numeric, p_left_axis smallint DEFAULT NULL::smallint, p_left_add numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_customer_id uuid; v_exam_id uuid; v_request_id uuid;
begin
  if auth.uid() is not null
    and not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_customers') then
    raise exception 'OPTICAL_CRM_CUSTOMERS_IT_DISABLED' using errcode='42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id) then
    raise exception 'optical_customer_forbidden' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null
     or length(trim(coalesce(p_customer_code,''))) not between 1 and 48
     or length(trim(coalesce(p_full_name,''))) not between 1 and 240 then
    raise exception 'invalid_optical_customer' using errcode='22023';
  end if;
  if p_age is not null and p_age not between 0 and 130 then
    raise exception 'invalid_customer_age' using errcode='22023';
  end if;
  if p_pd_mm is not null and p_pd_mm not between 30 and 90 then
    raise exception 'invalid_pd_mm' using errcode='22023';
  end if;
  if p_exam_date is null then
    raise exception 'exam_date_required' using errcode='22023';
  end if;
  v_request_id := coalesce(p_request_id, gen_random_uuid());
  insert into public.optical_customers
    (tenant_id,branch_id,customer_code,full_name,phone,age,
     previous_prescription,last_exam_date,examiner_name,notes,created_by,updated_by)
  values
    (p_tenant_id,p_branch_id,trim(p_customer_code),trim(p_full_name),
     nullif(trim(coalesce(p_phone,'')),''),p_age,p_previous_prescription,
     p_exam_date,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),coalesce(auth.uid(),p_actor))
  on conflict (tenant_id,branch_id,customer_code) do update set
    full_name=excluded.full_name,phone=excluded.phone,age=excluded.age,
    previous_prescription=excluded.previous_prescription,
    last_exam_date=excluded.last_exam_date,examiner_name=excluded.examiner_name,
    notes=excluded.notes,updated_at=now(),updated_by=coalesce(auth.uid(),p_actor),deleted_at=null
  returning id into v_customer_id;

  insert into public.optical_eye_exams
    (tenant_id,branch_id,customer_id,examined_at,age_at_exam,right_sph,right_cyl,right_axis,
     right_add,left_sph,left_cyl,left_axis,left_add,pd_mm,previous_prescription,examiner_name,notes,created_by,request_id)
  values
    (p_tenant_id,p_branch_id,v_customer_id,p_exam_date,p_age,p_right_sph,p_right_cyl,p_right_axis,
     p_right_add,p_left_sph,p_left_cyl,p_left_axis,p_left_add,p_pd_mm,p_previous_prescription,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),v_request_id)
  on conflict (tenant_id,branch_id,request_id) do nothing
  returning id into v_exam_id;

  if v_exam_id is null then
    select id into v_exam_id from public.optical_eye_exams
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and request_id=v_request_id and customer_id=v_customer_id;
    if v_exam_id is null then
      raise exception 'optical_exam_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object('customer_id',v_customer_id,'exam_id',v_exam_id,'request_id',v_request_id);
end;
$function$;

commit;

       or abs((p_product->>'lens_sph')::numeric)>30))
    or
    (nullif(p_product->>'lens_cyl','') is not null and
      (p_product->>'lens_cyl' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?
       or abs((p_product->>'lens_cyl')::numeric)>15))
   ) then raise exception 'OPTICAL_INVALID_PRESCRIPTION'; end if;
 v_category=case v_kind when 'frame' then 'กรอบแว่น'
  when 'lens' then 'เลนส์' else 'อุปกรณ์เสริม' end;
 v_fields=jsonb_build_object(
  'business_mode','optical_retail','optical_kind',v_kind,
  'optical_brand',left(coalesce(p_product->>'brand',''),120),
  'optical_model',left(coalesce(p_product->>'model',''),120),
  'optical_color',left(coalesce(p_product->>'color',''),80),
  'optical_frame_size',left(coalesce(p_product->>'frame_size',''),60),
  'optical_lens_name',left(coalesce(p_product->>'lens_name',''),120),
  'optical_lens_index',left(coalesce(p_product->>'lens_index',''),40),
  'optical_lens_sph',nullif(p_product->>'lens_sph',''),
  'optical_lens_cyl',nullif(p_product->>'lens_cyl',''),
  'currency_code',p_currency,'stock_verification','pending'
 );
 insert into public.products
 (tenant_id,branch_id,sku,name,category,price,sell_unit,stock_deduction_mode,is_combo,is_active,metadata)
 values (p_tenant_id,p_branch_id,v_sku,v_name,v_category,v_price,'ชิ้น','unit_only',false,true,v_fields)
 returning id into v_id;
 return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.optical_save_customer_exam(p_tenant_id uuid, p_branch_id uuid, p_customer_code text, p_full_name text, p_phone text DEFAULT NULL::text, p_age smallint DEFAULT NULL::smallint, p_exam_date date DEFAULT NULL::date, p_previous_prescription text DEFAULT NULL::text, p_pd_mm numeric DEFAULT NULL::numeric, p_examiner_name text DEFAULT NULL::text, p_right_sph numeric DEFAULT NULL::numeric, p_right_cyl numeric DEFAULT NULL::numeric, p_right_axis smallint DEFAULT NULL::smallint, p_right_add numeric DEFAULT NULL::numeric, p_left_sph numeric DEFAULT NULL::numeric, p_left_cyl numeric DEFAULT NULL::numeric, p_left_axis smallint DEFAULT NULL::smallint, p_left_add numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_customer_id uuid; v_exam_id uuid; v_request_id uuid;
begin
  if auth.uid() is not null
    and not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_customers') then
    raise exception 'OPTICAL_CRM_CUSTOMERS_IT_DISABLED' using errcode='42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id) then
    raise exception 'optical_customer_forbidden' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null
     or length(trim(coalesce(p_customer_code,''))) not between 1 and 48
     or length(trim(coalesce(p_full_name,''))) not between 1 and 240 then
    raise exception 'invalid_optical_customer' using errcode='22023';
  end if;
  if p_age is not null and p_age not between 0 and 130 then
    raise exception 'invalid_customer_age' using errcode='22023';
  end if;
  if p_pd_mm is not null and p_pd_mm not between 30 and 90 then
    raise exception 'invalid_pd_mm' using errcode='22023';
  end if;
  if p_exam_date is null then
    raise exception 'exam_date_required' using errcode='22023';
  end if;
  v_request_id := coalesce(p_request_id, gen_random_uuid());
  insert into public.optical_customers
    (tenant_id,branch_id,customer_code,full_name,phone,age,
     previous_prescription,last_exam_date,examiner_name,notes,created_by,updated_by)
  values
    (p_tenant_id,p_branch_id,trim(p_customer_code),trim(p_full_name),
     nullif(trim(coalesce(p_phone,'')),''),p_age,p_previous_prescription,
     p_exam_date,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),coalesce(auth.uid(),p_actor))
  on conflict (tenant_id,branch_id,customer_code) do update set
    full_name=excluded.full_name,phone=excluded.phone,age=excluded.age,
    previous_prescription=excluded.previous_prescription,
    last_exam_date=excluded.last_exam_date,examiner_name=excluded.examiner_name,
    notes=excluded.notes,updated_at=now(),updated_by=coalesce(auth.uid(),p_actor),deleted_at=null
  returning id into v_customer_id;

  insert into public.optical_eye_exams
    (tenant_id,branch_id,customer_id,examined_at,age_at_exam,right_sph,right_cyl,right_axis,
     right_add,left_sph,left_cyl,left_axis,left_add,pd_mm,previous_prescription,examiner_name,notes,created_by,request_id)
  values
    (p_tenant_id,p_branch_id,v_customer_id,p_exam_date,p_age,p_right_sph,p_right_cyl,p_right_axis,
     p_right_add,p_left_sph,p_left_cyl,p_left_axis,p_left_add,p_pd_mm,p_previous_prescription,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),v_request_id)
  on conflict (tenant_id,branch_id,request_id) do nothing
  returning id into v_exam_id;

  if v_exam_id is null then
    select id into v_exam_id from public.optical_eye_exams
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and request_id=v_request_id and customer_id=v_customer_id;
    if v_exam_id is null then
      raise exception 'optical_exam_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object('customer_id',v_customer_id,'exam_id',v_exam_id,'request_id',v_request_id);
end;
$function$;

commit;

 then raise exception 'OPTICAL_INVALID_PRICE'; end if;
 v_price=(p_product->>'price')::numeric;
 if v_price>999999999 or (p_currency='LAK' and v_price<>trunc(v_price))
 then raise exception 'OPTICAL_INVALID_PRICE'; end if;
 if p_currency not in ('THB','LAK','USD') then raise exception 'OPTICAL_INVALID_CURRENCY'; end if;
 if exists(select 1 from public.products
   where tenant_id=p_tenant_id and branch_id=p_branch_id
     and lower(sku)=lower(v_sku))
 then raise exception 'OPTICAL_SKU_DUPLICATE'; end if;
 if v_kind='lens' and (
    (nullif(p_product->>'lens_sph','') is not null and
      (p_product->>'lens_sph' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?
       or abs((p_product->>'lens_sph')::numeric)>30))
    or
    (nullif(p_product->>'lens_cyl','') is not null and
      (p_product->>'lens_cyl' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?
       or abs((p_product->>'lens_cyl')::numeric)>15))
   ) then raise exception 'OPTICAL_INVALID_PRESCRIPTION'; end if;
 v_category=case v_kind when 'frame' then 'กรอบแว่น'
  when 'lens' then 'เลนส์' else 'อุปกรณ์เสริม' end;
 v_fields=jsonb_build_object(
  'business_mode','optical_retail','optical_kind',v_kind,
  'optical_brand',left(coalesce(p_product->>'brand',''),120),
  'optical_model',left(coalesce(p_product->>'model',''),120),
  'optical_color',left(coalesce(p_product->>'color',''),80),
  'optical_frame_size',left(coalesce(p_product->>'frame_size',''),60),
  'optical_lens_name',left(coalesce(p_product->>'lens_name',''),120),
  'optical_lens_index',left(coalesce(p_product->>'lens_index',''),40),
  'optical_lens_sph',nullif(p_product->>'lens_sph',''),
  'optical_lens_cyl',nullif(p_product->>'lens_cyl',''),
  'currency_code',p_currency,'stock_verification','pending'
 );
 insert into public.products
 (tenant_id,branch_id,sku,name,category,price,sell_unit,stock_deduction_mode,is_combo,is_active,metadata)
 values (p_tenant_id,p_branch_id,v_sku,v_name,v_category,v_price,'ชิ้น','unit_only',false,true,v_fields)
 returning id into v_id;
 return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.optical_save_customer_exam(p_tenant_id uuid, p_branch_id uuid, p_customer_code text, p_full_name text, p_phone text DEFAULT NULL::text, p_age smallint DEFAULT NULL::smallint, p_exam_date date DEFAULT NULL::date, p_previous_prescription text DEFAULT NULL::text, p_pd_mm numeric DEFAULT NULL::numeric, p_examiner_name text DEFAULT NULL::text, p_right_sph numeric DEFAULT NULL::numeric, p_right_cyl numeric DEFAULT NULL::numeric, p_right_axis smallint DEFAULT NULL::smallint, p_right_add numeric DEFAULT NULL::numeric, p_left_sph numeric DEFAULT NULL::numeric, p_left_cyl numeric DEFAULT NULL::numeric, p_left_axis smallint DEFAULT NULL::smallint, p_left_add numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_customer_id uuid; v_exam_id uuid; v_request_id uuid;
begin
  if auth.uid() is not null
    and not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_customers') then
    raise exception 'OPTICAL_CRM_CUSTOMERS_IT_DISABLED' using errcode='42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id) then
    raise exception 'optical_customer_forbidden' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null
     or length(trim(coalesce(p_customer_code,''))) not between 1 and 48
     or length(trim(coalesce(p_full_name,''))) not between 1 and 240 then
    raise exception 'invalid_optical_customer' using errcode='22023';
  end if;
  if p_age is not null and p_age not between 0 and 130 then
    raise exception 'invalid_customer_age' using errcode='22023';
  end if;
  if p_pd_mm is not null and p_pd_mm not between 30 and 90 then
    raise exception 'invalid_pd_mm' using errcode='22023';
  end if;
  if p_exam_date is null then
    raise exception 'exam_date_required' using errcode='22023';
  end if;
  v_request_id := coalesce(p_request_id, gen_random_uuid());
  insert into public.optical_customers
    (tenant_id,branch_id,customer_code,full_name,phone,age,
     previous_prescription,last_exam_date,examiner_name,notes,created_by,updated_by)
  values
    (p_tenant_id,p_branch_id,trim(p_customer_code),trim(p_full_name),
     nullif(trim(coalesce(p_phone,'')),''),p_age,p_previous_prescription,
     p_exam_date,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),coalesce(auth.uid(),p_actor))
  on conflict (tenant_id,branch_id,customer_code) do update set
    full_name=excluded.full_name,phone=excluded.phone,age=excluded.age,
    previous_prescription=excluded.previous_prescription,
    last_exam_date=excluded.last_exam_date,examiner_name=excluded.examiner_name,
    notes=excluded.notes,updated_at=now(),updated_by=coalesce(auth.uid(),p_actor),deleted_at=null
  returning id into v_customer_id;

  insert into public.optical_eye_exams
    (tenant_id,branch_id,customer_id,examined_at,age_at_exam,right_sph,right_cyl,right_axis,
     right_add,left_sph,left_cyl,left_axis,left_add,pd_mm,previous_prescription,examiner_name,notes,created_by,request_id)
  values
    (p_tenant_id,p_branch_id,v_customer_id,p_exam_date,p_age,p_right_sph,p_right_cyl,p_right_axis,
     p_right_add,p_left_sph,p_left_cyl,p_left_axis,p_left_add,p_pd_mm,p_previous_prescription,p_examiner_name,p_notes,coalesce(auth.uid(),p_actor),v_request_id)
  on conflict (tenant_id,branch_id,request_id) do nothing
  returning id into v_exam_id;

  if v_exam_id is null then
    select id into v_exam_id from public.optical_eye_exams
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and request_id=v_request_id and customer_id=v_customer_id;
    if v_exam_id is null then
      raise exception 'optical_exam_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object('customer_id',v_customer_id,'exam_id',v_exam_id,'request_id',v_request_id);
end;
$function$;

commit;
