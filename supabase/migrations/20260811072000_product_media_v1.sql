-- Product Media v1: package-aware cloud media + POS device cache allowance.
-- Product assets live on the CpiPOS-001 control plane so Trial/Primary product IDs
-- can share the same public media layer without exposing data-plane credentials.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-media',
  'product-media',
  true,
  2097152,
  array['image/webp']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.product_media_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null,
  display_object_path text not null,
  thumbnail_object_path text not null,
  display_bytes bigint not null check (display_bytes > 0),
  thumbnail_bytes bigint not null default 0 check (thumbnail_bytes >= 0),
  display_width integer not null check (display_width > 0),
  display_height integer not null check (display_height > 0),
  thumbnail_width integer not null check (thumbnail_width > 0),
  thumbnail_height integer not null check (thumbnail_height > 0),
  content_type text not null default 'image/webp' check (content_type = 'image/webp'),
  checksum_sha256 text not null,
  uploaded_by_user_id uuid not null,
  source_device_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, product_id),
  check (length(display_object_path) between 1 and 700),
  check (length(thumbnail_object_path) between 1 and 700),
  check (checksum_sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists idx_product_media_assets_tenant_branch
  on public.product_media_assets (tenant_id, branch_id, updated_at desc);
create index if not exists idx_product_media_assets_product
  on public.product_media_assets (product_id);

alter table public.product_media_assets enable row level security;
revoke all on table public.product_media_assets from anon, authenticated;
grant select, insert, update, delete on table public.product_media_assets to service_role;

-- Keep quotas in package metadata so IT Admin/custom contracts can override them
-- without introducing another pricing schema. Values are MiB.
update public.subscription_packages
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'product_media_cloud_quota_mb', 250,
  'product_media_device_cache_mb', 1024
)
where code = 'starter';

update public.subscription_packages
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'product_media_cloud_quota_mb', 1024,
  'product_media_device_cache_mb', 4096
)
where code = 'growth';

update public.subscription_packages
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'product_media_cloud_quota_mb', 5120,
  'product_media_device_cache_mb', 16384
)
where code = 'custom';

create or replace function public.upsert_product_media_asset_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_display_object_path text,
  p_thumbnail_object_path text,
  p_display_bytes bigint,
  p_thumbnail_bytes bigint,
  p_display_width integer,
  p_display_height integer,
  p_thumbnail_width integer,
  p_thumbnail_height integer,
  p_checksum_sha256 text,
  p_uploaded_by_user_id uuid,
  p_source_device_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  asset_id uuid,
  quota_bytes bigint,
  used_bytes bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract_metadata jsonb := '{}'::jsonb;
  v_package_metadata jsonb := '{}'::jsonb;
  v_package_id uuid;
  v_quota_mb numeric := 100;
  v_quota_bytes bigint;
  v_existing_bytes bigint := 0;
  v_next_bytes bigint;
  v_asset_id uuid;
begin
  if p_display_bytes <= 0 or p_thumbnail_bytes < 0 then
    raise exception 'PRODUCT_MEDIA_INVALID_SIZE' using errcode = 'P0001';
  end if;

  if p_display_bytes > 1572864 or p_thumbnail_bytes > 524288 then
    raise exception 'PRODUCT_MEDIA_FILE_TOO_LARGE' using errcode = 'P0001';
  end if;

  -- Serialize quota accounting for one tenant so concurrent uploads cannot both
  -- pass the same remaining-space check.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));

  select c.package_id, coalesce(c.metadata, '{}'::jsonb)
    into v_package_id, v_contract_metadata
  from public.tenant_subscription_contracts c
  where c.tenant_id = p_tenant_id
    and c.status in ('active', 'trial', 'grace')
  order by c.started_at desc, c.updated_at desc
  limit 1;

  if v_package_id is null then
    select t.package_id
      into v_package_id
    from public.tenants t
    where t.id = p_tenant_id;
  end if;

  if v_package_id is not null then
    select coalesce(p.metadata, '{}'::jsonb)
      into v_package_metadata
    from public.subscription_packages p
    where p.id = v_package_id;
  end if;

  if coalesce(v_contract_metadata->>'product_media_cloud_quota_mb', '') ~ '^[0-9]+([.][0-9]+)?$' then
    v_quota_mb := (v_contract_metadata->>'product_media_cloud_quota_mb')::numeric;
  elsif coalesce(v_package_metadata->>'product_media_cloud_quota_mb', '') ~ '^[0-9]+([.][0-9]+)?$' then
    v_quota_mb := (v_package_metadata->>'product_media_cloud_quota_mb')::numeric;
  end if;

  v_quota_mb := greatest(1, least(v_quota_mb, 102400));
  v_quota_bytes := floor(v_quota_mb * 1024 * 1024)::bigint;

  select coalesce(sum(a.display_bytes + a.thumbnail_bytes), 0)::bigint
    into v_existing_bytes
  from public.product_media_assets a
  where a.tenant_id = p_tenant_id
    and not (
      a.branch_id = p_branch_id
      and a.product_id = p_product_id
    );

  v_next_bytes := v_existing_bytes + p_display_bytes + p_thumbnail_bytes;
  if v_next_bytes > v_quota_bytes then
    raise exception 'PRODUCT_MEDIA_QUOTA_EXCEEDED'
      using errcode = 'P0001',
      detail = jsonb_build_object(
        'quota_bytes', v_quota_bytes,
        'used_without_target_bytes', v_existing_bytes,
        'requested_bytes', p_display_bytes + p_thumbnail_bytes
      )::text;
  end if;

  insert into public.product_media_assets (
    tenant_id,
    branch_id,
    product_id,
    display_object_path,
    thumbnail_object_path,
    display_bytes,
    thumbnail_bytes,
    display_width,
    display_height,
    thumbnail_width,
    thumbnail_height,
    content_type,
    checksum_sha256,
    uploaded_by_user_id,
    source_device_id,
    metadata,
    updated_at
  ) values (
    p_tenant_id,
    p_branch_id,
    p_product_id,
    p_display_object_path,
    p_thumbnail_object_path,
    p_display_bytes,
    p_thumbnail_bytes,
    p_display_width,
    p_display_height,
    p_thumbnail_width,
    p_thumbnail_height,
    'image/webp',
    p_checksum_sha256,
    p_uploaded_by_user_id,
    p_source_device_id,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (tenant_id, branch_id, product_id)
  do update set
    display_object_path = excluded.display_object_path,
    thumbnail_object_path = excluded.thumbnail_object_path,
    display_bytes = excluded.display_bytes,
    thumbnail_bytes = excluded.thumbnail_bytes,
    display_width = excluded.display_width,
    display_height = excluded.display_height,
    thumbnail_width = excluded.thumbnail_width,
    thumbnail_height = excluded.thumbnail_height,
    content_type = excluded.content_type,
    checksum_sha256 = excluded.checksum_sha256,
    uploaded_by_user_id = excluded.uploaded_by_user_id,
    source_device_id = excluded.source_device_id,
    metadata = excluded.metadata,
    updated_at = now()
  returning id into v_asset_id;

  return query select v_asset_id, v_quota_bytes, v_next_bytes;
end;
$$;

revoke all on function public.upsert_product_media_asset_tx(
  uuid, uuid, uuid, text, text, bigint, bigint, integer, integer,
  integer, integer, text, uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.upsert_product_media_asset_tx(
  uuid, uuid, uuid, text, text, bigint, bigint, integer, integer,
  integer, integer, text, uuid, uuid, jsonb
) to service_role;

comment on table public.product_media_assets is
  'Canonical public product-image metadata on CpiPOS-001. product_id is intentionally cross-plane and has no FK to products.';
comment on function public.upsert_product_media_asset_tx is
  'Atomically enforces package/contract product-media cloud quota and upserts one product asset.';
