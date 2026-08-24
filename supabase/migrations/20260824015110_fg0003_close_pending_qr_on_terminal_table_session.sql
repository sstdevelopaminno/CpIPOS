create or replace function public.fg0003_close_pending_qr_on_terminal_table_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('closed','cancelled')
     and old.status is distinct from new.status
     and exists (
       select 1
       from public.branches b
       where b.id = new.branch_id
         and b.tenant_id = new.tenant_id
         and b.code = 'FG0003-BKK-01'
     ) then
    update public.table_qr_orders q
       set review_status = 'rejected',
           reviewed_at = coalesce(q.reviewed_at, now()),
           payload = coalesce(q.payload, '{}'::jsonb)
             || jsonb_build_object(
                  'review_status', 'rejected',
                  'kitchen_status', 'not_sent',
                  'auto_closed_reason', 'table_session_terminal',
                  'auto_closed_at', now()
                )
     where q.tenant_id = new.tenant_id
       and q.branch_id = new.branch_id
       and q.table_session_id = new.id
       and q.event_type = 'order'
       and q.review_status = 'pending_pos_review';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fg0003_close_pending_qr_on_terminal_table_session on public.table_bill_sessions;
create trigger trg_fg0003_close_pending_qr_on_terminal_table_session
after update of status on public.table_bill_sessions
for each row
execute function public.fg0003_close_pending_qr_on_terminal_table_session();

update public.table_qr_orders q
   set review_status = 'rejected',
       reviewed_at = coalesce(q.reviewed_at, now()),
       payload = coalesce(q.payload, '{}'::jsonb)
         || jsonb_build_object(
              'review_status', 'rejected',
              'kitchen_status', 'not_sent',
              'auto_closed_reason', 'table_session_already_terminal',
              'auto_closed_at', now()
            )
  from public.table_bill_sessions s,
       public.branches b
 where q.table_session_id = s.id
   and q.tenant_id = s.tenant_id
   and q.branch_id = s.branch_id
   and b.id = q.branch_id
   and b.tenant_id = q.tenant_id
   and b.code = 'FG0003-BKK-01'
   and s.status in ('closed','cancelled')
   and q.event_type = 'order'
   and q.review_status = 'pending_pos_review';
