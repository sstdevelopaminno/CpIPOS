-- Trial mirror: hot-path support for QR duplicate-submit protection.
create index if not exists idx_trial_table_qr_orders_qr_session_event_created
  on public.table_qr_orders (qr_session_id, event_type, created_at desc);

create index if not exists idx_trial_table_qr_orders_qr_session_payload_fingerprint
  on public.table_qr_orders (
    qr_session_id,
    (payload->>'client_id'),
    (payload->>'payload_fingerprint'),
    created_at desc
  )
  where event_type = 'order'
    and payload ? 'client_id'
    and payload ? 'payload_fingerprint';