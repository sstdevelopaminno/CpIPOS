-- Hot-path support for QR duplicate-submit protection.
-- The app stores client_id + payload_fingerprint in table_qr_orders.payload
-- after a successful submit, then checks the recent window before appending
-- another order for the same QR session.
create index if not exists idx_table_qr_orders_qr_session_event_created
  on public.table_qr_orders (qr_session_id, event_type, created_at desc);

create index if not exists idx_table_qr_orders_qr_session_payload_fingerprint
  on public.table_qr_orders (
    qr_session_id,
    (payload->>'client_id'),
    (payload->>'payload_fingerprint'),
    created_at desc
  )
  where event_type = 'order'
    and payload ? 'client_id'
    and payload ? 'payload_fingerprint';