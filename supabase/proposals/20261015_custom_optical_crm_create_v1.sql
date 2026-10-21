-- Proposal: shared CRM Optical catalog creation (POS catalog CRUD remains canonical).
-- Apply after explicit release review, not in a preview.
create or replace function public.customer_portal_optical_product_create_v1(
 p_tenant_id uuid,p_branch_id uuid,p_product jsonb,p_currency text)
returns uuid language plpgsql security definer
set search_path=pg_catalog,public,auth
as $$
declare v_kind text;v_category text;v_name text;v_sku text;v_price numeric;
 v_id uuid;v_enabled boolean;v_fields jsonb;
begin
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
 if coalesce(p_product->>'price','') !~ '^[0-9]+([.][0-9]{1,2})?$'
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
      (p_product->>'lens_sph' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?$'
       or abs((p_product->>'lens_sph')::numeric)>30))
    or
    (nullif(p_product->>'lens_cyl','') is not null and
      (p_product->>'lens_cyl' !~ '^-?[0-9]{1,2}([.][0-9]{1,2})?$'
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
end $$;
revoke all on function public.customer_portal_optical_product_create_v1(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.customer_portal_optical_product_create_v1(uuid,uuid,jsonb,text) to authenticated;
