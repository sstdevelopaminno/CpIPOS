-- FG0003 QR -> POS -> Kitchen review lifecycle hardening.
-- Source-only migration for pre-deployment review; do not apply until targeted checks pass.

alter table public.table_qr_orders
  add column if not exists review_status text;

update public.table_qr_orders
set review_status = coalesce(
  nullif(payload->>'review_status', ''),
  case
    when event_type = 'order' and order_id is null then 'pending_pos_review'
    when event_type = 'order' then 'accepted'
    else null
  end
)
where review_status is null;

alter table public.table_qr_orders
  alter column review_status set default 'accepted';

alter table public.table_qr_orders
  drop constraint if exists table_qr_orders_review_status_check;

alter table public.table_qr_orders
  add constraint table_qr_orders_review_status_check
  check (
    review_status is null
    or review_status in ('pending_pos_review', 'kitchen_confirming', 'accepted', 'partially_accepted', 'rejected')
  );

alter table public.table_qr_orders
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists kitchen_submission_id uuid;

create index if not exists idx_table_qr_orders_pending_pos_review
  on public.table_qr_orders (tenant_id, branch_id, table_id, table_session_id, created_at desc)
  where event_type = 'order' and review_status = 'pending_pos_review';

create unique index if not exists idx_table_qr_orders_kitchen_submission_once
  on public.table_qr_orders (tenant_id, branch_id, kitchen_submission_id)
  where kitchen_submission_id is not null;