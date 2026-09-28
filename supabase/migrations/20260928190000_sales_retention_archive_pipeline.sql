-- CpIPOS rolling sales retention archive (2026-09-28)
--
-- Purpose:
--   Keep only the recent raw sales window in PostgreSQL.
--   Export older completed/cancelled sales to private Storage first.
--   Email the current Owner a secure download link.
--   Purge raw sales only after export + successful email + 7-day safety window.
--
-- Products, categories, inventory master and current stock are NEVER deleted here.
-- Orders linked to tax invoices are deliberately excluded from automated purge.

create extension if not exists pg_net with schema extensions;

create table if not exists public.sales_retention_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  package_code text,
  retention_months integer not null check (retention_months between 1 and 120),
  cutoff_at timestamptz not null,
  range_start_at timestamptz,
  range_end_at timestamptz,
  status text not null default 'claimed'
    check (status in (
      'claimed','exporting','exported','email_pending','email_sent',
      'email_blocked','email_failed','purge_ready','purged','failed'
    )),
  recipient_email text,
  order_count integer not null default 0 check (order_count >= 0),
  item_count integer not null default 0 check (item_count >= 0),
  payment_count integer not null default 0 check (payment_count >= 0),
  gross_total numeric(14,2) not null default 0,
  paid_total numeric(14,2) not null default 0,
  orders_object_path text,
  items_object_path text,
  payments_object_path text,
  manifest_object_path text,
  checksums jsonb not null default '{}'::jsonb,
  export_attempt_count integer not null default 0 check (export_attempt_count >= 0),
  email_attempt_count integer not null default 0 check (email_attempt_count >= 0),
  exported_at timestamptz,
  email_sent_at timestamptz,
  purge_after timestamptz,
  purged_at timestamptz,
  purged_order_count integer not null default 0 check (purged_order_count >= 0),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_retention_batches_tenant_created_idx
  on public.sales_retention_batches(tenant_id, created_at desc);
create index if not exists sales_retention_batches_status_idx
  on public.sales_retention_batches(status, updated_at);
create index if not exists sales_retention_batches_purge_idx
  on public.sales_retention_batches(status, purge_after)
  where status = 'purge_ready';

create table if not exists public.sales_retention_batch_orders (
  order_id uuid primary key references public.orders(id) on delete cascade,
  batch_id uuid not null references public.sales_retention_batches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_created_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sales_retention_batch_orders_batch_idx
  on public.sales_retention_batch_orders(batch_id, order_created_at);

alter table public.sales_retention_batches enable row level security;
alter table public.sales_retention_batch_orders enable row level security;
revoke all on public.sales_retention_batches from public, anon, authenticated;
revoke all on public.sales_retention_batch_orders from public, anon, authenticated;
grant select, insert, update, delete on public.sales_retention_batches to service_role;
grant select, insert, update, delete on public.sales_retention_batch_orders to service_role;

comment on table public.sales_retention_batches is
  'Compact manifest/ledger for rolling POS sales archives. Raw historical orders are purged only after verified export and email delivery.';
comment on table public.sales_retention_batch_orders is
  'Temporary exact order membership for a retention batch. Rows disappear by ON DELETE CASCADE when archived orders are purged.';
comment on column public.sales_retention_batches.retention_months is
  'Snapshot of the tenant sales-retention policy. Package retention is used; tenant_data_lifecycle.metadata.sales_retention_months may override it.';
comment on column public.sales_retention_batches.purge_after is
  'Safety deadline. Raw orders cannot be purged before this time even after a successful archive email.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sales-retention-exports',
  'sales-retention-exports',
  false,
  20971520,
  array['text/csv','application/json']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Expand the existing transactional email ledger to include the archive-export event.
alter table public.it_communication_settings
  add column if not exists auto_send_sales_retention_export boolean not null default true;

alter table public.customer_email_deliveries
  drop constraint if exists customer_email_deliveries_event_type_check;
alter table public.customer_email_deliveries
  add constraint customer_email_deliveries_event_type_check
  check (event_type in ('store_activation','payment_confirmation','sales_retention_export'));

create schema if not exists private;

create table if not exists private.sales_retention_worker_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists private.sales_retention_email_tokens (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.sales_retention_batches(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on private.sales_retention_worker_tokens from public, anon, authenticated;
revoke all on private.sales_retention_email_tokens from public, anon, authenticated;

create or replace function app.sales_retention_months_for_tenant(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select greatest(
    1,
    least(
      120,
      coalesce(
        case
          when coalesce(tdl.metadata->>'sales_retention_months','') ~ '^[1-9][0-9]{0,2}$'
            then (tdl.metadata->>'sales_retention_months')::integer
          else null
        end,
        sp.retention_months,
        6
      )
    )
  )
  from public.tenants t
  left join public.tenant_data_lifecycle tdl on tdl.tenant_id = t.id
  left join public.subscription_packages sp on sp.id = t.package_id
  where t.id = p_tenant_id;
$$;

revoke all on function app.sales_retention_months_for_tenant(uuid) from public, anon, authenticated;
grant execute on function app.sales_retention_months_for_tenant(uuid) to service_role;

create or replace function app.claim_due_sales_retention_batch(p_max_orders integer default 2000)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_tenant_id uuid;
  v_package_code text;
  v_retention_months integer;
  v_cutoff timestamptz;
  v_batch_id uuid;
  v_count integer;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_max_orders is null or p_max_orders < 1 or p_max_orders > 5000 then
    raise exception 'invalid_retention_batch_size';
  end if;

  -- Only one claimant may stage a new batch at a time.
  if not pg_try_advisory_xact_lock(hashtext('cpipos_sales_retention_claim')) then
    return null;
  end if;

  select
    o.tenant_id,
    sp.code,
    app.sales_retention_months_for_tenant(o.tenant_id)
  into v_tenant_id, v_package_code, v_retention_months
  from public.orders o
  join public.tenants t on t.id = o.tenant_id and t.is_active = true
  left join public.tenant_data_lifecycle tdl on tdl.tenant_id = o.tenant_id
  left join public.subscription_packages sp on sp.id = t.package_id
  where o.status in ('completed','cancelled')
    and coalesce(tdl.lifecycle_status,'active') <> 'sales_demo'
    and o.created_at < date_trunc('day', now()) - make_interval(months => app.sales_retention_months_for_tenant(o.tenant_id))
    and not exists (
      select 1 from public.sales_retention_batch_orders bro where bro.order_id = o.id
    )
    and not exists (
      select 1 from public.pos_tax_invoices ti where ti.order_id = o.id
    )
  order by o.created_at asc
  limit 1;

  if v_tenant_id is null then
    return null;
  end if;

  v_cutoff := date_trunc('day', now()) - make_interval(months => v_retention_months);

  insert into public.sales_retention_batches (
    tenant_id, package_code, retention_months, cutoff_at, status,
    metadata
  ) values (
    v_tenant_id, v_package_code, v_retention_months, v_cutoff, 'claimed',
    jsonb_build_object(
      'policy_source','package_or_tenant_override',
      'products_deleted',false,
      'tax_invoice_orders_excluded',true,
      'safety_grace_days',7
    )
  )
  returning id into v_batch_id;

  insert into public.sales_retention_batch_orders (order_id, batch_id, tenant_id, order_created_at)
  select o.id, v_batch_id, o.tenant_id, o.created_at
  from public.orders o
  where o.tenant_id = v_tenant_id
    and o.status in ('completed','cancelled')
    and o.created_at < v_cutoff
    and not exists (
      select 1 from public.sales_retention_batch_orders bro where bro.order_id = o.id
    )
    and not exists (
      select 1 from public.pos_tax_invoices ti where ti.order_id = o.id
    )
  order by o.created_at asc
  limit p_max_orders
  on conflict (order_id) do nothing;

  select count(*), min(order_created_at), max(order_created_at)
  into v_count, v_start, v_end
  from public.sales_retention_batch_orders
  where batch_id = v_batch_id;

  if coalesce(v_count,0) = 0 then
    delete from public.sales_retention_batches where id = v_batch_id;
    return null;
  end if;

  update public.sales_retention_batches
  set order_count = v_count,
      range_start_at = v_start,
      range_end_at = v_end,
      updated_at = now()
  where id = v_batch_id;

  return v_batch_id;
end;
$$;

revoke all on function app.claim_due_sales_retention_batch(integer) from public, anon, authenticated;
grant execute on function app.claim_due_sales_retention_batch(integer) to service_role;

create or replace function app.complete_sales_retention_export(
  p_batch_id uuid,
  p_orders_object_path text,
  p_items_object_path text,
  p_payments_object_path text,
  p_manifest_object_path text,
  p_checksums jsonb,
  p_order_count integer,
  p_item_count integer,
  p_payment_count integer,
  p_gross_total numeric,
  p_paid_total numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
begin
  update public.sales_retention_batches
  set status = 'exported',
      orders_object_path = p_orders_object_path,
      items_object_path = p_items_object_path,
      payments_object_path = p_payments_object_path,
      manifest_object_path = p_manifest_object_path,
      checksums = coalesce(p_checksums,'{}'::jsonb),
      order_count = greatest(0,coalesce(p_order_count,0)),
      item_count = greatest(0,coalesce(p_item_count,0)),
      payment_count = greatest(0,coalesce(p_payment_count,0)),
      gross_total = coalesce(p_gross_total,0),
      paid_total = coalesce(p_paid_total,0),
      exported_at = now(),
      last_error = null,
      updated_at = now()
  where id = p_batch_id
    and status in ('claimed','exporting','failed');

  if not found then
    raise exception 'retention_batch_not_exportable';
  end if;
end;
$$;

revoke all on function app.complete_sales_retention_export(uuid,text,text,text,text,jsonb,integer,integer,integer,numeric,numeric)
  from public, anon, authenticated;
grant execute on function app.complete_sales_retention_export(uuid,text,text,text,text,jsonb,integer,integer,integer,numeric,numeric)
  to service_role;

create or replace function app.issue_sales_retention_email_token(p_batch_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private, app, extensions
as $$
declare
  v_token text := encode(gen_random_bytes(32),'hex');
begin
  if not exists (
    select 1
    from public.sales_retention_batches
    where id = p_batch_id
      and status in ('exported','email_pending','email_failed','email_blocked')
      and exported_at is not null
  ) then
    raise exception 'retention_batch_not_ready_for_email';
  end if;

  delete from private.sales_retention_email_tokens
  where expires_at < now() - interval '1 day' or consumed_at is not null;

  insert into private.sales_retention_email_tokens(batch_id,token_hash,expires_at)
  values (
    p_batch_id,
    encode(digest(v_token,'sha256'),'hex'),
    now() + interval '5 minutes'
  );

  update public.sales_retention_batches
  set status = 'email_pending',
      email_attempt_count = email_attempt_count + 1,
      updated_at = now()
  where id = p_batch_id;

  return v_token;
end;
$$;

revoke all on function app.issue_sales_retention_email_token(uuid) from public, anon, authenticated;
grant execute on function app.issue_sales_retention_email_token(uuid) to service_role;

create or replace function app.consume_sales_retention_email_token(p_batch_id uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, app, extensions
as $$
declare
  v_id uuid;
begin
  if p_batch_id is null or coalesce(length(trim(p_token)),0) < 32 then
    return false;
  end if;

  select id into v_id
  from private.sales_retention_email_tokens
  where batch_id = p_batch_id
    and token_hash = encode(digest(p_token,'sha256'),'hex')
    and consumed_at is null
    and expires_at > now()
  order by created_at desc
  limit 1
  for update;

  if v_id is null then
    return false;
  end if;

  update private.sales_retention_email_tokens
  set consumed_at = now()
  where id = v_id;

  return true;
end;
$$;

revoke all on function app.consume_sales_retention_email_token(uuid,text) from public, anon, authenticated;
grant execute on function app.consume_sales_retention_email_token(uuid,text) to service_role;

create or replace function app.consume_sales_retention_worker_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private, app, extensions
as $$
declare
  v_id uuid;
begin
  if coalesce(length(trim(p_token)),0) < 32 then
    return false;
  end if;

  select id into v_id
  from private.sales_retention_worker_tokens
  where token_hash = encode(digest(p_token,'sha256'),'hex')
    and consumed_at is null
    and expires_at > now()
  order by created_at desc
  limit 1
  for update;

  if v_id is null then
    return false;
  end if;

  update private.sales_retention_worker_tokens
  set consumed_at = now()
  where id = v_id;

  return true;
end;
$$;

revoke all on function app.consume_sales_retention_worker_token(text) from public, anon, authenticated;
grant execute on function app.consume_sales_retention_worker_token(text) to service_role;

create or replace function app.purge_sales_retention_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_count integer;
begin
  perform 1
  from public.sales_retention_batches
  where id = p_batch_id
    and status = 'purge_ready'
    and exported_at is not null
    and email_sent_at is not null
    and purge_after is not null
    and purge_after <= now()
    and orders_object_path is not null
    and items_object_path is not null
    and payments_object_path is not null
    and manifest_object_path is not null
  for update;

  if not found then
    raise exception 'retention_batch_not_purgeable';
  end if;

  if exists (
    select 1
    from public.sales_retention_batch_orders bro
    join public.pos_tax_invoices ti on ti.order_id = bro.order_id
    where bro.batch_id = p_batch_id
  ) then
    raise exception 'retention_batch_contains_tax_invoice_order';
  end if;

  select count(*) into v_count
  from public.sales_retention_batch_orders
  where batch_id = p_batch_id;

  -- Deleting orders cascades only transaction children (items/payments/kitchen/QR etc.).
  -- Product/catalog/inventory master tables are not touched.
  delete from public.orders o
  using public.sales_retention_batch_orders bro
  where bro.batch_id = p_batch_id
    and o.id = bro.order_id
    and o.status in ('completed','cancelled');

  update public.sales_retention_batches
  set status = 'purged',
      purged_at = now(),
      purged_order_count = coalesce(v_count,0),
      last_error = null,
      updated_at = now()
  where id = p_batch_id;

  return coalesce(v_count,0);
end;
$$;

revoke all on function app.purge_sales_retention_batch(uuid) from public, anon, authenticated;
grant execute on function app.purge_sales_retention_batch(uuid) to service_role;

create or replace function app.invoke_sales_retention_worker()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, private, app, extensions, net
as $$
declare
  v_token text := encode(gen_random_bytes(32),'hex');
  v_request_id bigint;
begin
  delete from private.sales_retention_worker_tokens
  where expires_at < now() - interval '1 day' or consumed_at is not null;

  insert into private.sales_retention_worker_tokens(token_hash,expires_at)
  values (
    encode(digest(v_token,'sha256'),'hex'),
    now() + interval '5 minutes'
  );

  select net.http_post(
    url := 'https://deejlitaivfnsbwqdugy.supabase.co/functions/v1/sales-retention-worker',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('token',v_token),
    timeout_milliseconds := 5000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function app.invoke_sales_retention_worker() from public, anon, authenticated;
grant execute on function app.invoke_sales_retention_worker() to service_role;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='cpipos_sales_retention_daily' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'cpipos_sales_retention_daily',
    '35 18 * * *',
    'select app.invoke_sales_retention_worker();'
  );
end $$;
