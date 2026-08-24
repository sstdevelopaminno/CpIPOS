create or replace function app.finalize_dine_in_kitchen_on_order_terminal()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','public','app','extensions'
as $function$
begin
  if new.order_type::text <> 'dine_in'
     or new.status::text not in ('completed','cancelled')
     or old.status::text = new.status::text then
    return new;
  end if;

  update public.kitchen_tickets kt
  set status = 'cancelled',
      metadata = coalesce(kt.metadata,'{}'::jsonb) || jsonb_build_object(
        'terminalized_by_order_status',new.status::text,
        'terminalized_at',now(),
        'terminalized_source','orders_terminal_trigger_v2'
      ),
      updated_at = now()
  where kt.tenant_id = new.tenant_id
    and kt.branch_id = new.branch_id
    and kt.order_id = new.id
    and kt.status in ('queued','acknowledged','preparing','ready');

  update public.print_jobs pj
  set status = 'failed',
      failed_at = coalesce(pj.failed_at,now()),
      last_error = 'TERMINAL_ORDER_PRINT_SUPERSEDED',
      claimed_by_agent_id = null,
      claimed_at = null,
      claim_expires_at = null,
      updated_at = now(),
      metadata = coalesce(pj.metadata,'{}'::jsonb) || jsonb_build_object(
        'terminalized_by_order_status',new.status::text,
        'terminalized_at',now(),
        'terminalized_source','orders_terminal_trigger_v2'
      )
  where pj.tenant_id = new.tenant_id
    and pj.branch_id = new.branch_id
    and pj.order_id = new.id
    and pj.kitchen_ticket_id is not null
    and pj.status::text in ('pending','retrying','printing');

  return new;
end;
$function$;

update public.kitchen_tickets kt
set status='cancelled',
    metadata=coalesce(kt.metadata,'{}'::jsonb)||jsonb_build_object(
      'terminalized_by_order_status',o.status::text,
      'terminalized_at',now(),
      'terminalized_source','fg0003_terminal_cleanup_backfill'
    ),
    updated_at=now()
from public.orders o
where kt.order_id=o.id
  and kt.tenant_id=o.tenant_id
  and kt.branch_id=o.branch_id
  and kt.tenant_id='2d38bd23-bf2d-4b9a-a7cf-adb2547297ed'::uuid
  and kt.branch_id='41eee367-6762-4277-bfc8-c2e9776a8ef9'::uuid
  and o.status::text in ('completed','cancelled')
  and kt.status in ('queued','acknowledged','preparing','ready');

update public.print_jobs pj
set status='failed',
    failed_at=coalesce(pj.failed_at,now()),
    last_error='TERMINAL_ORDER_PRINT_SUPERSEDED',
    claimed_by_agent_id=null,
    claimed_at=null,
    claim_expires_at=null,
    updated_at=now(),
    metadata=coalesce(pj.metadata,'{}'::jsonb)||jsonb_build_object(
      'terminalized_by_order_status',o.status::text,
      'terminalized_at',now(),
      'terminalized_source','fg0003_terminal_cleanup_backfill'
    )
from public.orders o
where pj.order_id=o.id
  and pj.tenant_id=o.tenant_id
  and pj.branch_id=o.branch_id
  and pj.tenant_id='2d38bd23-bf2d-4b9a-a7cf-adb2547297ed'::uuid
  and pj.branch_id='41eee367-6762-4277-bfc8-c2e9776a8ef9'::uuid
  and o.status::text in ('completed','cancelled')
  and pj.kitchen_ticket_id is not null
  and pj.status::text in ('pending','retrying','printing');
