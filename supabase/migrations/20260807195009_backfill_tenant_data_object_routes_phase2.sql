insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'product_categories', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.product_categories
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();

insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'product_combo_items', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.product_combo_items
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();

insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'ingredient_packages', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.ingredient_packages
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();

insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'table_zones', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.table_zones
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();

insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'table_layout_objects', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.table_layout_objects
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();

insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'transfer_payment_verifications', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.transfer_payment_verifications
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();

insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'tenant_tax_settings', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.tenant_tax_settings
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
