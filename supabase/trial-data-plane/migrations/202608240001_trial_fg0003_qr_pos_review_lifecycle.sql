-- Trial data plane mirror for FG0003 QR -> POS -> Kitchen review lifecycle hardening.
-- Cutover is scoped to FG0003 only. Other tenants keep legacy QR behavior.

alter table public.table_qr_orders
  add column if not exists review_status text;

-- Historical FG0003 rows must not surface as new pending reviews after rollout.
update public.table_qr_orders
set review_status = 'accepted'
where review_status is null
  and tenant_id = '2d38bd23-bf2d-4b9a-a7cf-adb2547297ed'::uuid
  and branch_id = '41eee367-6762-4277-bfc8-c2e9776a8ef9'::uuid
  and event_type = 'order';

-- Keep NULL as the default for all other stores so their existing QR activity
-- semantics remain unchanged. FG0003 new submissions explicitly write
-- pending_pos_review in application code.
alter table public.table_qr_orders
  alter column review_status drop default;

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
