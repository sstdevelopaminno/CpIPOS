-- FG0003 kitchen/QR/receipt hardening.
-- 1) Let staff cancel every active queued dine-in line after KDS acceptance while keeping tenant/branch locks.
-- 2) Keep customer QR submitted summary synchronized with zero-total cancelled bills.
-- 3) Prioritize receipt/payment notice jobs ahead of kitchen jobs for immediate payment flows.

-- P0 fix for queued dine-in order replacement.
-- 1) Keep already-sold inactive catalog products editable when they are already on the bill.
-- 2) Backfill newly inserted order_item ids into the desired-state table before cancellation/kitchen routing.
--    This prevents newly inserted replacements from being cancelled in the same transaction.

create or replace function app.replace_queued_dine_in_order_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid,
  p_actor_user_id uuid,
  p_order_id uuid,
  p_table_id uuid,
  p_items jsonb,
  p_app_total_amount numeric,
  p_discount_amount numeric default 0,
  p_gp_amount numeric default 0,
  p_tax_total numeric default 0,
  p_grand_total numeric default null,
  p_tax_lines jsonb default '[]'::jsonb
)
returns table(
  order_id uuid,
  order_no text,
  order_status text,
  created_at timestamptz,
  total_amount numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_session public.table_bill_sessions%rowtype;
  v_order public.orders%rowtype;
  v_subtotal numeric(12,2) := round(coalesce(p_app_total_amount, 0), 2);
  v_total numeric(12,2) := round(
    coalesce(
      p_grand_total,
      p_app_total_amount - coalesce(p_discount_amount, 0) - coalesce(p_gp_amount, 0) + coalesce(p_tax_total, 0)
    ),
    2
  );
  v_item_count numeric := 0;
  v_add_item_ids uuid[] := array[]::uuid[];
  v_cancel_item_ids uuid[] := array[]::uuid[];
  v_event_hash text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ITEMS_REQUIRED';
  end if;

  select *
    into v_session
  from public.table_bill_sessions s
  where s.tenant_id = p_tenant_id
    and s.branch_id = p_branch_id
    and s.table_id = p_table_id
    and s.status in ('open', 'ordering')
    and s.closed_at is null
  order by s.opened_at desc
  limit 1
  for update;

  if not found then raise exception 'TABLE_BILL_NOT_OPEN'; end if;
  if v_session.order_id is not null and v_session.order_id <> p_order_id then
    raise exception 'TABLE_BILL_ORDER_CONFLICT';
  end if;

  select *
    into v_order
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.id = p_order_id
    and o.table_id = p_table_id
  for update;

  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'queued' then raise exception 'ORDER_NOT_QUEUED'; end if;
  if v_order.order_type <> 'dine_in' then raise exception 'ORDER_NOT_DINE_IN'; end if;

  if not exists (
    select 1
    from public.shifts sh
    where sh.id = p_shift_id
      and sh.tenant_id = p_tenant_id
      and sh.branch_id = p_branch_id
      and sh.status = 'open'
  ) then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  create temporary table if not exists pg_temp.dine_in_target_items(
    product_id uuid not null,
    notes text,
    quantity numeric(12,3) not null,
    unit_price numeric(12,2) not null,
    line_total numeric(12,2) not null,
    product_name text,
    product_active boolean not null,
    order_item_id uuid,
    existing_quantity numeric(12,3),
    delta numeric(12,3)
  ) on commit drop;

  truncate table pg_temp.dine_in_target_items;

  insert into pg_temp.dine_in_target_items(
    product_id, notes, quantity, unit_price, line_total, product_name, product_active
  )
  with normalized_items as (
    select
      nullif(value->>'product_id', '')::uuid as product_id,
      nullif(left(trim(coalesce(value->>'notes', value->>'note', '')), 240), '') as notes,
      sum(nullif(value->>'quantity', '')::numeric) as quantity,
      max(nullif(value->>'unit_price', '')::numeric) as unit_price
    from jsonb_array_elements(p_items) value
    group by 1, 2
  )
  select
    p.id,
    ni.notes,
    ni.quantity,
    coalesce(ni.unit_price, p.price),
    round(ni.quantity * coalesce(ni.unit_price, p.price), 2),
    p.name,
    p.is_active
  from normalized_items ni
  join public.products p
    on p.id = ni.product_id
   and p.tenant_id = p_tenant_id
   and p.branch_id = p_branch_id
  where ni.product_id is not null
    and ni.quantity > 0
    and ni.quantity <= 999;

  select coalesce(sum(quantity), 0)
    into v_item_count
  from pg_temp.dine_in_target_items;

  -- Empty desired item arrays are allowed when staff cancels every active dine-in line.
  -- The transaction still keeps the queued table bill open and synchronizes QR totals to zero.

  -- Bind desired rows to existing active bill lines first. This intentionally
  -- permits a product that was deactivated after it was already sold.
  update pg_temp.dine_in_target_items ti
  set order_item_id = oi.id,
      existing_quantity = oi.quantity,
      delta = ti.quantity - oi.quantity
  from public.order_items oi
  where oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id
    and oi.product_id = ti.product_id
    and coalesce(oi.notes, '') = coalesce(ti.notes, '')
    and oi.quantity > 0
    and coalesce(oi.metadata->>'bill_line_state', 'active') <> 'cancelled';

  -- Inactive products may remain only when they are already present on this bill.
  if exists (
    select 1
    from pg_temp.dine_in_target_items ti
    where ti.product_active = false
      and ti.order_item_id is null
  ) then
    raise exception 'PRODUCT_NOT_AVAILABLE';
  end if;

  update public.order_items oi
  set quantity = ti.quantity,
      unit_price = ti.unit_price,
      line_total = ti.line_total,
      notes = ti.notes,
      name = coalesce(ti.product_name, oi.name),
      metadata = (
        coalesce(oi.metadata, '{}'::jsonb)
        - 'bill_line_state'
        - 'kitchen_delta_quantity'
        - 'kitchen_delta_kind'
      ) || jsonb_build_object('pos_edit_updated_at', now())
  from pg_temp.dine_in_target_items ti
  where ti.order_item_id = oi.id
    and oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id;

  -- Insert missing desired rows and immediately bind their generated ids back
  -- into the desired-state table. Without this, the cancellation phase can
  -- mistake these freshly inserted rows for removed lines.
  with inserted as (
    insert into public.order_items(
      tenant_id, branch_id, order_id, product_id, quantity,
      unit_price, line_total, notes, name, metadata
    )
    select
      p_tenant_id,
      p_branch_id,
      p_order_id,
      ti.product_id,
      ti.quantity,
      ti.unit_price,
      ti.line_total,
      ti.notes,
      ti.product_name,
      jsonb_build_object('source', 'pos_dine_in_edit')
    from pg_temp.dine_in_target_items ti
    where ti.order_item_id is null
    returning id, product_id, notes
  )
  update pg_temp.dine_in_target_items ti
  set order_item_id = i.id,
      existing_quantity = 0,
      delta = ti.quantity
  from inserted i
  where ti.order_item_id is null
    and ti.product_id = i.product_id
    and coalesce(ti.notes, '') = coalesce(i.notes, '');

  -- Any target row must now be bound to exactly one persisted order item.
  if exists (
    select 1 from pg_temp.dine_in_target_items where order_item_id is null
  ) then
    raise exception 'DINE_IN_TARGET_ITEM_BIND_FAILED';
  end if;

  update public.order_items oi
  set metadata = coalesce(oi.metadata, '{}'::jsonb)
      || jsonb_build_object('kitchen_delta_quantity', ti.delta, 'kitchen_delta_kind', 'add')
  from pg_temp.dine_in_target_items ti
  where ti.order_item_id = oi.id
    and ti.delta > 0
    and oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id;

  select coalesce(array_agg(order_item_id order by order_item_id), array[]::uuid[])
    into v_add_item_ids
  from pg_temp.dine_in_target_items
  where order_item_id is not null
    and delta > 0;

  if coalesce(array_length(v_add_item_ids, 1), 0) > 0 then
    select md5(string_agg(id::text || ':' || (metadata->>'kitchen_delta_quantity'), ',' order by id))
      into v_event_hash
    from public.order_items
    where id = any(v_add_item_ids);

    perform *
    from app.enqueue_kitchen_order(
      p_tenant_id,
      p_branch_id,
      p_order_id,
      'order:' || p_order_id::text || ':pos-edit:add:' || v_event_hash,
      'add',
      v_add_item_ids
    );

    update public.order_items
    set metadata = metadata - 'kitchen_delta_quantity' - 'kitchen_delta_kind'
    where id = any(v_add_item_ids);
  end if;

  -- Cancel only persisted rows that existed outside the complete desired set.
  update public.order_items oi
  set quantity = 0,
      line_total = 0,
      metadata = coalesce(oi.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'bill_line_state', 'cancelled',
          'cancelled_quantity', oi.quantity,
          'kitchen_delta_quantity', oi.quantity,
          'kitchen_delta_kind', 'cancel',
          'pos_edit_cancelled_at', now()
        )
  where oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id
    and oi.quantity > 0
    and coalesce(oi.metadata->>'bill_line_state', 'active') <> 'cancelled'
    and not exists (
      select 1
      from pg_temp.dine_in_target_items ti
      where ti.order_item_id = oi.id
    );

  update public.order_items oi
  set metadata = coalesce(oi.metadata, '{}'::jsonb)
      || jsonb_build_object('kitchen_delta_quantity', abs(ti.delta), 'kitchen_delta_kind', 'cancel')
  from pg_temp.dine_in_target_items ti
  where ti.order_item_id = oi.id
    and ti.delta < 0
    and oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id;

  select coalesce(array_agg(oi.id order by oi.id), array[]::uuid[])
    into v_cancel_item_ids
  from public.order_items oi
  where oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id
    and oi.metadata->>'kitchen_delta_kind' = 'cancel'
    and coalesce((oi.metadata->>'kitchen_delta_quantity')::numeric, 0) > 0;

  if coalesce(array_length(v_cancel_item_ids, 1), 0) > 0 then
    select md5(string_agg(id::text || ':' || (metadata->>'kitchen_delta_quantity'), ',' order by id))
      into v_event_hash
    from public.order_items
    where id = any(v_cancel_item_ids);

    perform *
    from app.enqueue_kitchen_order(
      p_tenant_id,
      p_branch_id,
      p_order_id,
      'order:' || p_order_id::text || ':pos-edit:cancel:' || v_event_hash,
      'cancel',
      v_cancel_item_ids
    );

    update public.order_items
    set metadata = metadata - 'kitchen_delta_quantity' - 'kitchen_delta_kind'
    where id = any(v_cancel_item_ids);
  end if;

  update public.orders o
  set shift_id = p_shift_id,
      subtotal = v_subtotal,
      discount_amount = coalesce(p_discount_amount, 0),
      gp_amount = coalesce(p_gp_amount, 0),
      total_amount = v_total,
      tax_total = coalesce(p_tax_total, 0),
      grand_total = v_total,
      metadata = coalesce(o.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'tax_lines', coalesce(p_tax_lines, '[]'::jsonb),
          'updated_from', 'pos_dine_in_rpc'
        ),
      updated_at = now()
  where o.id = p_order_id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.status = 'queued'
  returning * into v_order;

  if not found then raise exception 'ORDER_NOT_QUEUED'; end if;

  update public.table_bill_sessions s
  set order_id = p_order_id,
      status = 'ordering',
      metadata = coalesce(s.metadata, '{}'::jsonb)
        || jsonb_build_object('last_order_id', p_order_id, 'last_order_no', v_order.order_no),
      updated_at = now()
  where s.id = v_session.id;

  return query
  select v_order.id, v_order.order_no, v_order.status::text, v_order.created_at, v_order.total_amount;
end;
$$;

revoke all on function app.replace_queued_dine_in_order_tx(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,numeric,numeric,numeric,numeric,jsonb) from public, anon, authenticated;
grant execute on function app.replace_queued_dine_in_order_tx(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,numeric,numeric,numeric,numeric,jsonb) to service_role;

create or replace function app.claim_print_jobs_v2(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_agent_id uuid,
  p_printer_ids uuid[],
  p_limit integer default 5,
  p_lease_seconds integer default 45
)
returns table(job_id uuid, agent_attempt_id text, attempt_no integer, claim_expires_at timestamptz)
language plpgsql
security definer
set search_path to pg_catalog, public, app, extensions
as $$
declare
  v_limit integer := least(10, greatest(1, coalesce(p_limit, 5)));
  v_lease_seconds integer := least(300, greatest(15, coalesce(p_lease_seconds, 45)));
  v_now timestamptz := now();
  v_now_epoch_ms numeric := floor(extract(epoch from v_now) * 1000);
  v_expires timestamptz;
  v_job public.print_jobs%rowtype;
  v_expired public.print_jobs%rowtype;
  v_attempt_id text;
  v_attempt_no integer;
  v_next_retry integer;
  v_effective_max_retry integer;
  v_retry_delay_seconds integer;
  v_retry_after timestamptz;
begin
  if p_tenant_id is null or p_branch_id is null or p_agent_id is null then
    raise exception 'PRINT_SCOPE_REQUIRED';
  end if;

  -- Expired leases are retryable failures too. Apply the same durable spacing as explicit
  -- agent failures so a temporarily slow/offline device is not hammered immediately.
  for v_expired in
    select pj.*
    from public.print_jobs pj
    where pj.tenant_id = p_tenant_id
      and pj.branch_id = p_branch_id
      and pj.status = 'printing'
      and pj.claim_expires_at is not null
      and pj.claim_expires_at <= v_now
    order by pj.claim_expires_at, pj.created_at
    for update skip locked
  loop
    if v_expired.agent_attempt_id is not null then
      update public.print_job_attempts a
      set
        status = 'expired',
        completed_at = coalesce(a.completed_at, v_now),
        error_code = coalesce(a.error_code, 'lease_expired'),
        error_message = coalesce(a.error_message, 'Print worker lease expired before ACK.'),
        metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object('lease_expired_at', v_now),
        updated_at = v_now
      where a.tenant_id = p_tenant_id
        and a.branch_id = p_branch_id
        and a.print_job_id = v_expired.id
        and a.agent_attempt_id = v_expired.agent_attempt_id
        and a.status = 'claimed';
    end if;

    v_next_retry := coalesce(v_expired.retry_count, 0) + 1;
    v_effective_max_retry := greatest(
      coalesce(v_expired.max_retry_count, 0),
      case when v_expired.printer_role = 'kitchen' then 7 else coalesce(v_expired.max_retry_count, 0) end
    );
    v_retry_delay_seconds := case
      when v_next_retry <= 1 then 5
      when v_next_retry = 2 then 15
      when v_next_retry = 3 then 45
      when v_next_retry = 4 then 120
      when v_next_retry = 5 then 300
      else 600
    end;
    v_retry_after := v_now + make_interval(secs => v_retry_delay_seconds);

    update public.print_jobs pj
    set
      status = case
        when v_next_retry < v_effective_max_retry then 'retrying'::public.print_job_status
        else 'failed'::public.print_job_status
      end,
      retry_count = v_next_retry,
      max_retry_count = v_effective_max_retry,
      claimed_by_agent_id = null,
      claimed_at = null,
      claim_expires_at = null,
      agent_attempt_id = null,
      agent_error_code = 'lease_expired',
      last_error = 'Print worker lease expired before ACK.',
      failed_at = case when v_next_retry < v_effective_max_retry then null else v_now end,
      metadata = coalesce(pj.metadata, '{}'::jsonb) || case
        when v_next_retry < v_effective_max_retry then jsonb_build_object(
          'retry_policy', 'durable_v1',
          'retry_backoff_seconds', v_retry_delay_seconds,
          'retry_after_epoch_ms', floor(extract(epoch from v_retry_after) * 1000)
        )
        else jsonb_build_object(
          'retry_policy', 'durable_v1',
          'retry_backoff_seconds', null,
          'retry_after_epoch_ms', null
        )
      end,
      updated_at = v_now
    where pj.id = v_expired.id
      and pj.tenant_id = p_tenant_id
      and pj.branch_id = p_branch_id;
  end loop;

  if coalesce(array_length(p_printer_ids, 1), 0) = 0 then
    return;
  end if;

  for v_job in
    select pj.*
    from public.print_jobs pj
    join public.printer_profiles pp
      on pp.id = pj.printer_id
     and pp.tenant_id = pj.tenant_id
     and pp.branch_id = pj.branch_id
     and pp.enabled = true
    where pj.tenant_id = p_tenant_id
      and pj.branch_id = p_branch_id
      and pj.status in ('pending', 'retrying')
      and pj.retry_count < pj.max_retry_count
      and (
        pj.status = 'pending'
        or coalesce(jsonb_typeof(pj.metadata->'retry_after_epoch_ms'), 'null') <> 'number'
        or (pj.metadata->>'retry_after_epoch_ms')::numeric <= v_now_epoch_ms
      )
      and pp.id = any(p_printer_ids)
      and (
        pp.printer_role = pj.printer_role
        or (
          pj.printer_role = 'kitchen'
          and coalesce(pj.metadata->>'routing_source', '') = 'assignment'
          and coalesce(pj.metadata->>'routing_purpose', '') = 'kitchen'
          and nullif(btrim(coalesce(pj.metadata->>'routing_printer_device_id', '')), '') is not null
          and exists (
            select 1
            from public.printer_device_assignments pda
            join public.printer_devices pd
              on pd.id = pda.printer_device_id
             and pd.tenant_id = pda.tenant_id
             and pd.branch_id = pda.branch_id
            where pda.tenant_id = pj.tenant_id
              and pda.branch_id = pj.branch_id
              and pda.is_enabled = true
              and pda.purpose::text = 'kitchen'
              and pda.printer_device_id::text = pj.metadata->>'routing_printer_device_id'
              and pd.is_active = true
              and pd.printer_profile_id = pp.id
              and coalesce(pd.capabilities->>'kitchen', 'false') = 'true'
              and (
                nullif(btrim(coalesce(pda.zone_key, '')), '') is null
                or nullif(btrim(coalesce(pda.zone_key, '')), '') = nullif(btrim(coalesce(pj.metadata->>'routing_zone_key', '')), '')
              )
          )
        )
      )
    order by
      case
        when coalesce(pj.metadata->>'command', '') = 'open_cash_drawer' then 0
        when pj.printer_role = 'receipt' and coalesce(pj.metadata->>'document_type', '') in ('payment_notice', 'sales_receipt', 'receipt') then 1
        when pj.printer_role = 'receipt' and coalesce(pj.metadata->>'request_source', '') in ('pos_payment', 'pos_payment_notice', 'pos_receipt_modal', 'receipt_history_reprint') then 1
        when pj.printer_role = 'receipt' then 2
        when pj.printer_role = 'kitchen' then 3
        else 4
      end,
      pj.created_at,
      pj.id
    for update of pj skip locked
    limit v_limit
  loop
    select coalesce(max(a.attempt_no), 0) + 1
      into v_attempt_no
    from public.print_job_attempts a
    where a.print_job_id = v_job.id;

    v_attempt_id := gen_random_uuid()::text;
    v_expires := v_now + make_interval(secs => v_lease_seconds);

    update public.print_jobs pj
    set
      status = 'printing',
      claimed_by_agent_id = p_agent_id,
      claimed_at = v_now,
      claim_expires_at = v_expires,
      agent_attempt_id = v_attempt_id,
      agent_error_code = null,
      failed_at = null,
      updated_at = v_now
    where pj.id = v_job.id
      and pj.tenant_id = p_tenant_id
      and pj.branch_id = p_branch_id;

    insert into public.print_job_attempts(
      tenant_id,
      branch_id,
      print_job_id,
      agent_id,
      agent_attempt_id,
      attempt_no,
      status,
      lease_expires_at,
      claimed_at,
      metadata
    ) values (
      p_tenant_id,
      p_branch_id,
      v_job.id,
      p_agent_id,
      v_attempt_id,
      v_attempt_no,
      'claimed',
      v_expires,
      v_now,
      jsonb_build_object('source', 'app.claim_print_jobs_v2')
    );

    job_id := v_job.id;
    agent_attempt_id := v_attempt_id;
    attempt_no := v_attempt_no;
    claim_expires_at := v_expires;
    return next;
  end loop;
end;
$$;
