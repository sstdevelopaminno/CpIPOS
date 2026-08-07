-- Target hot relationship lookups observed in POS/table/shift workflows.
-- Additive indexes only; no data or business-rule changes.

create index if not exists idx_orders_shift_open_dine_in
  on public.orders (shift_id)
  where order_type = 'dine_in'
    and status not in ('completed', 'cancelled');

create index if not exists idx_table_qr_orders_order_id
  on public.table_qr_orders (order_id)
  where order_id is not null;

create index if not exists idx_table_bill_sessions_order_id
  on public.table_bill_sessions (order_id)
  where order_id is not null;
