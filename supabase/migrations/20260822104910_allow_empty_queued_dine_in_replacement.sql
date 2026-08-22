-- Allow a cashier to clear the final item from an existing queued dine-in bill.
-- Safety: exact queued dine-in order + exact open table bill only; no empty order creation.
create or replace function app.replace_queued_dine_in_order_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid,
  p_actor_user_id uuid,
  p_order_id uuid,
  p_table_id uuid,
  p_items jsonb,
  p_app_total_amount numeric,
  p_discount_amount numeric default 0,
  p_gp_amount numeric default 0,
  p_tax_total numeric default 0,
  p_grand_total numeric default null,
  p_tax_lines jsonb default '[]'::jsonb
)
returns table(order_id uuid, order_no text, order_status text, created_at timestamptz, total_amount numeric)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_session public.table_bill_sessions%rowtype;
  v_order public.orders%rowtype;
  v_subtotal numeric(12,2) := round(coalesce(p_app_total_amount, 0), 2);
  v_total numeric(12,2) := round(coalesce(p_grand_total, p_app_total_amount - coalesce(p_discount_amount,0) - coalesce(p_gp_amount,0) + coalesce(p_tax_total,0)), 2);
  v_item_count numeric := 0;
  v_add_item_ids uuid[] := array[]::uuid[];
  v_cancel_item_ids uuid[] := array[]::uuid[];
  v_event_hash text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'ITEMS_REQUIRED'; end if;

  select * into v_session
  from public.table_bill_sessions s
  where s.tenant_id=p_tenant_id and s.branch_id=p_branch_id and s.table_id=p_table_id
    and s.status in ('open','ordering') and s.closed_at is null
  order by s.opened_at desc limit 1 for update;
  if not found then raise exception 'TABLE_BILL_NOT_OPEN'; end if;
  if v_session.order_id is not null and v_session.order_id<>p_order_id then raise exception 'TABLE_BILL_ORDER_CONFLICT'; end if;

  select * into v_order from public.orders o
  where o.tenant_id=p_tenant_id and o.branch_id=p_branch_id and o.id=p_order_id and o.table_id=p_table_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status<>'queued' then raise exception 'ORDER_NOT_QUEUED'; end if;
  if v_order.order_type<>'dine_in' then raise exception 'ORDER_NOT_DINE_IN'; end if;

  if not exists(select 1 from public.shifts sh where sh.id=p_shift_id and sh.tenant_id=p_tenant_id and sh.branch_id=p_branch_id and sh.status='open') then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  create temporary table if not exists pg_temp.dine_in_target_items(
    product_id uuid not null, notes text, quantity numeric(12,3) not null,
    unit_price numeric(12,2) not null, line_total numeric(12,2) not null,
    product_name text, product_active boolean not null, order_item_id uuid,
    existing_quantity numeric(12,3), delta numeric(12,3)
  ) on commit drop;
  truncate table pg_temp.dine_in_target_items;

  insert into pg_temp.dine_in_target_items(product_id,notes,quantity,unit_price,line_total,product_name,product_active)
  with normalized_items as(
    select nullif(value->>'product_id','')::uuid product_id,
           nullif(left(trim(coalesce(value->>'notes',value->>'note','')),240),'') notes,
           sum(nullif(value->>'quantity','')::numeric) quantity,
           max(nullif(value->>'unit_price','')::numeric) unit_price
    from jsonb_array_elements(p_items)value group by 1,2
  )
  select p.id,ni.notes,ni.quantity,coalesce(ni.unit_price,p.price),
         round(ni.quantity*coalesce(ni.unit_price,p.price),2),p.name,p.is_active
  from normalized_items ni
  join public.products p on p.id=ni.product_id and p.tenant_id=p_tenant_id and p.branch_id=p_branch_id
  where ni.product_id is not null and ni.quantity>0 and ni.quantity<=999;

  select coalesce(sum(quantity),0) into v_item_count from pg_temp.dine_in_target_items;
  if jsonb_array_length(p_items) > 0 and v_item_count < 1 then raise exception 'ITEMS_REQUIRED'; end if;

  update pg_temp.dine_in_target_items ti
  set order_item_id=oi.id, existing_quantity=oi.quantity, delta=ti.quantity-oi.quantity
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id
    and oi.product_id=ti.product_id and coalesce(oi.notes,'')=coalesce(ti.notes,'')
    and oi.quantity>0 and coalesce(oi.metadata->>'bill_line_state','active')<>'cancelled';

  if exists(select 1 from pg_temp.dine_in_target_items ti where ti.product_active=false and ti.order_item_id is null) then
    raise exception 'PRODUCT_NOT_AVAILABLE';
  end if;

  update pg_temp.dine_in_target_items ti
  set order_item_id=oi.id, existing_quantity=oi.quantity, delta=ti.quantity-oi.quantity
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id
    and oi.product_id=ti.product_id and coalesce(oi.notes,'')=coalesce(ti.notes,'')
    and oi.quantity>0 and coalesce(oi.metadata->>'bill_line_state','active')<>'cancelled';

  update public.order_items oi
  set quantity=ti.quantity, unit_price=ti.unit_price, line_total=ti.line_total, notes=ti.notes,
      name=coalesce(ti.product_name,oi.name),
      metadata=(coalesce(oi.metadata,'{}'::jsonb)-'bill_line_state'-'kitchen_delta_quantity'-'kitchen_delta_kind')||jsonb_build_object('pos_edit_updated_at',now())
  from pg_temp.dine_in_target_items ti
  where ti.order_item_id=oi.id and oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id;

  with inserted as(
    insert into public.order_items(tenant_id,branch_id,order_id,product_id,quantity,unit_price,line_total,notes,name,metadata)
    select p_tenant_id,p_branch_id,p_order_id,ti.product_id,ti.quantity,ti.unit_price,ti.line_total,ti.notes,ti.product_name,jsonb_build_object('source','pos_dine_in_edit')
    from pg_temp.dine_in_target_items ti where ti.order_item_id is null
    returning id,product_id,notes
  )
  update pg_temp.dine_in_target_items ti
  set order_item_id=i.id, existing_quantity=0, delta=ti.quantity
  from inserted i
  where ti.order_item_id is null and ti.product_id=i.product_id and coalesce(ti.notes,'')=coalesce(i.notes,'');

  if exists(select 1 from pg_temp.dine_in_target_items where order_item_id is null) then raise exception 'DINE_IN_TARGET_ITEM_BIND_FAILED'; end if;

  update public.order_items oi
  set metadata=coalesce(oi.metadata,'{}'::jsonb)||jsonb_build_object('kitchen_delta_quantity',ti.delta,'kitchen_delta_kind','add')
  from pg_temp.dine_in_target_items ti
  where ti.order_item_id=oi.id and ti.delta>0 and oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id;

  select coalesce(array_agg(order_item_id order by order_item_id),array[]::uuid[]) into v_add_item_ids
  from pg_temp.dine_in_target_items where order_item_id is not null and delta>0;
  if coalesce(array_length(v_add_item_ids,1),0)>0 then
    select md5(string_agg(id::text||':'||(metadata->>'kitchen_delta_quantity'),',' order by id)) into v_event_hash
    from public.order_items where id=any(v_add_item_ids);
    perform * from app.enqueue_kitchen_order(p_tenant_id,p_branch_id,p_order_id,'order:'||p_order_id::text||':pos-edit:add:'||v_event_hash,'add',v_add_item_ids);
    update public.order_items set metadata=metadata-'kitchen_delta_quantity'-'kitchen_delta_kind' where id=any(v_add_item_ids);
  end if;

  update public.order_items oi
  set quantity=0,line_total=0,
      metadata=coalesce(oi.metadata,'{}'::jsonb)||jsonb_build_object('bill_line_state','cancelled','cancelled_quantity',oi.quantity,'kitchen_delta_quantity',oi.quantity,'kitchen_delta_kind','cancel','pos_edit_cancelled_at',now())
  where oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id
    and oi.quantity>0 and coalesce(oi.metadata->>'bill_line_state','active')<>'cancelled'
    and not exists(select 1 from pg_temp.dine_in_target_items ti where ti.order_item_id=oi.id);

  update public.order_items oi
  set metadata=coalesce(oi.metadata,'{}'::jsonb)||jsonb_build_object('kitchen_delta_quantity',abs(ti.delta),'kitchen_delta_kind','cancel')
  from pg_temp.dine_in_target_items ti
  where ti.order_item_id=oi.id and ti.delta<0 and oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id;

  select coalesce(array_agg(oi.id order by oi.id),array[]::uuid[]) into v_cancel_item_ids
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id
    and oi.metadata->>'kitchen_delta_kind'='cancel' and coalesce((oi.metadata->>'kitchen_delta_quantity')::numeric,0)>0;
  if coalesce(array_length(v_cancel_item_ids,1),0)>0 then
    select md5(string_agg(id::text||':'||(metadata->>'kitchen_delta_quantity'),',' order by id)) into v_event_hash
    from public.order_items where id=any(v_cancel_item_ids);
    perform * from app.enqueue_kitchen_order(p_tenant_id,p_branch_id,p_order_id,'order:'||p_order_id::text||':pos-edit:cancel:'||v_event_hash,'cancel',v_cancel_item_ids);
    update public.order_items set metadata=metadata-'kitchen_delta_quantity'-'kitchen_delta_kind' where id=any(v_cancel_item_ids);
  end if;

  update public.orders o
  set shift_id=p_shift_id, subtotal=v_subtotal, discount_amount=coalesce(p_discount_amount,0), gp_amount=coalesce(p_gp_amount,0),
      total_amount=v_total, tax_total=coalesce(p_tax_total,0), grand_total=v_total,
      metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('tax_lines',coalesce(p_tax_lines,'[]'::jsonb),'updated_from','pos_dine_in_rpc'), updated_at=now()
  where o.id=p_order_id and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id and o.status='queued'
  returning * into v_order;
  if not found then raise exception 'ORDER_NOT_QUEUED'; end if;

  update public.table_bill_sessions s
  set order_id=p_order_id,status='ordering',metadata=coalesce(s.metadata,'{}'::jsonb)||jsonb_build_object('last_order_id',p_order_id,'last_order_no',v_order.order_no),updated_at=now()
  where s.id=v_session.id;

  return query select v_order.id,v_order.order_no,v_order.status::text,v_order.created_at,v_order.total_amount;
end;
$$;

revoke all on function app.replace_queued_dine_in_order_tx(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,numeric,numeric,numeric,numeric,jsonb) from public, anon, authenticated;
grant execute on function app.replace_queued_dine_in_order_tx(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,numeric,numeric,numeric,numeric,jsonb) to service_role;
