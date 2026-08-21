-- P0 safety hardening for shift close and table-bill terminal transitions.
-- Prevents any shift-close path (including overdue auto-close) from orphaning active dine-in orders.

create or replace function app.enforce_shift_close_rules()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
declare
  unpaid_count integer;
  mismatch boolean;
  is_overdue_auto_close boolean;
begin
  if new.status = 'closed' and old.status <> 'closed' then
    select count(*)
      into unpaid_count
    from public.orders o
    where o.shift_id = new.id
      and o.order_type = 'dine_in'
      and o.status not in ('completed', 'cancelled');

    -- An active/unpaid dine-in order is a hard stop. Manager overrides and
    -- system overdue auto-close are deliberately not allowed to bypass this.
    if unpaid_count > 0 then
      raise exception 'SHIFT_HAS_UNPAID_DINE_IN_ORDERS';
    end if;

    mismatch := coalesce(new.expected_cash, 0) <> coalesce(new.actual_cash, 0);
    is_overdue_auto_close :=
      coalesce(new.metadata ->> 'close_reason', '') = 'system_auto_close_overdue_shift'
      and coalesce((new.metadata ->> 'overdue_auto_close')::boolean, false) = true
      and coalesce((new.metadata ->> 'cash_count_required')::boolean, true) = false;

    -- Keep the intended unattended overdue close behavior only for cash-count
    -- mismatch when there are no active/unpaid dine-in orders.
    if mismatch and not is_overdue_auto_close then
      if new.close_override_approval_id is null then
        raise exception 'Manager/owner override is required to close shift.';
      end if;

      if not exists (
        select 1
        from public.manager_pin_approvals a
        where a.id = new.close_override_approval_id
          and a.action = 'shift_close_override'
          and a.target_table = 'shifts'
          and a.target_id = new.id
          and a.expires_at > now()
      ) then
        raise exception 'Shift close override approval is invalid or expired.';
      end if;
    end if;

    new.closed_at := now();
  end if;

  return new;
end;
$$;

create or replace function app.guard_table_bill_terminal_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_order_status text;
  v_due numeric(12,2);
  v_paid numeric(12,2);
begin
  if old.status in ('open', 'ordering', 'pending_payment')
     and new.status in ('closed', 'cancelled')
     and old.order_id is not null then

    select o.status::text,
           round(coalesce(o.grand_total, o.total_amount, 0), 2),
           round(coalesce(o.paid_total, 0), 2)
      into v_order_status, v_due, v_paid
    from public.orders o
    where o.id = old.order_id
      and o.tenant_id = old.tenant_id
      and o.branch_id = old.branch_id
    for update;

    if not found then
      raise exception 'TABLE_BILL_LINKED_ORDER_NOT_FOUND';
    end if;

    if new.status = 'closed' then
      if v_order_status <> 'completed' then
        raise exception 'TABLE_BILL_ORDER_NOT_COMPLETED';
      end if;
      if abs(v_paid - v_due) > 0.01 then
        raise exception 'TABLE_BILL_PAYMENT_MISMATCH';
      end if;
    elsif new.status = 'cancelled' and v_order_status <> 'cancelled' then
      raise exception 'TABLE_BILL_ORDER_NOT_CANCELLED';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app.guard_table_bill_terminal_transition() from public, anon, authenticated;
grant execute on function app.guard_table_bill_terminal_transition() to service_role;

drop trigger if exists trg_table_bill_terminal_guard on public.table_bill_sessions;
create trigger trg_table_bill_terminal_guard
before update of status on public.table_bill_sessions
for each row
execute function app.guard_table_bill_terminal_transition();
