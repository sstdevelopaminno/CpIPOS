-- Candidate only; not an applied migration. Validate on isolated PostgreSQL first.
-- Server-side caller must authenticate POS session and stock_management feature.
begin;
create function public.rw_adjust_branch_stock_candidate(
  p_tenant uuid, p_branch uuid, p_product uuid, p_ingredient uuid,
  p_actor uuid, p_approval uuid, p_request uuid, p_delta integer, p_reason text
) returns uuid
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_existing public.stock_movements%rowtype;
  v_id uuid;
  v_request text := 'rw-adjust:' || p_request::text;
begin
  if p_tenant is null or p_branch is null or p_product is null or p_ingredient is null
     or p_actor is null or p_approval is null or p_request is null or p_delta is null
     or p_delta = 0 or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'INVALID_ADJUSTMENT';
  end if;
  if not exists (select 1 from public.user_branch_roles
      where tenant_id=p_tenant and branch_id=p_branch and user_id=p_actor and role in ('owner','manager'))
    or not exists (select 1 from public.branches where id=p_branch and tenant_id=p_tenant and is_active)
    then raise exception 'FORBIDDEN_BRANCH'; end if;
  if (select count(*) from public.tenant_subscription_contracts c
      where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now())) <> 1
    or not exists (select 1 from public.tenant_subscription_contracts c join public.subscription_packages p on p.id=c.package_id
      where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now())
      and lower(trim(p.code))='custom' and c.metadata->'sales_modes'->'retail_wholesale'='true'::jsonb
      and not exists (select 1 from unnest(array['takeaway','home','dine_in','buffet_table','delivery','optical_retail','recycling']) k
        where c.metadata->'sales_modes'->k='true'::jsonb))
    then raise exception 'RW_REQUIRED'; end if;
  -- Serialize same request even across different target rows. Collisions only serialize.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || p_branch::text || ':' || v_request,0));
  select * into v_existing from public.stock_movements
    where tenant_id=p_tenant and branch_id=p_branch and request_id=v_request;
  if found then
    if v_existing.movement_type <> 'manual_adjustment' or v_existing.ingredient_id <> p_ingredient
       or v_existing.ref_table is distinct from 'products' or v_existing.ref_id is distinct from p_product
       or v_existing.created_by <> p_actor or v_existing.approval_id is distinct from p_approval
       or v_existing.quantity_delta <> p_delta or v_existing.reason <> btrim(p_reason)
      then raise exception 'REQUEST_CONFLICT'; end if;
    return v_existing.id;
  end if;
  -- Lock product and actual stock row. Restrict to a dedicated piece recipe.
  perform 1 from public.products where id=p_product and tenant_id=p_tenant and branch_id=p_branch
    and is_active and deleted_at is null and stock_deduction_mode='recipe_deduction' for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  perform 1 from public.ingredients where id=p_ingredient and tenant_id=p_tenant and branch_id=p_branch
    and base_unit='piece' and name like 'STOCK:%' for update;
  if not found then raise exception 'INGREDIENT_NOT_FOUND'; end if;
  if (select count(*) from public.recipes where product_id=p_product) <> 1
    or (select count(*) from public.recipes where ingredient_id=p_ingredient) <> 1
    or not exists (select 1 from public.recipes where product_id=p_product and ingredient_id=p_ingredient
       and tenant_id=p_tenant and branch_id=p_branch and quantity_per_item=1 and not applies_when_takeaway_only)
    then raise exception 'AMBIGUOUS_STOCK_MAPPING'; end if;
  -- Strict target-bound approval. Existing approval issuance must be adapted/verified
  -- to bind the exact command payload before wiring this candidate into production.
  update public.manager_pin_approvals a set consumed_at=clock_timestamp()
    where a.id=p_approval and a.tenant_id=p_tenant and a.branch_id=p_branch
      and a.requested_by=p_actor and a.action='stock_adjustment'
      and a.target_table='ingredients' and a.target_id=p_ingredient
      and a.consumed_at is null and a.expires_at>clock_timestamp()
      and a.note = jsonb_build_object('request_id',p_request,'product_id',p_product,'delta',p_delta,'reason',btrim(p_reason))::text
      and exists (select 1 from public.user_branch_roles u
        where u.tenant_id=p_tenant and u.branch_id=p_branch and u.user_id=a.approved_by and u.role in ('owner','manager'));
  if not found then raise exception 'INVALID_APPROVAL'; end if;
  update public.ingredients i set quantity_on_hand=i.quantity_on_hand+p_delta
    where i.id=p_ingredient and i.tenant_id=p_tenant and i.branch_id=p_branch
      and (p_delta>0 or i.quantity_on_hand>=-p_delta::numeric);
  if not found then raise exception 'INSUFFICIENT_STOCK'; end if;
  insert into public.stock_movements(tenant_id,branch_id,ingredient_id,movement_type,quantity_delta,reason,
    ref_table,ref_id,approval_id,created_by,request_id)
    values(p_tenant,p_branch,p_ingredient,'manual_adjustment',p_delta,btrim(p_reason),
      'products',p_product,p_approval,p_actor,v_request) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.rw_adjust_branch_stock_candidate(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.rw_adjust_branch_stock_candidate(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,text) to service_role;
commit;
