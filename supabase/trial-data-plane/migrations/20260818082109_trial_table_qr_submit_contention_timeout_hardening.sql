-- Trial parity: bound same-table Table QR contention without introducing a branch/store-wide mutex.

alter function app.submit_table_qr_order_tx(uuid,text,jsonb,text)
  set search_path to pg_catalog, public, app, extensions;

alter function app.submit_table_qr_order_tx(uuid,text,jsonb,text)
  set lock_timeout to '5s';

alter function public.submit_table_qr_order_tx(uuid,text,jsonb,text)
  set search_path to pg_catalog, public, app, extensions;

alter function public.submit_table_qr_order_tx(uuid,text,jsonb,text)
  set lock_timeout to '5s';
