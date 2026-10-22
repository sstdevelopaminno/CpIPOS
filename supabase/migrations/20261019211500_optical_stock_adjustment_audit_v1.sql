-- CUSTOM Optical: auditable manual receipt / stock issue.
-- This migration is intentionally staged. Do not apply to production until dev
-- cutover, POS ordinary-sale guards, and POS/CRM end-to-end QA have passed.
create table if not exists public.optical_stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  stock_bin_id uuid not null,
  request_id uuid not null,
  payload_hash text not null,
  actor_user_id uuid not null references public.users_profiles(id),
  source text not null check (source in ('pos','crm')),
  quantity_delta integer not null check(quantity_delta <> 0 and abs(quantity_delta) <= 100000),
  before_quantity integer not null check(before_quantity >= 0),
  after_quantity integer not null check(after_quantity >= 0),
  reserved_quantity integer not null check(reserved_quantity >= 0),
  sale_unit_price_lak numeric not null check(sale_unit_price_lak >= 0 and sale_unit_price_lak = trunc(sale_unit_price_lak)),
  note text not null check(char_length(note) between 3 and 300),
  created_at timestamptz not null default now(),
  constraint optical_stock_adjustments_request_unique unique(tenant_id, branch_id, request_id),
  constraint optical_stock_adjustments_scope_bin_fk
    foreign key(stock_bin_id,tenant_id,branch_id)
    references public.optical_stock_bins(id,tenant_id,branch_id)
);
create index if not exists optical_stock_adjustments_product_history
  on public.optical_stock_adjustments(tenant_id,branch_id,product_id,created_at desc);
alter table public.optical_stock_adjustments enable row level security;
revoke all on public.optical_stock_adjustments from public, anon, authenticated;

create or replace function public.optical_adjust_stock_tx(
 p_tenant_id uuid, p_branch_id uuid, p_actor uuid, p_sku text,
 p_quantity_delta integer, p_note text, p_request_id uuid, p_source text
) returns table(adjustment_id uuid, product_id uuid, before_quantity integer,
  after_quantity integer, available_quantity integer, duplicate_request boolean)
language plpgsql security definer
set search_path to pg_catalog, public, auth
as $function$
declare
 v_user_role text;
 v_product public.products%rowtype;
 v_bin public.optical_stock_bins%rowtype;
 v_kind text;
 v_unit text;
 v_note text;
 v_hash text;
 v_old public.optical_stock_adjustments%rowtype;
 v_id uuid;
 v_price numeric;
 v_before integer;
 v_new integer;
 v_currency text;
begin
 if p_tenant_id is null or p_branch_id is null or p_actor is null or
   p_request_id is null or p_sku is null or p_quantity_delta is null or p_note is null or
   p_quantity_delta = 0 or abs(p_quantity_delta) > 100000 or
   p_source not in ('pos','crm') then raise exception 'OPTICAL_STOCK_REQUEST_INVALID'; end if;
 -- Authenticated CRM callers cannot impersonate other people; POS uses its
 -- validated HTTP-only POS session and a server-side service-role client.
 if current_setting('request.jwt.claim.role', true) <> 'service_role' and
    auth.uid() is distinct from p_actor then
   raise exception 'OPTICAL_STOCK_ACTOR_MISMATCH'; end if;
 if p_source = 'crm' and auth.uid() is distinct from p_actor then
   raise exception 'OPTICAL_STOCK_CRM_ACTOR_MISMATCH'; end if;
 v_note := btrim(p_note);
 if char_length(v_note) < 3 or char_length(v_note) > 300 then
   raise exception 'OPTICAL_STOCK_REASON_REQUIRED'; end if;
 if char_length(btrim(p_sku)) < 1 or char_length(btrim(p_sku)) > 90 then
   raise exception 'OPTICAL_STOCK_BARCODE_INVALID'; end if;
 select r.role::text into v_user_role
 from public.user_branch_roles r join public.users_profiles u on u.id=r.user_id
 join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id
 where r.user_id=p_actor and r.tenant_id=p_tenant_id and
 r.branch_id=p_branch_id and r.role::text in ('owner','manager')
 and u.is_active = true and u.archived_at is null and b.is_active=true
 limit 1;
 if v_user_role is null then raise exception 'OPTICAL_STOCK_SCOPE_FORBIDDEN'; end if;
 if (select count(*) from public.tenant_subscription_contracts c
   where c.tenant_id=p_tenant_id and c.status in ('active','trial')
     and (c.ended_at is null or c.ended_at>now())) <> 1 then
   raise exception 'OPTICAL_STOCK_CONTRACT_AMBIGUOUS'; end if;
 if not exists (
   select 1 from public.tenant_subscription_contracts c
   join public.subscription_packages p on p.id=c.package_id
   where c.tenant_id=p_tenant_id and c.status in('active','trial')
     and (c.ended_at is null or c.ended_at>now())
     and lower(p.code)='custom'
     and c.metadata->'sales_modes'->>'optical_retail'='true'
 ) then raise exception 'OPTICAL_STOCK_MODE_FORBIDDEN'; end if;
 -- Explicit IT menu switch required, but other CUSTOM modes cannot inherit it.
 if not exists(select 1 from public.tenant_pos_menu_policies pm
   where pm.tenant_id=p_tenant_id and pm.menu_key='more.stock' and pm.is_enabled=true)
 then raise exception 'OPTICAL_STOCK_IT_DISABLED'; end if;
 if exists(select 1 from public.tenant_feature_subscriptions fs
   where fs.tenant_id=p_tenant_id and fs.feature_code='stock_management'
     and (fs.branch_id is null or fs.branch_id=p_branch_id)
     and fs.is_enabled=false)
 then raise exception 'OPTICAL_STOCK_FEATURE_DENIED'; end if;
 -- Lock SKU with tenant+branch. Case-insensitive duplicates are forbidden.
 perform pg_advisory_xact_lock(hashtextextended(
   p_tenant_id::text||':'||p_branch_id::text||':optical-sku:'||lower(btrim(p_sku)),0));
 if (select count(*) from public.products p where p.tenant_id=p_tenant_id
   and p.branch_id=p_branch_id and lower(p.sku)=lower(btrim(p_sku))
   and p.is_active and p.deleted_at is null) <> 1
 then raise exception 'OPTICAL_STOCK_SKU_UNKNOWN_OR_AMBIGUOUS'; end if;
 select * into v_product from public.products p
 where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id
 and lower(p.sku)=lower(btrim(p_sku))
 and p.is_active and p.deleted_at is null for update;
 if not found or v_product.stock_deduction_mode <> 'unit_only' or
   not (v_product.metadata->>'business_mode'='optical_retail' or
     v_product.metadata->>'optical_kind' in ('frame','lens','accessory'))
 then raise exception 'OPTICAL_STOCK_NOT_UNIT_CATALOG'; end if;
 if exists(select 1 from public.recipes r where r.tenant_id=p_tenant_id
   and r.branch_id=p_branch_id and r.product_id=v_product.id) then
   raise exception 'OPTICAL_LEGACY_RECIPE_REQUIRES_CUTOVER'; end if;
 v_kind:=coalesce(v_product.metadata->>'optical_kind','');
 if v_kind not in ('frame','lens','accessory') then
   raise exception 'OPTICAL_STOCK_KIND_REQUIRED'; end if;
 v_currency:=coalesce(v_product.metadata->>'currency_code','');
 if v_currency <> 'LAK' then raise exception 'OPTICAL_STOCK_LAK_ONLY'; end if;
 v_price:=v_product.price;
 if v_price < 0 or v_price <> trunc(v_price) then raise exception 'OPTICAL_STOCK_PRICE_INVALID'; end if;
 v_hash:=md5(jsonb_build_object('product_id',v_product.id,'quantity_delta',p_quantity_delta,
    'note',v_note,'source',p_source)::text);
 perform pg_advisory_xact_lock(hashtextextended(
   p_tenant_id::text||':'||p_branch_id::text||':optical-request:'||p_request_id::text,0));
 select * into v_old from public.optical_stock_adjustments a
 where a.tenant_id=p_tenant_id and a.branch_id=p_branch_id and
   a.request_id=p_request_id;
 if found then
   if v_old.payload_hash<>v_hash or v_old.actor_user_id<>p_actor then
     raise exception 'OPTICAL_STOCK_IDEMPOTENCY_CONFLICT'; end if;
   return query select v_old.id,v_old.product_id,v_old.before_quantity,
     v_old.after_quantity,v_old.after_quantity-v_old.reserved_quantity,true; return;
 end if;
 select * into v_bin from public.optical_stock_bins b where
   b.tenant_id=p_tenant_id and b.branch_id=p_branch_id and b.product_id=v_product.id
   for update;
 if not found then
   if p_quantity_delta<0 then raise exception 'OPTICAL_STOCK_NOT_RECEIVED'; end if;
   -- Do not backfill a fake zero record for products with historical completed sales.
   if exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id
      where oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id
        and oi.product_id=v_product.id and o.status='completed' limit 1)
   then raise exception 'OPTICAL_STOCK_HISTORICAL_SALES_NEED_RECONCILIATION'; end if;
   v_unit:=case when lower(coalesce(v_product.sell_unit,'')) in ('คู่','pair') then 'pair'
     when lower(coalesce(v_product.sell_unit,'')) in ('ชุด','set') then 'set' else 'piece' end;
   insert into public.optical_stock_bins(tenant_id,branch_id,product_id,kind,
    brand,model,color,frame_size,lens_type,lens_index,lens_sph,lens_cyl,
    unit,unit_price,currency_code,on_hand,reserved)
   values(p_tenant_id,p_branch_id,v_product.id,v_kind,
    left(coalesce(v_product.metadata->>'optical_brand',''),120),
    left(coalesce(case when v_kind='lens' then v_product.metadata->>'optical_lens_name'
      else v_product.metadata->>'optical_model' end,''),120),
    left(coalesce(v_product.metadata->>'optical_color',''),80),
    left(coalesce(v_product.metadata->>'optical_frame_size',''),60),
    case when v_kind='lens' then coalesce(v_product.metadata->>'optical_lens_name','') else null end,
    nullif(v_product.metadata->>'optical_lens_index',''),
    nullif(v_product.metadata->>'optical_lens_sph','')::numeric,
    nullif(v_product.metadata->>'optical_lens_cyl','')::numeric,
    v_unit,v_price,'LAK',0,0)
   returning * into v_bin;
 end if;
 if v_bin.currency_code<>'LAK' or v_bin.unit_price<>v_price
    or v_bin.kind<>v_kind then
   raise exception 'OPTICAL_STOCK_BIN_PRICE_OR_MODE_DRIFT'; end if;
 v_before:=v_bin.on_hand;
 v_new:=v_before+p_quantity_delta;
 if v_new<0 or v_new<v_bin.reserved then
   raise exception 'OPTICAL_STOCK_INSUFFICIENT_UNRESERVED'; end if;
 update public.optical_stock_bins b set on_hand=v_new,updated_at=now()
   where b.id=v_bin.id and b.tenant_id=p_tenant_id and b.branch_id=p_branch_id;
 insert into public.optical_stock_adjustments(tenant_id,branch_id,product_id,
   stock_bin_id,request_id,payload_hash,actor_user_id,source,quantity_delta,
   before_quantity,after_quantity,reserved_quantity,sale_unit_price_lak,note)
 values(p_tenant_id,p_branch_id,v_product.id,v_bin.id,p_request_id,v_hash,p_actor,
   p_source,p_quantity_delta,v_before,v_new,v_bin.reserved,v_price,v_note)
 returning id into v_id;
 insert into public.audit_logs(tenant_id,branch_id,actor_user_id,actor_role,
   action,target_table,target_id,metadata)
 values(p_tenant_id,p_branch_id,p_actor,v_user_role,
   'optical_stock_manual_adjustment','optical_stock_adjustments',v_id,
   jsonb_build_object('product_id',v_product.id,'sku',v_product.sku,
    'delta',p_quantity_delta,'before',v_before,'after',v_new,
    'reserved',v_bin.reserved,'request_id',p_request_id,'source',p_source));
 return query select v_id,v_product.id,v_before,v_new,v_new-v_bin.reserved,false;
end;
$function$;
revoke all on function public.optical_adjust_stock_tx(uuid,uuid,uuid,text,integer,text,uuid,text) from public,anon;
grant execute on function public.optical_adjust_stock_tx(uuid,uuid,uuid,text,integer,text,uuid,text) to authenticated,service_role;
