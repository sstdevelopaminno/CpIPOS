# Proposed Mobile Dine-In RPC

Status: proposal only. Apply through the shared CpIPOS/Supabase migration flow before relying on fully atomic Mobile dine-in checkout in production.

Mobile now calls these functions first and falls back to guarded table writes when the functions are not present:

- `public.mobile_dine_in_hold_bill(uuid, uuid, uuid, uuid, text, uuid, text, numeric, uuid, integer, integer, jsonb)`
- `public.mobile_dine_in_checkout_bill(uuid, uuid, uuid, uuid, text, uuid, text, numeric, uuid, integer, integer, jsonb, text, numeric, text)`

Required behavior:

1. Validate tenant, branch, `pos_sessions`, open `shifts`, order scope, and active `table_bill_sessions` in the same transaction.
2. Refuse writes when the table session is no longer active or does not point to the requested order.
3. Replace `order_items`, recompute totals, and preserve `orders.metadata.table_session_id` / `table_bill_sessions.metadata.opened_shift_id`.
4. Checkout must deduct recipe stock, insert one paid `payments` row, complete the order, close the table session, and release the table inside one database transaction.
5. Raise existing app-readable messages where possible: `draft_order_not_found`, `table_session_not_active`, `product_not_available`, `empty_cart`, `cash_not_enough`, `order_already_paid`, `INSUFFICIENT_STOCK`.

Sketch:

```sql
-- Implement in public only if the project exposes functions through PostgREST.
-- Revoke PUBLIC and grant only the roles used by server/API calls.

create or replace function public.mobile_dine_in_hold_bill(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_session_id uuid,
  p_user_id uuid,
  p_device_code text,
  p_order_id uuid,
  p_discount_mode text default 'amount',
  p_discount_value numeric default 0,
  p_member_id uuid default null,
  p_member_points integer default 0,
  p_member_stamps integer default 0,
  p_items jsonb default '[]'::jsonb
)
returns table(order_id uuid, order_no text, total numeric)
language plpgsql
security invoker
as $$
begin
  -- Validate session + open shift.
  -- Lock the draft order and active table session with FOR UPDATE.
  -- Replace order_items from p_items, compute subtotal/discount/total.
  -- Update orders totals/metadata and table_bill_sessions status/order metadata.
  -- Return the saved order id/no/total.
  -- Body intentionally omitted in this proposal document; implement with row locks and validation above.
end;
$$;

create or replace function public.mobile_dine_in_checkout_bill(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_session_id uuid,
  p_user_id uuid,
  p_device_code text,
  p_order_id uuid,
  p_discount_mode text default 'amount',
  p_discount_value numeric default 0,
  p_member_id uuid default null,
  p_member_points integer default 0,
  p_member_stamps integer default 0,
  p_items jsonb default '[]'::jsonb,
  p_payment_method text default 'cash',
  p_cash_received numeric default null,
  p_reference_no text default null
)
returns table(order_id uuid, order_no text, total numeric, payment_method text)
language plpgsql
security invoker
as $$
begin
  -- Call/inline the hold calculation in the same transaction.
  -- Check duplicate paid payment for p_order_id.
  -- Call public.deduct_order_recipe_stock with p_order_type = 'dine_in'.
  -- Insert payments.status = 'paid'.
  -- Update orders.status = 'completed'.
  -- Close table_bill_sessions and set dining_tables.status = 'available'.
  -- Return order id/no/total/payment method.
  -- Body intentionally omitted in this proposal document; implement with row locks and validation above.
end;
$$;

revoke all on function public.mobile_dine_in_hold_bill(uuid, uuid, uuid, uuid, text, uuid, text, numeric, uuid, integer, integer, jsonb) from public;
revoke all on function public.mobile_dine_in_checkout_bill(uuid, uuid, uuid, uuid, text, uuid, text, numeric, uuid, integer, integer, jsonb, text, numeric, text) from public;
grant execute on function public.mobile_dine_in_hold_bill(uuid, uuid, uuid, uuid, text, uuid, text, numeric, uuid, integer, integer, jsonb) to authenticated, service_role;
grant execute on function public.mobile_dine_in_checkout_bill(uuid, uuid, uuid, uuid, text, uuid, text, numeric, uuid, integer, integer, jsonb, text, numeric, text) to authenticated, service_role;
```