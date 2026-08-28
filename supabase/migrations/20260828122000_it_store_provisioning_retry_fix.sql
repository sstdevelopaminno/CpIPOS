-- Preserve the first internal tenant code for idempotent Store Provisioning retries.
-- The public RPC keeps the same signature; the original implementation is wrapped
-- so a retry with the same request_id reuses the internal_code stored in the ledger.

alter function public.provision_it_store_core(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, text, text
) rename to provision_it_store_core_impl;

revoke all on function public.provision_it_store_core_impl(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;

create function public.provision_it_store_core(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_internal_code text,
  p_store_name text,
  p_owner_name text,
  p_owner_phone text,
  p_owner_email text,
  p_branch_code text,
  p_branch_name text,
  p_branch_address text,
  p_package_id uuid,
  p_contract_status text default 'trial',
  p_billing_interval text default 'monthly'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_internal_code text;
begin
  select nullif(input_payload ->> 'internal_code', '')
    into v_internal_code
  from public.it_store_provisioning_requests
  where request_key = p_request_id;

  return public.provision_it_store_core_impl(
    p_request_id,
    p_actor_user_id,
    coalesce(v_internal_code, p_internal_code),
    p_store_name,
    p_owner_name,
    p_owner_phone,
    p_owner_email,
    p_branch_code,
    p_branch_name,
    p_branch_address,
    p_package_id,
    p_contract_status,
    p_billing_interval
  );
end;
$$;

revoke all on function public.provision_it_store_core(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.provision_it_store_core(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, text, text
) to service_role;

comment on function public.provision_it_store_core(
  uuid, uuid, text, text, text, text, text, text, text, text, uuid, text, text
) is 'Service-role-only idempotent Store Provisioning wrapper. Reuses the first internal tenant code for request retries.';
