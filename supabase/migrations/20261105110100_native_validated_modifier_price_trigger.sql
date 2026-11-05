-- Extend existing catalog price enforcement ONLY to server-configured special prices
-- and validated Native modifier selections. All other POS writes remain guarded.
CREATE OR REPLACE FUNCTION app.enforce_non_delivery_catalog_unit_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'app', 'extensions'
AS $function$
declare
  v_order_type public.order_type;
  v_catalog_price numeric;
  v_product_metadata jsonb;
  v_special_price numeric;
  v_native jsonb;
  v_selected jsonb;
  v_selected_count int;
  v_recognized_count int;
  v_delta numeric;
  v_expected numeric;
  v_kind text;
  v_group record;
  v_group_count int;
begin
  if new.quantity is null or new.quantity < 0 then
    raise exception 'INVALID_ITEM_QTY';
  end if;

  if new.quantity = 0 then
    if tg_op <> 'UPDATE' then
      raise exception 'INVALID_ITEM_QTY';
    end if;

    if old.quantity is null
      or old.quantity <= 0
      or coalesce(new.metadata->>'bill_line_state', '') <> 'cancelled'
      or new.tenant_id is distinct from old.tenant_id
      or new.branch_id is distinct from old.branch_id
      or new.order_id is distinct from old.order_id
      or new.product_id is distinct from old.product_id
      or new.unit_price is distinct from old.unit_price
    then
      raise exception 'INVALID_ITEM_QTY';
    end if;

    new.line_total := 0;
    return new;
  end if;

  select o.order_type
    into v_order_type
  from public.orders o
  where o.id = new.order_id
    and o.tenant_id = new.tenant_id
    and o.branch_id = new.branch_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND_FOR_ITEM';
  end if;

  select p.price, p.metadata
    into v_catalog_price, v_product_metadata
  from public.products p
  where p.id = new.product_id
    and p.tenant_id = new.tenant_id
    and p.branch_id = new.branch_id
    and p.is_active = true;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND:%', new.product_id;
  end if;

  if v_order_type <> 'delivery_manual'::public.order_type then
    v_special_price := case
      when jsonb_typeof(v_product_metadata->'special_price')='number'
        and (v_product_metadata->>'special_price')::numeric >= 0
      then round((v_product_metadata->>'special_price')::numeric, 2)
      else null
    end;
    v_native := coalesce(new.metadata,'{}'::jsonb)->'native_selection';
    if v_native is not null then
      if jsonb_typeof(v_native) <> 'object'
        or coalesce(v_native->>'price_kind','') not in ('regular','special')
        or jsonb_typeof(v_native->'modifier_option_ids') <> 'array'
        or jsonb_typeof(v_native->'cart_line_id') <> 'string'
        or length(coalesce(v_native->>'cart_line_id','')) not between 3 and 150
      then
        raise exception 'INVALID_NATIVE_SELECTION';
      end if;
      v_kind := v_native->>'price_kind';
      v_selected := v_native->'modifier_option_ids';
      v_selected_count := jsonb_array_length(v_selected);
      if v_selected_count > 24 or exists(
        select 1 from jsonb_array_elements_text(v_selected) selected(id)
        where selected.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
  else
    if new.unit_price is null or new.unit_price < 0 then
      raise exception 'INVALID_ITEM_UNIT_PRICE';
    end if;
    new.unit_price := round(new.unit_price::numeric, 2);
    new.line_total := round(new.unit_price * new.quantity, 2);
  end if;

  return new;
end;
$function$

      ) then
        raise exception 'INVALID_NATIVE_MODIFIER_IDS';
      end if;
      select count(*), coalesce(sum(mo.price_delta),0)
        into v_recognized_count, v_delta
      from jsonb_array_elements_text(v_selected) selected(id)
      join public.product_modifier_options mo on mo.id=selected.id::uuid
        and mo.tenant_id=new.tenant_id and mo.branch_id=new.branch_id and mo.is_active
      join public.product_modifier_groups mg on mg.id=mo.group_id
        and mg.tenant_id=new.tenant_id and mg.branch_id=new.branch_id
        and mg.product_id=new.product_id and mg.is_active;
      if v_recognized_count <> v_selected_count
        or v_selected_count <> (
          select count(distinct picked.id) from jsonb_array_elements_text(v_selected) picked(id)
        )
      then
        raise exception 'INVALID_NATIVE_MODIFIER_IDS';
      end if;
      for v_group in
        select id, selection_type, is_required, min_select, max_select
        from public.product_modifier_groups
        where tenant_id=new.tenant_id and branch_id=new.branch_id
          and product_id=new.product_id and is_active
      loop
        select count(*) into v_group_count
        from jsonb_array_elements_text(v_selected) selected(id)
        join public.product_modifier_options mo on mo.id=selected.id::uuid
          and mo.group_id=v_group.id and mo.is_active
          and mo.tenant_id=new.tenant_id and mo.branch_id=new.branch_id;
        if (v_group.is_required and v_group_count = 0)
          or (v_group_count > 0 and v_group_count <
              case when v_group.is_required then greatest(1,v_group.min_select)
                   else v_group.min_select end)
          or v_group_count > v_group.max_select
          or (v_group.selection_type='single' and v_group_count>1)
        then
          raise exception 'INVALID_NATIVE_MODIFIER_GROUP:%',v_group.id;
        end if;
      end loop;
      if v_kind='special' and v_special_price is null then
        raise exception 'SPECIAL_PRICE_NOT_CONFIGURED';
      end if;
      v_expected := round((
        case when v_kind='special' then v_special_price else v_catalog_price end
      ) + v_delta, 2);
      if v_expected is null or v_expected < 0
        or new.unit_price is null
        or abs(round(new.unit_price::numeric,2)-v_expected) > 0.009
      then
        raise exception 'UNTRUSTED_NATIVE_MODIFIER_PRICE:%',new.product_id;
      end if;
      new.unit_price := v_expected;
    else
      -- Existing Web/tablet sales use regular or exact configured special price.
      if new.unit_price is null or (
        abs(round(new.unit_price::numeric,2)-round(v_catalog_price::numeric,2)) > 0.01
        and (v_special_price is null or
          abs(round(new.unit_price::numeric,2)-v_special_price) > 0.01)
      ) then
        raise exception 'UNTRUSTED_UNIT_PRICE:%', new.product_id;
      end if;
      new.unit_price := round(new.unit_price::numeric,2);
    end if;
    new.line_total := round(new.unit_price * new.quantity, 2);
  else
    if new.unit_price is null or new.unit_price < 0 then
      raise exception 'INVALID_ITEM_UNIT_PRICE';
    end if;
    new.unit_price := round(new.unit_price::numeric, 2);
    new.line_total := round(new.unit_price * new.quantity, 2);
  end if;

  return new;
end;
$function$
;
