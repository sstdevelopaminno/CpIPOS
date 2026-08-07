create or replace function app.create_stock_adjustment_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_ingredient_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_created_by uuid,
  p_approval_id uuid,
  p_request_id text default null
)
returns table(movement_id uuid, movement_status text, created_at timestamptz, duplicate_request boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_existing record;
  v_movement_id uuid;
  v_allow_negative boolean := false;
begin
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'INVALID_QUANTITY_DELTA';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'ADJUSTMENT_REASON_REQUIRED';
  end if;
  if not exists (
    select 1 from public.trial_branch_scopes b
    where b.tenant_id=p_tenant_id and b.branch_id=p_branch_id and b.is_active=true
  ) then
    raise exception 'TRIAL_BRANCH_SCOPE_INACTIVE';
  end if;

  if nullif(trim(p_request_id), '') is not null then
    select s.id, s.created_at into v_existing
    from public.stock_movements s
    where s.tenant_id=p_tenant_id and s.branch_id=p_branch_id
      and s.request_id=trim(p_request_id) and s.movement_type='manual_adjustment'
    limit 1;
    if found then
      return query select v_existing.id, 'recorded'::text, v_existing.created_at, true;
      return;
    end if;
  end if;

  select coalesce(s.allow_negative_stock,false) into v_allow_negative
  from public.branch_inventory_settings s
  where s.tenant_id=p_tenant_id and s.branch_id=p_branch_id;

  update public.ingredients i
  set quantity_on_hand = round(i.quantity_on_hand + p_quantity_delta, 0), updated_at=now()
  where i.id=p_ingredient_id and i.tenant_id=p_tenant_id and i.branch_id=p_branch_id
    and (v_allow_negative or i.quantity_on_hand + p_quantity_delta >= 0);

  if not found then
    if exists(select 1 from public.ingredients i where i.id=p_ingredient_id and i.tenant_id=p_tenant_id and i.branch_id=p_branch_id) then
      raise exception 'INSUFFICIENT_STOCK:%', p_ingredient_id;
    end if;
    raise exception 'INGREDIENT_NOT_FOUND:%', p_ingredient_id;
  end if;

  v_movement_id:=gen_random_uuid();
  insert into public.stock_movements(
    id,tenant_id,branch_id,ingredient_id,movement_type,quantity_delta,reason,approval_id,created_by,request_id
  ) values (
    v_movement_id,p_tenant_id,p_branch_id,p_ingredient_id,'manual_adjustment',round(p_quantity_delta,0),trim(p_reason),p_approval_id,p_created_by,nullif(trim(p_request_id),'')
  );

  return query select v_movement_id,'recorded'::text,now(),false;
exception when unique_violation then
  if nullif(trim(p_request_id), '') is not null then
    select s.id, s.created_at into v_existing
    from public.stock_movements s
    where s.tenant_id=p_tenant_id and s.branch_id=p_branch_id
      and s.request_id=trim(p_request_id) and s.movement_type='manual_adjustment'
    limit 1;
    if found then
      return query select v_existing.id,'recorded'::text,v_existing.created_at,true;
      return;
    end if;
  end if;
  raise;
end;
$$;

create or replace function public.create_stock_adjustment_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_ingredient_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_created_by uuid,
  p_approval_id uuid,
  p_request_id text default null
)
returns table(movement_id uuid, movement_status text, created_at timestamptz, duplicate_request boolean)
language sql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
  select * from app.create_stock_adjustment_tx(p_tenant_id,p_branch_id,p_ingredient_id,p_quantity_delta,p_reason,p_created_by,p_approval_id,p_request_id);
$$;

revoke execute on function app.create_stock_adjustment_tx(uuid,uuid,uuid,numeric,text,uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.create_stock_adjustment_tx(uuid,uuid,uuid,numeric,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function app.create_stock_adjustment_tx(uuid,uuid,uuid,numeric,text,uuid,uuid,text) to service_role;
grant execute on function public.create_stock_adjustment_tx(uuid,uuid,uuid,numeric,text,uuid,uuid,text) to service_role;
