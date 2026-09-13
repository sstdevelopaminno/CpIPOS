-- Keep catalog deletion as a reversible soft-delete while preserving historical sales/bills.
-- The backoffice catalog API already writes these fields; production previously lacked them
-- and had to retry every delete/deactivate with an is_active-only fallback.

alter table public.products
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null,
  add column if not exists delete_reason text null,
  add column if not exists restore_until timestamptz null;

create index if not exists products_restore_until_idx
  on public.products (restore_until)
  where is_active = false and restore_until is not null;

comment on column public.products.deleted_at is
  'Soft-delete timestamp. Historical sales and bill rows are retained.';
comment on column public.products.deleted_by is
  'Actor UUID that soft-deleted the product, when available.';
comment on column public.products.delete_reason is
  'Application reason for soft deletion/deactivation.';
comment on column public.products.restore_until is
  'Optional trash retention deadline used by catalog restore workflows.';
