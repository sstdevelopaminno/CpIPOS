-- Source-only forward migration for table order concurrency and dine-in bill sync hardening.
-- Do not apply automatically from this task.

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



create or replace function app.lock_dine_in_order_table_session_before_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $
declare
  v_session public.table_bill_sessions%rowtype;
begin
  if new.order_type <> 'dine_in' or new.status <> 'queued' or new.table_id is null then
    return new;
  end if;

  select *
  into v_session
  from public.table_bill_sessions s
  where s.tenant_id = new.tenant_id
    and s.branch_id = new.branch_id
    and s.table_id = new.table_id
    and s.status in ('open', 'ordering')
    and s.closed_at is null
  order by s.opened_at desc
  limit 1
  for update;

  if not found then
    raise exception 'TABLE_BILL_NOT_OPEN';
  end if;
  if v_session.order_id is not null and v_session.order_id <> new.id then
    raise exception 'TABLE_BILL_ORDER_CONFLICT';
  end if;

  return new;
end;
$;

drop trigger if exists trg_lock_dine_in_order_table_session_before_insert on public.orders;
create trigger trg_lock_dine_in_order_table_session_before_insert
before insert on public.orders
for each row execute function app.lock_dine_in_order_table_session_before_insert();

revoke all on function app.lock_dine_in_order_table_session_before_insert() from public, anon, authenticated;
grant execute on function app.lock_dine_in_order_table_session_before_insert() to service_role;

create unique index if not exists ux_orders_one_queued_dine_in_table
  on public.orders (tenant_id, branch_id, table_id)
  where order_type = 'dine_in'
    and status = 'queued'
    and table_id is not null;

create or replace function app.bind_dine_in_order_to_table_session()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_session public.table_bill_sessions%rowtype;
begin
  if new.order_type <> 'dine_in' or new.table_id is null or new.status <> 'queued' then
    return new;
  end if;

  select *
  into v_session
  from public.table_bill_sessions s
  where s.tenant_id = new.tenant_id
    and s.branch_id = new.branch_id
    and s.table_id = new.table_id
    and s.status in ('open', 'ordering')
    and s.closed_at is null
  order by s.opened_at desc
  limit 1
  for update;

  if not found then
    raise exception 'TABLE_BILL_NOT_OPEN';
  end if;
  if v_session.order_id is not null and v_session.order_id <> new.id then
    raise exception 'TABLE_BILL_ORDER_CONFLICT';
  end if;

  update public.table_bill_sessions s
  set order_id = coalesce(s.order_id, new.id),
      status = 'ordering',
      metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object('last_order_id', new.id, 'last_order_no', new.order_no),
      updated_at = now()
  where s.id = v_session.id
    and s.tenant_id = new.tenant_id
    and s.branch_id = new.branch_id
    and (s.order_id is null or s.order_id = new.id);

  update public.dining_tables t
  set status = 'ordering', updated_at = now()
  where t.id = new.table_id
    and t.tenant_id = new.tenant_id
    and t.branch_id = new.branch_id;

  return new;
end;
$$;

drop trigger if exists trg_bind_dine_in_order_to_table_session on public.orders;
create trigger trg_bind_dine_in_order_to_table_session
after insert on public.orders
for each row execute function app.bind_dine_in_order_to_table_session();

revoke all on function app.bind_dine_in_order_to_table_session() from public;
grant execute on function app.bind_dine_in_order_to_table_session() to service_role;

create or replace function app.enqueue_kitchen_order(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_event_key text,
  p_action text default 'new'::text,
  p_order_item_ids uuid[] default null::uuid[]
)
returns table(kitchen_ticket_id uuid, zone_id uuid, print_job_id uuid)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app', 'extensions'
as $function$
declare
  v_order orders%rowtype;
  v_zone_id uuid;
  v_ticket_id uuid;
  v_printer_id uuid;
  v_connection_type printer_connection_type;
  v_print_job_id uuid;
  v_payload jsonb;
  v_payload_text text;
begin
  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'KITCHEN_EVENT_KEY_REQUIRED';
  end if;
  if p_action not in ('new','add','cancel','reprint') then
    raise exception 'KITCHEN_ACTION_INVALID';
  end if;

  select * into v_order
  from orders o
  where o.id = p_order_id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id;

  if not found then
    raise exception 'KITCHEN_ORDER_NOT_FOUND';
  end if;

  for v_zone_id in
    with base_items as (
      select oi.id as order_item_id, oi.product_id, p.category
      from order_items oi
      join products p
        on p.id = oi.product_id
       and p.tenant_id = oi.tenant_id
       and p.branch_id = oi.branch_id
      where oi.tenant_id = p_tenant_id
        and oi.branch_id = p_branch_id
        and oi.order_id = p_order_id
        and (p_order_item_ids is null or oi.id = any(p_order_item_ids))
    ), candidates as (
      select bi.order_item_id,
             r.zone_id,
             case
               when r.product_id = bi.product_id then 1
               when r.product_id is null and r.category_name is not null and lower(r.category_name) = lower(bi.category) then 2
               else 3
             end as precedence
      from base_items bi
      join kitchen_routing_rules r
        on r.tenant_id = p_tenant_id
       and r.branch_id = p_branch_id
       and r.is_active = true
       and (
         r.product_id = bi.product_id
         or (r.product_id is null and r.category_name is not null and lower(r.category_name) = lower(bi.category))
         or (r.product_id is null and r.category_name is null)
       )
      join kitchen_zones z
        on z.id = r.zone_id
       and z.tenant_id = r.tenant_id
       and z.branch_id = r.branch_id
       and z.is_active = true
    ), ranked as (
      select c.*, min(c.precedence) over (partition by c.order_item_id) as best_precedence
      from candidates c
    )
    select distinct r.zone_id
    from ranked r
    where r.precedence = r.best_precedence
  loop
    insert into kitchen_tickets (
      tenant_id, branch_id, order_id, zone_id, event_key, event_type,
      order_no, order_type, table_id, customer_name, order_notes,
      metadata
    ) values (
      p_tenant_id, p_branch_id, p_order_id, v_zone_id, p_event_key, p_action,
      v_order.order_no, v_order.order_type::text, v_order.table_id,
      v_order.customer_name, v_order.notes,
      jsonb_build_object('source','app.enqueue_kitchen_order')
    )
    on conflict on constraint kitchen_tickets_tenant_id_branch_id_event_key_zone_id_key do nothing
    returning id into v_ticket_id;

    if v_ticket_id is null then
      select kt.id into v_ticket_id
      from kitchen_tickets kt
      where kt.tenant_id = p_tenant_id
        and kt.branch_id = p_branch_id
        and kt.event_key = p_event_key
        and kt.zone_id = v_zone_id;
    end if;

    insert into kitchen_ticket_items (
      tenant_id, branch_id, kitchen_ticket_id, order_item_id, product_id,
      action, product_name, category_name, quantity, notes, metadata
    )
    with base_items as (
      select oi.id as order_item_id, oi.product_id,
             case
               when p_action in ('add','cancel') and oi.metadata ? 'kitchen_delta_quantity'
                 then greatest(0, (oi.metadata->>'kitchen_delta_quantity')::numeric)
               else oi.quantity
             end as quantity,
             oi.notes,
             coalesce(nullif(oi.name,''), p.name) as product_name,
             p.category
      from order_items oi
      join products p
        on p.id = oi.product_id
       and p.tenant_id = oi.tenant_id
       and p.branch_id = oi.branch_id
      where oi.tenant_id = p_tenant_id
        and oi.branch_id = p_branch_id
        and oi.order_id = p_order_id
        and (p_order_item_ids is null or oi.id = any(p_order_item_ids))
    ), candidates as (
      select bi.*,
             r.zone_id,
             case
               when r.product_id = bi.product_id then 1
               when r.product_id is null and r.category_name is not null and lower(r.category_name) = lower(bi.category) then 2
               else 3
             end as precedence
      from base_items bi
      join kitchen_routing_rules r
        on r.tenant_id = p_tenant_id
       and r.branch_id = p_branch_id
       and r.is_active = true
       and (
         r.product_id = bi.product_id
         or (r.product_id is null and r.category_name is not null and lower(r.category_name) = lower(bi.category))
         or (r.product_id is null and r.category_name is null)
       )
    ), ranked as (
      select c.*, min(c.precedence) over (partition by c.order_item_id) as best_precedence
      from candidates c
    )
    select p_tenant_id, p_branch_id, v_ticket_id, r.order_item_id, r.product_id,
           p_action, r.product_name, r.category, r.quantity, r.notes,
           jsonb_build_object('source','app.enqueue_kitchen_order')
    from ranked r
    where r.zone_id = v_zone_id
      and r.precedence = r.best_precedence
    on conflict (kitchen_ticket_id, order_item_id, action) do nothing;

    select z.default_printer_id, pp.connection_type
      into v_printer_id, v_connection_type
    from kitchen_zones z
    join printer_profiles pp
      on pp.id = z.default_printer_id
     and pp.tenant_id = z.tenant_id
     and pp.branch_id = z.branch_id
     and pp.enabled = true
     and pp.printer_role = 'kitchen'
    where z.id = v_zone_id
      and z.tenant_id = p_tenant_id
      and z.branch_id = p_branch_id;

    v_print_job_id := null;
    if v_printer_id is not null then
      select jsonb_build_object(
        'schema_version', 1,
        'kind', 'kitchen_ticket',
        'ticket_id', kt.id,
        'event_type', kt.event_type,
        'order_id', kt.order_id,
        'order_no', kt.order_no,
        'order_type', kt.order_type,
        'table_id', kt.table_id,
        'zone', jsonb_build_object('id', z.id, 'code', z.zone_code, 'name', z.zone_name),
        'customer_name', kt.customer_name,
        'order_notes', kt.order_notes,
        'created_at', kt.created_at,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_item_id', ki.order_item_id,
            'product_id', ki.product_id,
            'name', ki.product_name,
            'category', ki.category_name,
            'quantity', ki.quantity,
            'notes', ki.notes,
            'action', ki.action
          ) order by ki.created_at, ki.id)
          from kitchen_ticket_items ki
          where ki.kitchen_ticket_id = kt.id
        ), '[]'::jsonb)
      ) into v_payload
      from kitchen_tickets kt
      join kitchen_zones z on z.id = kt.zone_id
      where kt.id = v_ticket_id;

      v_payload_text := concat(
        '[', coalesce(v_payload #>> '{zone,name}','Kitchen'), '] ',
        coalesce(v_payload ->> 'order_no',''), ' ', upper(p_action)
      );

      insert into print_jobs (
        tenant_id, branch_id, order_id, printer_id, printer_role,
        connection_type, status, payload_text, payload_json,
        kitchen_ticket_id, idempotency_key, metadata
      ) values (
        p_tenant_id, p_branch_id, p_order_id, v_printer_id, 'kitchen',
        v_connection_type, 'pending', v_payload_text, v_payload,
        v_ticket_id, 'kitchen:' || v_ticket_id::text,
        jsonb_build_object('source','app.enqueue_kitchen_order','schema_version',1)
      )
      on conflict do nothing
      returning id into v_print_job_id;

      if v_print_job_id is null then
        select pj.id into v_print_job_id
        from print_jobs pj
        where pj.tenant_id = p_tenant_id
          and pj.branch_id = p_branch_id
          and pj.idempotency_key = 'kitchen:' || v_ticket_id::text;
      end if;
    end if;

    kitchen_ticket_id := v_ticket_id;
    zone_id := v_zone_id;
    print_job_id := v_print_job_id;
    return next;
  end loop;
end;
$function$;revoke all on function app.enqueue_kitchen_order(uuid,uuid,uuid,text,text,uuid[]) from public, anon, authenticated;
grant execute on function app.enqueue_kitchen_order(uuid,uuid,uuid,text,text,uuid[]) to service_role;

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
as $
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
  select * into v_session
  from public.table_bill_sessions s
  where s.tenant_id = p_tenant_id
    and s.branch_id = p_branch_id
    and s.table_id = p_table_id
    and s.status in ('open', 'ordering')
    and s.closed_at is null
  order by s.opened_at desc
  limit 1
  for update;
  if not found then raise exception 'TABLE_BILL_NOT_OPEN'; end if;
  if v_session.order_id is not null and v_session.order_id <> p_order_id then raise exception 'TABLE_BILL_ORDER_CONFLICT'; end if;

  select * into v_order
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.id = p_order_id
    and o.table_id = p_table_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'queued' then raise exception 'ORDER_NOT_QUEUED'; end if;
  if v_order.order_type <> 'dine_in' then raise exception 'ORDER_NOT_DINE_IN'; end if;
  if not exists (select 1 from public.shifts sh where sh.id = p_shift_id and sh.tenant_id = p_tenant_id and sh.branch_id = p_branch_id and sh.status = 'open') then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  create temporary table if not exists pg_temp.dine_in_target_items(
    product_id uuid not null,
    notes text,
    quantity numeric(12,3) not null,
    unit_price numeric(12,2) not null,
    line_total numeric(12,2) not null,
    product_name text,
    order_item_id uuid,
    existing_quantity numeric(12,3),
    delta numeric(12,3)
  ) on commit drop;
  truncate table pg_temp.dine_in_target_items;

  insert into pg_temp.dine_in_target_items(product_id, notes, quantity, unit_price, line_total, product_name)
  with normalized_items as (
    select
      nullif(value->>'product_id', '')::uuid as product_id,
      nullif(left(trim(coalesce(value->>'notes', value->>'note', '')), 240), '') as notes,
      sum(nullif(value->>'quantity', '')::numeric) as quantity,
      max(nullif(value->>'unit_price', '')::numeric) as unit_price
    from jsonb_array_elements(p_items) value
    group by 1, 2
  )
  select p.id, ni.notes, ni.quantity, coalesce(ni.unit_price, p.price), round(ni.quantity * coalesce(ni.unit_price, p.price), 2), p.name
  from normalized_items ni
  join public.products p on p.id = ni.product_id
    and p.tenant_id = p_tenant_id
    and p.branch_id = p_branch_id
    and p.is_active = true
  where ni.product_id is not null
    and ni.quantity > 0
    and ni.quantity <= 999;

  select coalesce(sum(quantity), 0) into v_item_count from pg_temp.dine_in_target_items;
  if v_item_count < 1 then raise exception 'ITEMS_REQUIRED'; end if;

  update pg_temp.dine_in_target_items ti
  set order_item_id = oi.id,
      existing_quantity = oi.quantity,
      delta = ti.quantity - oi.quantity
  from public.order_items oi
  where oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id
    and oi.product_id = ti.product_id
    and coalesce(oi.notes, '') = coalesce(ti.notes, '')
    and oi.quantity > 0
    and coalesce(oi.metadata->>'bill_line_state', 'active') <> 'cancelled';

  update public.order_items oi
  set quantity = ti.quantity,
      unit_price = ti.unit_price,
      line_total = ti.line_total,
      notes = ti.notes,
      name = coalesce(ti.product_name, oi.name),
      metadata = (coalesce(oi.metadata, '{}'::jsonb) - 'bill_line_state' - 'kitchen_delta_quantity' - 'kitchen_delta_kind') ||
        jsonb_build_object('pos_edit_updated_at', now())
  from pg_temp.dine_in_target_items ti
  where ti.order_item_id = oi.id
    and oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id;

  insert into public.order_items(tenant_id, branch_id, order_id, product_id, quantity, unit_price, line_total, notes, name, metadata)
  select p_tenant_id, p_branch_id, p_order_id, ti.product_id, ti.quantity, ti.unit_price, ti.line_total, ti.notes, ti.product_name,
         jsonb_build_object('source', 'pos_dine_in_edit')
  from pg_temp.dine_in_target_items ti
  where ti.order_item_id is null;

  update public.order_items oi
  set metadata = coalesce(oi.metadata, '{}'::jsonb) || jsonb_build_object('kitchen_delta_quantity', ti.delta, 'kitchen_delta_kind', 'add')
  from pg_temp.dine_in_target_items ti
  where ti.order_item_id = oi.id
    and ti.delta > 0
    and oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id;

  select coalesce(array_agg(order_item_id order by order_item_id), array[]::uuid[])
  into v_add_item_ids
  from pg_temp.dine_in_target_items
  where order_item_id is not null and delta > 0;

  if coalesce(array_length(v_add_item_ids, 1), 0) > 0 then
    select md5(string_agg(id::text || ':' || (metadata->>'kitchen_delta_quantity'), ',' order by id)) into v_event_hash
    from public.order_items
    where id = any(v_add_item_ids);
    perform * from app.enqueue_kitchen_order(p_tenant_id, p_branch_id, p_order_id, 'order:' || p_order_id::text || ':pos-edit:add:' || v_event_hash, 'add', v_add_item_ids);
    update public.order_items set metadata = metadata - 'kitchen_delta_quantity' - 'kitchen_delta_kind' where id = any(v_add_item_ids);
  end if;

  update public.order_items oi
  set quantity = 0,
      line_total = 0,
      metadata = coalesce(oi.metadata, '{}'::jsonb) || jsonb_build_object(
        'bill_line_state', 'cancelled',
        'cancelled_quantity', oi.quantity,
        'kitchen_delta_quantity', oi.quantity,
        'kitchen_delta_kind', 'cancel',
        'pos_edit_cancelled_at', now()
      )
  where oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id
    and oi.quantity > 0
    and coalesce(oi.metadata->>'bill_line_state', 'active') <> 'cancelled'
    and not exists (
      select 1 from pg_temp.dine_in_target_items ti
      where ti.order_item_id = oi.id
    );

  update public.order_items oi
  set metadata = coalesce(oi.metadata, '{}'::jsonb) || jsonb_build_object('kitchen_delta_quantity', abs(ti.delta), 'kitchen_delta_kind', 'cancel')
  from pg_temp.dine_in_target_items ti
  where ti.order_item_id = oi.id
    and ti.delta < 0
    and oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id;

  select coalesce(array_agg(oi.id order by oi.id), array[]::uuid[])
  into v_cancel_item_ids
  from public.order_items oi
  where oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id
    and oi.metadata->>'kitchen_delta_kind' = 'cancel'
    and coalesce((oi.metadata->>'kitchen_delta_quantity')::numeric, 0) > 0;

  if coalesce(array_length(v_cancel_item_ids, 1), 0) > 0 then
    select md5(string_agg(id::text || ':' || (metadata->>'kitchen_delta_quantity'), ',' order by id)) into v_event_hash
    from public.order_items
    where id = any(v_cancel_item_ids);
    perform * from app.enqueue_kitchen_order(p_tenant_id, p_branch_id, p_order_id, 'order:' || p_order_id::text || ':pos-edit:cancel:' || v_event_hash, 'cancel', v_cancel_item_ids);
    update public.order_items set metadata = metadata - 'kitchen_delta_quantity' - 'kitchen_delta_kind' where id = any(v_cancel_item_ids);
  end if;

  update public.orders o
  set shift_id = p_shift_id,
      subtotal = v_subtotal,
      discount_amount = coalesce(p_discount_amount, 0),
      gp_amount = coalesce(p_gp_amount, 0),
      total_amount = v_total,
      tax_total = coalesce(p_tax_total, 0),
      grand_total = v_total,
      metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object('tax_lines', coalesce(p_tax_lines, '[]'::jsonb), 'updated_from', 'pos_dine_in_rpc'),
      updated_at = now()
  where o.id = p_order_id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.status = 'queued'
  returning * into v_order;

  update public.table_bill_sessions s
  set order_id = p_order_id,
      status = 'ordering',
      metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object('last_order_id', p_order_id, 'last_order_no', v_order.order_no),
      updated_at = now()
  where s.id = v_session.id;

  return query select v_order.id, v_order.order_no, v_order.status::text, v_order.created_at, v_order.total_amount;
end;
$;

revoke all on function app.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) from public;
grant execute on function app.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) to service_role;

create or replace function app.cancel_empty_table_bill_session_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_table_id uuid,
  p_actor_user_id uuid
)
returns table(table_session_id uuid, table_id uuid, cancelled boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_session public.table_bill_sessions%rowtype;
begin
  select * into v_session
  from public.table_bill_sessions s
  where s.tenant_id = p_tenant_id
    and s.branch_id = p_branch_id
    and s.table_id = p_table_id
    and s.status in ('open', 'ordering')
    and s.closed_at is null
  order by s.opened_at desc
  limit 1
  for update;
  if not found then raise exception 'TABLE_BILL_NOT_OPEN'; end if;
  if v_session.order_id is not null then raise exception 'TABLE_BILL_NOT_EMPTY'; end if;
  if exists (
    select 1 from public.orders o
    where o.tenant_id = p_tenant_id
      and o.branch_id = p_branch_id
      and o.table_id = p_table_id
      and o.status not in ('cancelled', 'completed', 'paid', 'closed')
  ) then
    raise exception 'TABLE_BILL_NOT_EMPTY';
  end if;

  update public.table_bill_sessions s
  set status = 'cancelled',
      closed_at = now(),
      closed_by = p_actor_user_id,
      metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object('cancelled_empty_bill', true),
      updated_at = now()
  where s.id = v_session.id;

  update public.dining_tables t
  set status = 'available', updated_at = now()
  where t.id = p_table_id
    and t.tenant_id = p_tenant_id
    and t.branch_id = p_branch_id;

  return query select v_session.id, p_table_id, true;
end;
$$;

revoke all on function app.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) from public;
grant execute on function app.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) to service_role;


create or replace function public.replace_queued_dine_in_order_tx(
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
language sql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
  select * from app.replace_queued_dine_in_order_tx(
    p_tenant_id, p_branch_id, p_shift_id, p_actor_user_id, p_order_id, p_table_id,
    p_items, p_app_total_amount, p_discount_amount, p_gp_amount, p_tax_total, p_grand_total, p_tax_lines
  );
$$;

revoke all on function public.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) from public;
revoke all on function public.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) from anon;
revoke all on function public.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) from authenticated;
grant execute on function public.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) to service_role;

create or replace function public.cancel_empty_table_bill_session_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_table_id uuid,
  p_actor_user_id uuid
)
returns table(table_session_id uuid, table_id uuid, cancelled boolean)
language sql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
  select * from app.cancel_empty_table_bill_session_tx(p_tenant_id, p_branch_id, p_table_id, p_actor_user_id);
$$;

revoke all on function public.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) from public;
revoke all on function public.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) from anon;
revoke all on function public.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) to service_role;
