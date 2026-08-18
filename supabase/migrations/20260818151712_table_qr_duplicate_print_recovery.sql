create or replace function public.submit_table_qr_order_tx(
  p_qr_session_id uuid,
  p_request_id text,
  p_items jsonb,
  p_note text default null
)
returns table(
  submission_id uuid,
  order_id uuid,
  order_no text,
  table_id uuid,
  table_session_id uuid,
  subtotal numeric,
  tax_total numeric,
  grand_total numeric,
  duplicate_request boolean
)
language sql
security definer
set search_path = 'pg_catalog','public','app'
set lock_timeout = '5s'
as $function$
  with result as (
    select * from app.submit_table_qr_order_tx($1,$2,$3,$4)
  )
  select
    r.submission_id,
    r.order_id,
    r.order_no,
    r.table_id,
    r.table_session_id,
    r.subtotal,
    r.tax_total,
    r.grand_total,
    case
      when not r.duplicate_request then false
      when exists (
        select 1
        from public.table_qr_sessions qs
        join public.kitchen_tickets kt
          on kt.tenant_id = qs.tenant_id
         and kt.branch_id = qs.branch_id
         and kt.order_id = r.order_id
        where qs.id = p_qr_session_id
          and not exists (
            select 1
            from public.print_jobs pj
            where pj.tenant_id = kt.tenant_id
              and pj.branch_id = kt.branch_id
              and pj.kitchen_ticket_id = kt.id
          )
      ) then false
      else true
    end as duplicate_request
  from result r;
$function$;

revoke all on function public.submit_table_qr_order_tx(uuid,text,jsonb,text) from public;
grant execute on function public.submit_table_qr_order_tx(uuid,text,jsonb,text) to service_role;
