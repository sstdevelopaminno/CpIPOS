-- CpiPOS-002 Trial Data Plane transaction RPCs v1
-- Applied to Supabase project kawenyvpentwgugtzqec.
-- IMPORTANT: service-role only. Do not expose these RPCs to anon/authenticated.

drop index if exists public.idx_payments_tenant_branch_order_request_group;
create index idx_payments_tenant_branch_order_request_group on public.payments (tenant_id, branch_id, order_id, request_group_id) where request_group_id is not null;

create or replace function app.require_trial_runtime(p_tenant_id uuid,p_branch_id uuid,p_shift_id uuid,p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare v_session_id uuid;
begin
  if not exists (select 1 from public.trial_tenant_scopes t where t.tenant_id=p_tenant_id and t.is_active=true and t.lifecycle_status in ('trial','active','grace')) then
    raise exception 'TRIAL_TENANT_SCOPE_INACTIVE';
  end if;
  if not exists (select 1 from public.trial_branch_scopes b where b.tenant_id=p_tenant_id and b.branch_id=p_branch_id and b.is_active=true) then
    raise exception 'TRIAL_BRANCH_SCOPE_INACTIVE';
  end if;
  select l.pos_session_id into v_session_id
  from public.trial_runtime_leases l
  where l.tenant_id=p_tenant_id and l.branch_id=p_branch_id and l.shift_id=p_shift_id and l.user_id=p_user_id
    and l.status='active' and l.expires_at>now()
  order by l.synced_at desc limit 1;
  if v_session_id is null then raise exception 'TRIAL_RUNTIME_LEASE_INVALID'; end if;
  return v_session_id;
end;
$$;

create or replace function public.next_pos_order_no(p_tenant_id uuid,p_branch_id uuid,p_prefix text default 'TKO')
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_prefix text := upper(regexp_replace(coalesce(nullif(trim(p_prefix),''),'TKO'),'[^A-Z0-9]','','g'));
  v_date text := to_char(timezone('Asia/Bangkok',now()),'YYMMDD');
  v_base text;
  v_next integer := 1;
begin
  if not exists (select 1 from public.trial_branch_scopes b where b.tenant_id=p_tenant_id and b.branch_id=p_branch_id and b.is_active=true) then
    raise exception 'TRIAL_BRANCH_SCOPE_INACTIVE';
  end if;
  v_base:=v_prefix||'-'||v_date||'-';
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text||':'||p_branch_id::text||':'||v_base));
  select coalesce(max(substring(o.order_no from length(v_base)+1)::integer),0)+1 into v_next
  from public.orders o
  where o.tenant_id=p_tenant_id and o.branch_id=p_branch_id and o.order_no like v_base||'%'
    and substring(o.order_no from length(v_base)+1) ~ '^[0-9]+$';
  return v_base||lpad(v_next::text,3,'0');
end;
$$;

create or replace function app.create_pos_order_tx(
  p_tenant_id uuid,p_branch_id uuid,p_shift_id uuid,p_created_by uuid,p_order_type public.order_type,p_channel text,
  p_table_id uuid,p_external_order_code text,p_customer_name text,p_notes text,p_app_total_amount numeric,p_discount_amount numeric,p_gp_amount numeric,
  p_delivery_pricing_channel text default null,p_delivery_app_subtotal numeric default null,p_delivery_commission_rate_pct numeric default null,
  p_delivery_commission_amount numeric default null,p_delivery_commission_vat_rate_pct numeric default null,p_delivery_commission_vat_amount numeric default null,
  p_delivery_platform_fee_amount numeric default null,p_delivery_net_payout_amount numeric default null,p_delivery_pricing_source_url text default null,
  p_delivery_pricing_note text default null,p_items jsonb default '[]'::jsonb,p_request_id text default null,p_order_no text default null
)
returns table(order_id uuid,order_no text,order_status text,created_at timestamptz,duplicate_request boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_existing record; v_order_id uuid; v_order_no text; v_subtotal numeric(12,2):=0;
  v_discount numeric(12,2):=round(greatest(coalesce(p_discount_amount,0),0),2);
  v_gp numeric(12,2):=round(greatest(coalesce(p_gp_amount,0),0),2); v_total numeric(12,2):=0;
  v_item jsonb; v_product_id uuid; v_qty numeric(12,3); v_catalog_price numeric(12,2); v_unit_price numeric(12,2); v_line_total numeric(12,2);
  v_session_id uuid; v_device_code text; v_allow_negative boolean:=false; v_req record;
begin
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'ORDER_ITEMS_REQUIRED'; end if;
  if p_order_type not in ('dine_in','takeaway','delivery_manual') then raise exception 'INVALID_ORDER_TYPE'; end if;
  v_session_id:=app.require_trial_runtime(p_tenant_id,p_branch_id,p_shift_id,p_created_by);
  select l.device_code into v_device_code from public.trial_runtime_leases l where l.pos_session_id=v_session_id;

  if nullif(trim(p_request_id),'') is not null then
    select o.id,o.order_no,o.status,o.created_at into v_existing from public.orders o
    where o.tenant_id=p_tenant_id and o.branch_id=p_branch_id and o.request_id=trim(p_request_id) limit 1;
    if found then return query select v_existing.id,v_existing.order_no,v_existing.status::text,v_existing.created_at,true; return; end if;
  end if;

  if p_table_id is not null and not exists (select 1 from public.dining_tables d where d.id=p_table_id and d.tenant_id=p_tenant_id and d.branch_id=p_branch_id and d.is_active=true) then
    raise exception 'TABLE_NOT_FOUND';
  end if;
  select coalesce(s.allow_negative_stock,false) into v_allow_negative from public.branch_inventory_settings s where s.tenant_id=p_tenant_id and s.branch_id=p_branch_id;
  v_order_id:=gen_random_uuid();
  v_order_no:=coalesce(nullif(trim(p_order_no),''),public.next_pos_order_no(p_tenant_id,p_branch_id,case p_order_type when 'dine_in' then 'DIN' when 'takeaway' then 'TKO' else 'DLV' end));

  insert into public.orders(
    id,tenant_id,branch_id,shift_id,order_no,order_type,channel,delivery_status,table_id,external_order_code,customer_name,notes,
    subtotal,discount_amount,gp_amount,total_amount,status,created_by,request_id,device_code,cashier_user_id,pos_session_id,
    delivery_pricing_channel,delivery_app_subtotal,delivery_commission_rate_pct,delivery_commission_amount,delivery_commission_vat_rate_pct,
    delivery_commission_vat_amount,delivery_platform_fee_amount,delivery_net_payout_amount,delivery_pricing_source_url,delivery_pricing_note,grand_total
  ) values (
    v_order_id,p_tenant_id,p_branch_id,p_shift_id,v_order_no,p_order_type,p_channel,
    case when p_order_type='delivery_manual' then 'pending'::public.delivery_status else null end,p_table_id,p_external_order_code,p_customer_name,p_notes,
    0,v_discount,v_gp,0,'queued',p_created_by,nullif(trim(p_request_id),''),v_device_code,p_created_by,v_session_id,
    p_delivery_pricing_channel,p_delivery_app_subtotal,p_delivery_commission_rate_pct,p_delivery_commission_amount,p_delivery_commission_vat_rate_pct,
    p_delivery_commission_vat_amount,p_delivery_platform_fee_amount,p_delivery_net_payout_amount,p_delivery_pricing_source_url,p_delivery_pricing_note,0
  );

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin v_product_id:=nullif(v_item->>'product_id','')::uuid; v_qty:=nullif(v_item->>'quantity','')::numeric;
    exception when others then raise exception 'INVALID_PRODUCT_ID'; end;
    if v_product_id is null then raise exception 'INVALID_PRODUCT_ID'; end if;
    if v_qty is null or v_qty<=0 then raise exception 'INVALID_ITEM_QTY'; end if;
    select p.price into v_catalog_price from public.products p where p.id=v_product_id and p.tenant_id=p_tenant_id and p.branch_id=p_branch_id and p.is_active=true;
    if not found then raise exception 'PRODUCT_NOT_FOUND:%',v_product_id; end if;
    if nullif(v_item->>'unit_price','') is not null then
      v_unit_price:=round((v_item->>'unit_price')::numeric,2); if v_unit_price<0 then raise exception 'INVALID_ITEM_UNIT_PRICE'; end if;
    else v_unit_price:=round(v_catalog_price,2); end if;
    v_line_total:=round(v_unit_price*v_qty,2); v_subtotal:=v_subtotal+v_line_total;
    insert into public.order_items(tenant_id,branch_id,order_id,product_id,quantity,unit_price,line_total,notes)
    values(p_tenant_id,p_branch_id,v_order_id,v_product_id,v_qty,v_unit_price,v_line_total,nullif(v_item->>'notes',''));
  end loop;

  v_subtotal:=round(v_subtotal,2); v_total:=round(v_subtotal-v_discount-v_gp,2);
  if v_total<0 then raise exception 'NEGATIVE_ORDER_TOTAL'; end if;

  for v_req in
    select r.ingredient_id,sum(round((oi.quantity*r.quantity_per_item)::numeric,0))::numeric as required_qty
    from public.order_items oi join public.recipes r on r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.product_id=oi.product_id
    where oi.order_id=v_order_id and oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id
      and (r.applies_when_takeaway_only=false or (r.applies_when_takeaway_only=true and p_order_type in ('takeaway','delivery_manual')))
    group by r.ingredient_id
  loop
    if v_req.required_qty>0 then
      update public.ingredients i set quantity_on_hand=round(i.quantity_on_hand-v_req.required_qty,0)
      where i.id=v_req.ingredient_id and i.tenant_id=p_tenant_id and i.branch_id=p_branch_id and (v_allow_negative or i.quantity_on_hand>=v_req.required_qty);
      if not found then
        if exists(select 1 from public.ingredients i where i.id=v_req.ingredient_id and i.tenant_id=p_tenant_id and i.branch_id=p_branch_id) then raise exception 'INSUFFICIENT_STOCK:%',v_req.ingredient_id; end if;
        raise exception 'INGREDIENT_NOT_FOUND:%',v_req.ingredient_id;
      end if;
      insert into public.stock_movements(tenant_id,branch_id,ingredient_id,movement_type,quantity_delta,reason,ref_table,ref_id,created_by)
      values(p_tenant_id,p_branch_id,v_req.ingredient_id,'sale_deduction',-v_req.required_qty,'Auto deduction from POS sale','orders',v_order_id,p_created_by);
    end if;
  end loop;
  update public.orders set subtotal=v_subtotal,total_amount=v_total,grand_total=v_total where id=v_order_id;
  return query select v_order_id,v_order_no,'queued'::text,now(),false;
exception when unique_violation then
  if nullif(trim(p_request_id),'') is not null then
    select o.id,o.order_no,o.status,o.created_at into v_existing from public.orders o where o.tenant_id=p_tenant_id and o.branch_id=p_branch_id and o.request_id=trim(p_request_id) limit 1;
    if found then return query select v_existing.id,v_existing.order_no,v_existing.status::text,v_existing.created_at,true; return; end if;
  end if;
  raise;
end;
$$;

create or replace function public.create_pos_order_tx(
  p_tenant_id uuid,p_branch_id uuid,p_shift_id uuid,p_created_by uuid,p_order_type public.order_type,p_channel text,p_table_id uuid,
  p_external_order_code text,p_customer_name text,p_notes text,p_app_total_amount numeric,p_discount_amount numeric,p_gp_amount numeric,
  p_delivery_pricing_channel text default null,p_delivery_app_subtotal numeric default null,p_delivery_commission_rate_pct numeric default null,
  p_delivery_commission_amount numeric default null,p_delivery_commission_vat_rate_pct numeric default null,p_delivery_commission_vat_amount numeric default null,
  p_delivery_platform_fee_amount numeric default null,p_delivery_net_payout_amount numeric default null,p_delivery_pricing_source_url text default null,
  p_delivery_pricing_note text default null,p_items jsonb default '[]'::jsonb,p_request_id text default null,p_order_no text default null
)
returns table(order_id uuid,order_no text,order_status text,created_at timestamptz,duplicate_request boolean)
language sql security definer set search_path = pg_catalog, public, app, extensions
as $$
select * from app.create_pos_order_tx(p_tenant_id,p_branch_id,p_shift_id,p_created_by,p_order_type,p_channel,p_table_id,p_external_order_code,p_customer_name,p_notes,
  p_app_total_amount,p_discount_amount,p_gp_amount,p_delivery_pricing_channel,p_delivery_app_subtotal,p_delivery_commission_rate_pct,p_delivery_commission_amount,
  p_delivery_commission_vat_rate_pct,p_delivery_commission_vat_amount,p_delivery_platform_fee_amount,p_delivery_net_payout_amount,p_delivery_pricing_source_url,
  p_delivery_pricing_note,p_items,p_request_id,p_order_no);
$$;

create or replace function app.complete_pos_payment_tx(p_tenant_id uuid,p_branch_id uuid,p_order_id uuid,p_received_by uuid,p_payment_lines jsonb,p_request_group_id text default null)
returns table(payment_group_id text,total_paid numeric,order_status text,duplicate_request boolean)
language plpgsql security definer set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_total_due numeric(12,2); v_total_paid numeric(12,2):=0; v_shift_id uuid; v_session_id uuid;
  v_line jsonb; v_method public.payment_method; v_amount numeric(12,2); v_reference text;
begin
  if p_payment_lines is null or jsonb_typeof(p_payment_lines)<>'array' or jsonb_array_length(p_payment_lines)=0 then raise exception 'PAYMENT_LINES_REQUIRED'; end if;
  if nullif(trim(p_request_group_id),'') is not null then
    perform pg_advisory_xact_lock(hashtext(p_tenant_id::text||':'||p_branch_id::text||':'||p_order_id::text||':'||trim(p_request_group_id)));
    if exists(select 1 from public.payments p where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id and p.order_id=p_order_id and p.request_group_id=trim(p_request_group_id)) then
      select coalesce(sum(p.amount),0)::numeric(12,2) into v_total_paid from public.payments p
      where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id and p.order_id=p_order_id and p.request_group_id=trim(p_request_group_id);
      return query select trim(p_request_group_id),v_total_paid,'completed'::text,true; return;
    end if;
  end if;
  select o.total_amount,o.shift_id into v_total_due,v_shift_id from public.orders o where o.id=p_order_id and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  v_session_id:=app.require_trial_runtime(p_tenant_id,p_branch_id,v_shift_id,p_received_by);
  for v_line in select value from jsonb_array_elements(p_payment_lines) loop
    v_method:=(v_line->>'method')::public.payment_method; v_amount:=round(coalesce((v_line->>'amount')::numeric,0),2); v_reference:=nullif(v_line->>'reference_no','');
    if v_amount<=0 then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;
    v_total_paid:=v_total_paid+v_amount;
    insert into public.payments(tenant_id,branch_id,order_id,method,amount,reference_no,received_by,request_group_id,shift_id,pos_session_id,status)
    values(p_tenant_id,p_branch_id,p_order_id,v_method,v_amount,v_reference,p_received_by,nullif(trim(p_request_group_id),''),v_shift_id,v_session_id,'paid');
  end loop;
  v_total_paid:=round(v_total_paid,2); if abs(v_total_paid-v_total_due)>0.01 then raise exception 'PAYMENT_TOTAL_MISMATCH'; end if;
  update public.orders o set status='completed',paid_total=v_total_paid,payment_completed_at=now(),payment_completed_by=p_received_by
  where o.id=p_order_id and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id and o.status<>'cancelled';
  if not found then raise exception 'ORDER_CANCELLED_OR_NOT_FOUND'; end if;
  return query select coalesce(nullif(trim(p_request_group_id),''),''),v_total_paid,'completed'::text,false;
end;
$$;

create or replace function public.complete_pos_payment_tx(p_tenant_id uuid,p_branch_id uuid,p_order_id uuid,p_received_by uuid,p_payment_lines jsonb,p_request_group_id text default null)
returns table(payment_group_id text,total_paid numeric,order_status text,duplicate_request boolean)
language sql security definer set search_path = pg_catalog, public, app, extensions
as $$ select * from app.complete_pos_payment_tx(p_tenant_id,p_branch_id,p_order_id,p_received_by,p_payment_lines,p_request_group_id); $$;

create or replace function app.submit_table_qr_order_tx(p_qr_session_id uuid,p_request_id text,p_items jsonb,p_note text default null)
returns table(submission_id uuid,order_id uuid,order_no text,table_id uuid,table_session_id uuid,subtotal numeric,tax_total numeric,grand_total numeric,duplicate_request boolean)
language plpgsql security definer set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_qr public.table_qr_sessions%rowtype; v_bill public.table_bill_sessions%rowtype; v_runtime public.trial_runtime_leases%rowtype;
  v_order_id uuid; v_order_no text; v_submission_id uuid; v_item jsonb; v_product record; v_qty numeric(12,3); v_line_total numeric(12,2);
  v_new_subtotal numeric(12,2):=0; v_order_subtotal numeric(12,2):=0; v_discount numeric(12,2):=0; v_tax_total numeric(12,2):=0; v_grand_total numeric(12,2):=0;
  v_tax record; v_tax_line jsonb; v_tax_rate numeric(8,4); v_tax_amount numeric(12,2); v_tax_mode text; v_tax_lines jsonb:='[]'::jsonb;
  v_existing record; v_count integer; v_allow_negative boolean:=false; v_recipe record; v_use_qty numeric;
begin
  if nullif(trim(p_request_id),'') is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'ITEMS_REQUIRED'; end if;
  v_count:=jsonb_array_length(p_items); if v_count<1 or v_count>50 then raise exception 'INVALID_ITEM_COUNT'; end if;
  select * into v_qr from public.table_qr_sessions where id=p_qr_session_id for update;
  if not found then raise exception 'QR_SESSION_NOT_FOUND'; end if;
  if v_qr.status<>'active' or v_qr.expires_at<=now() then
    if v_qr.status='active' and v_qr.expires_at<=now() then update public.table_qr_sessions set status='expired' where id=v_qr.id; end if;
    raise exception 'QR_SESSION_EXPIRED';
  end if;
  select * into v_existing from public.table_qr_orders where qr_session_id=v_qr.id and request_id=trim(p_request_id) limit 1;
  if found then
    select o.order_no,o.subtotal,o.tax_total,o.grand_total into v_order_no,v_order_subtotal,v_tax_total,v_grand_total from public.orders o where o.id=v_existing.order_id;
    return query select v_existing.id,v_existing.order_id,v_order_no,v_existing.table_id,v_existing.table_session_id,v_order_subtotal,v_tax_total,v_grand_total,true; return;
  end if;
  select * into v_bill from public.table_bill_sessions b where b.id=v_qr.table_session_id and b.tenant_id=v_qr.tenant_id and b.branch_id=v_qr.branch_id and b.table_id=v_qr.table_id for update;
  if not found or v_bill.status not in ('open','ordering','pending_payment') or v_bill.closed_at is not null then raise exception 'TABLE_SESSION_CLOSED'; end if;
  if not exists(select 1 from public.dining_tables d where d.id=v_qr.table_id and d.tenant_id=v_qr.tenant_id and d.branch_id=v_qr.branch_id and d.is_active=true and d.status in ('occupied','ordering','pending_payment')) then raise exception 'TABLE_NOT_AVAILABLE'; end if;
  select * into v_runtime from public.trial_runtime_leases l where l.tenant_id=v_qr.tenant_id and l.branch_id=v_qr.branch_id and l.status='active' and l.expires_at>now() order by l.synced_at desc limit 1;
  if not found then raise exception 'SHIFT_NOT_OPEN'; end if;
  select coalesce(s.allow_negative_stock,false) into v_allow_negative from public.branch_inventory_settings s where s.tenant_id=v_qr.tenant_id and s.branch_id=v_qr.branch_id;

  v_order_id:=v_bill.order_id;
  if v_order_id is not null then
    select o.order_no,coalesce(o.discount_amount,0) into v_order_no,v_discount from public.orders o
    where o.id=v_order_id and o.tenant_id=v_qr.tenant_id and o.branch_id=v_qr.branch_id and o.table_id=v_qr.table_id and o.status='queued' for update;
    if not found then raise exception 'ORDER_NOT_UPDATABLE'; end if;
  else
    v_order_id:=gen_random_uuid(); v_order_no:=public.next_pos_order_no(v_qr.tenant_id,v_qr.branch_id,'DIN');
    insert into public.orders(id,tenant_id,branch_id,shift_id,order_no,order_type,channel,table_id,subtotal,discount_amount,gp_amount,total_amount,tax_total,grand_total,metadata,status,created_by,device_code,cashier_user_id,pos_session_id)
    values(v_order_id,v_qr.tenant_id,v_qr.branch_id,v_runtime.shift_id,v_order_no,'dine_in','table_qr',v_qr.table_id,0,0,0,0,0,0,jsonb_build_object('tax_lines','[]'::jsonb,'source','table_qr'),'queued',v_runtime.user_id,v_runtime.device_code,v_runtime.user_id,v_runtime.pos_session_id);
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty:=nullif(v_item->>'quantity','')::numeric; if v_qty is null or v_qty<=0 or v_qty>99 then raise exception 'INVALID_ITEM_QUANTITY'; end if;
    select p.id,p.name,p.price into v_product from public.products p where p.id=nullif(v_item->>'product_id','')::uuid and p.tenant_id=v_qr.tenant_id and p.branch_id=v_qr.branch_id and p.is_active=true;
    if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
    v_line_total:=round(v_product.price*v_qty,2); v_new_subtotal:=v_new_subtotal+v_line_total;
    insert into public.order_items(tenant_id,branch_id,order_id,product_id,quantity,unit_price,line_total,notes,name)
    values(v_qr.tenant_id,v_qr.branch_id,v_order_id,v_product.id,v_qty,v_product.price,v_line_total,nullif(left(trim(coalesce(v_item->>'note','')),240),''),v_product.name);
    for v_recipe in select r.ingredient_id,r.quantity_per_item from public.recipes r where r.tenant_id=v_qr.tenant_id and r.branch_id=v_qr.branch_id and r.product_id=v_product.id and r.applies_when_takeaway_only=false loop
      v_use_qty:=round(v_qty*v_recipe.quantity_per_item,0);
      if v_use_qty>0 then
        update public.ingredients i set quantity_on_hand=round(i.quantity_on_hand-v_use_qty,0)
        where i.id=v_recipe.ingredient_id and i.tenant_id=v_qr.tenant_id and i.branch_id=v_qr.branch_id and (v_allow_negative or i.quantity_on_hand>=v_use_qty);
        if not found then
          if exists(select 1 from public.ingredients i where i.id=v_recipe.ingredient_id and i.tenant_id=v_qr.tenant_id and i.branch_id=v_qr.branch_id) then raise exception 'INSUFFICIENT_STOCK:%',v_recipe.ingredient_id; end if;
          raise exception 'INGREDIENT_NOT_FOUND:%',v_recipe.ingredient_id;
        end if;
        insert into public.stock_movements(tenant_id,branch_id,ingredient_id,movement_type,quantity_delta,reason,ref_table,ref_id,created_by)
        values(v_qr.tenant_id,v_qr.branch_id,v_recipe.ingredient_id,'sale_deduction',-v_use_qty,'Auto deduction from table QR sale','orders',v_order_id,v_runtime.user_id);
      end if;
    end loop;
  end loop;

  select round(coalesce(sum(i.line_total),0),2) into v_order_subtotal from public.order_items i where i.tenant_id=v_qr.tenant_id and i.branch_id=v_qr.branch_id and i.order_id=v_order_id;
  select t.is_enabled,t.settings into v_tax from public.tenant_tax_settings t where t.tenant_id=v_qr.tenant_id and (t.branch_id=v_qr.branch_id or t.branch_id is null) order by (t.branch_id is not null) desc limit 1;
  if found and v_tax.is_enabled=true then
    for v_tax_line in select value from jsonb_array_elements(coalesce(v_tax.settings->'lines','[]'::jsonb)) loop
      if coalesce((v_tax_line->>'is_active')::boolean,true)=true then
        v_tax_rate:=greatest(coalesce(nullif(v_tax_line->>'rate_pct','')::numeric,0),0);
        if v_tax_rate>0 then
          v_tax_mode:=coalesce(v_tax_line->>'mode','add_to_bill'); v_tax_amount:=round(greatest(v_order_subtotal-v_discount,0)*(v_tax_rate/100),2);
          if v_tax_mode='deduct_from_bill' then v_tax_amount:=-v_tax_amount; end if;
          v_tax_total:=v_tax_total+v_tax_amount;
          v_tax_lines:=v_tax_lines||jsonb_build_array(jsonb_build_object('id',coalesce(v_tax_line->>'id',gen_random_uuid()::text),'label',coalesce(v_tax_line->>'label','Tax'),'rate_pct',v_tax_rate,'mode',v_tax_mode,'amount',v_tax_amount));
        end if;
      end if;
    end loop;
  end if;
  v_tax_total:=round(v_tax_total,2); v_grand_total:=round(greatest(v_order_subtotal-v_discount+v_tax_total,0),2);
  update public.orders set shift_id=v_runtime.shift_id,subtotal=v_order_subtotal,total_amount=v_grand_total,tax_total=v_tax_total,grand_total=v_grand_total,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('tax_lines',v_tax_lines,'last_table_qr_order_at',now()) where id=v_order_id and tenant_id=v_qr.tenant_id and branch_id=v_qr.branch_id;
  update public.table_bill_sessions set order_id=v_order_id,status='ordering',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('last_order_id',v_order_id,'last_order_no',v_order_no,'last_table_qr_order_at',now()) where id=v_bill.id;
  update public.dining_tables set status='ordering' where id=v_qr.table_id and tenant_id=v_qr.tenant_id and branch_id=v_qr.branch_id;
  v_submission_id:=gen_random_uuid();
  insert into public.table_qr_orders(id,tenant_id,branch_id,table_id,table_session_id,qr_session_id,order_id,request_id,item_count,subtotal,payload)
  values(v_submission_id,v_qr.tenant_id,v_qr.branch_id,v_qr.table_id,v_bill.id,v_qr.id,v_order_id,trim(p_request_id),v_count,v_new_subtotal,jsonb_build_object('items',p_items,'note',nullif(trim(coalesce(p_note,'')),'')));
  return query select v_submission_id,v_order_id,v_order_no,v_qr.table_id,v_bill.id,v_order_subtotal,v_tax_total,v_grand_total,false;
end;
$$;

create or replace function public.submit_table_qr_order_tx(p_qr_session_id uuid,p_request_id text,p_items jsonb,p_note text default null)
returns table(submission_id uuid,order_id uuid,order_no text,table_id uuid,table_session_id uuid,subtotal numeric,tax_total numeric,grand_total numeric,duplicate_request boolean)
language sql security definer set search_path = pg_catalog, public, app, extensions
as $$ select * from app.submit_table_qr_order_tx(p_qr_session_id,p_request_id,p_items,p_note); $$;

revoke execute on function app.require_trial_runtime(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke execute on function app.create_pos_order_tx(uuid,uuid,uuid,uuid,public.order_type,text,uuid,text,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb,text,text) from public,anon,authenticated;
revoke execute on function app.complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke execute on function app.submit_table_qr_order_tx(uuid,text,jsonb,text) from public,anon,authenticated;
revoke execute on function public.next_pos_order_no(uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.create_pos_order_tx(uuid,uuid,uuid,uuid,public.order_type,text,uuid,text,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb,text,text) from public,anon,authenticated;
revoke execute on function public.complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke execute on function public.submit_table_qr_order_tx(uuid,text,jsonb,text) from public,anon,authenticated;

grant execute on function app.require_trial_runtime(uuid,uuid,uuid,uuid) to service_role;
grant execute on function app.create_pos_order_tx(uuid,uuid,uuid,uuid,public.order_type,text,uuid,text,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb,text,text) to service_role;
grant execute on function app.complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text) to service_role;
grant execute on function app.submit_table_qr_order_tx(uuid,text,jsonb,text) to service_role;
grant execute on function public.next_pos_order_no(uuid,uuid,text) to service_role;
grant execute on function public.create_pos_order_tx(uuid,uuid,uuid,uuid,public.order_type,text,uuid,text,text,text,numeric,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb,text,text) to service_role;
grant execute on function public.complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text) to service_role;
grant execute on function public.submit_table_qr_order_tx(uuid,text,jsonb,text) to service_role;
