create or replace function public.next_pos_order_no(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_prefix text default 'TKO'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := upper(regexp_replace(coalesce(nullif(trim(p_prefix), ''), 'TKO'), '[^A-Z0-9]', '', 'g'));
  v_date text := to_char(timezone('Asia/Bangkok', now()), 'YYMMDD');
  v_base text;
  v_next integer := 1;
begin
  v_base := v_prefix || '-' || v_date || '-';

  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || p_branch_id::text || ':' || v_base));

  select coalesce(max(substring(o.order_no from length(v_base) + 1)::integer), 0) + 1
    into v_next
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.order_no like v_base || '%'
    and substring(o.order_no from length(v_base) + 1) ~ '^[0-9]+$';

  return v_base || lpad(v_next::text, 3, '0');
end;
$$;
