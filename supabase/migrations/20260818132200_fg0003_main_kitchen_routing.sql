do $setup$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_printer_id uuid;
  v_zone_id uuid;
begin
  select t.id, b.id
    into v_tenant_id, v_branch_id
  from public.tenants t
  join public.branches b on b.tenant_id = t.id
  where t.code = 'FG0003'
    and b.code = 'FG0003-BKK-01';

  if v_tenant_id is null or v_branch_id is null then
    raise exception 'FG0003_SCOPE_NOT_FOUND';
  end if;

  select pp.id
    into v_printer_id
  from public.printer_device_assignments pda
  join public.printer_devices pd
    on pd.id = pda.printer_device_id
   and pd.tenant_id = pda.tenant_id
   and pd.branch_id = pda.branch_id
  join public.printer_profiles pp
    on pp.id = pd.printer_profile_id
   and pp.tenant_id = pda.tenant_id
   and pp.branch_id = pda.branch_id
  where pda.tenant_id = v_tenant_id
    and pda.branch_id = v_branch_id
    and pda.purpose = 'kitchen'
    and pda.is_enabled = true
    and pd.is_active = true
    and pp.enabled = true
  order by pda.is_default desc, pda.created_at asc
  limit 1;

  if v_printer_id is null then
    select pp.id
      into v_printer_id
    from public.printer_profiles pp
    where pp.tenant_id = v_tenant_id
      and pp.branch_id = v_branch_id
      and pp.printer_role = 'kitchen'
      and pp.enabled = true
    order by pp.created_at asc
    limit 1;
  end if;

  if v_printer_id is null then
    raise exception 'FG0003_ACTIVE_KITCHEN_PRINTER_NOT_FOUND';
  end if;

  select z.id
    into v_zone_id
  from public.kitchen_zones z
  where z.tenant_id = v_tenant_id
    and z.branch_id = v_branch_id
    and z.zone_code = 'MAIN-KITCHEN';

  if v_zone_id is null then
    insert into public.kitchen_zones (
      tenant_id,
      branch_id,
      zone_code,
      zone_name,
      display_order,
      is_active,
      default_printer_id,
      metadata,
      kds_enabled
    )
    values (
      v_tenant_id,
      v_branch_id,
      'MAIN-KITCHEN',
      'ครัวหลัก',
      10,
      true,
      v_printer_id,
      jsonb_build_object(
        'source', 'fg0003_stability_hardening',
        'routing_mode', 'catch_all_default'
      ),
      true
    )
    returning id into v_zone_id;
  else
    update public.kitchen_zones z
    set zone_name = 'ครัวหลัก',
        display_order = 10,
        is_active = true,
        default_printer_id = v_printer_id,
        kds_enabled = true,
        metadata = coalesce(z.metadata, '{}'::jsonb) || jsonb_build_object(
          'source', 'fg0003_stability_hardening',
          'routing_mode', 'catch_all_default'
        ),
        updated_at = now()
    where z.id = v_zone_id
      and z.tenant_id = v_tenant_id
      and z.branch_id = v_branch_id;
  end if;

  update public.kitchen_routing_rules r
  set priority = 100,
      is_active = true,
      metadata = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'source', 'fg0003_stability_hardening',
        'route_type', 'default_all_items'
      ),
      updated_at = now()
  where r.tenant_id = v_tenant_id
    and r.branch_id = v_branch_id
    and r.zone_id = v_zone_id
    and r.product_id is null
    and r.category_name is null;

  if not found then
    insert into public.kitchen_routing_rules (
      tenant_id,
      branch_id,
      zone_id,
      product_id,
      category_name,
      priority,
      is_active,
      metadata
    )
    values (
      v_tenant_id,
      v_branch_id,
      v_zone_id,
      null,
      null,
      100,
      true,
      jsonb_build_object(
        'source', 'fg0003_stability_hardening',
        'route_type', 'default_all_items'
      )
    );
  end if;
end;
$setup$;
