-- Bound same-table Table QR contention and harden SECURITY DEFINER name resolution.
-- Different tables/branches/tenants continue to use independent row locks.

alter function app.submit_table_qr_order_tx(uuid,text,jsonb,text)
  set search_path to pg_catalog, public, app;

alter function app.submit_table_qr_order_tx(uuid,text,jsonb,text)
  set lock_timeout to '5s';

alter function public.submit_table_qr_order_tx(uuid,text,jsonb,text)
  set search_path to pg_catalog, public, app;

alter function public.submit_table_qr_order_tx(uuid,text,jsonb,text)
  set lock_timeout to '5s';
