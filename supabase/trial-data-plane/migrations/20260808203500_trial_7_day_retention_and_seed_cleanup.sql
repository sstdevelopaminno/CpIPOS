-- CpiPOS-002 Trial Data Plane baseline.
-- Trial access = 7 days. Trial business data retention = 30 days from trial start.
-- CpiPOS-001 remains the control plane and the only authority allowed to activate/unlock.

alter table public.trial_tenant_scopes
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_expires_at timestamptz,
  add column if not exists retention_until timestamptz,
  add column if not exists access_locked boolean not null default true,
  add column if not exists lock_reason text;

create or replace function app.set_trial_scope_window(p_tenant_id uuid,p_started_at timestamptz)
returns void language plpgsql security definer set search_path=public,app as $$
begin
  if p_started_at is null then raise exception 'trial_started_at_required'; end if;
  update public.trial_tenant_scopes
  set lifecycle_status='trial',trial_started_at=p_started_at,trial_expires_at=p_started_at+interval '7 days',retention_until=p_started_at+interval '30 days',access_locked=false,lock_reason=null,synced_at=now()
  where tenant_id=p_tenant_id;
  if not found then raise exception 'trial_scope_not_found'; end if;
end;$$;
revoke all on function app.set_trial_scope_window(uuid,timestamptz) from public,anon,authenticated;
grant execute on function app.set_trial_scope_window(uuid,timestamptz) to service_role;

create or replace function app.refresh_trial_scope_locks()
returns integer language plpgsql security definer set search_path=public,app as $$
declare v_count integer:=0;
begin
  update public.trial_tenant_scopes set lifecycle_status='expired',access_locked=true,lock_reason='trial_expired',synced_at=now()
  where lifecycle_status='trial' and access_locked=false and trial_expires_at is not null and trial_expires_at<=now();
  get diagnostics v_count=row_count;
  return v_count;
end;$$;
revoke all on function app.refresh_trial_scope_locks() from public,anon,authenticated;
grant execute on function app.refresh_trial_scope_locks() to service_role;

create or replace function app.purge_expired_trial_data()
returns integer language plpgsql security definer set search_path=public,app as $$
declare v_count integer:=0;
begin
  with due as (
    select tenant_id from public.trial_tenant_scopes where retention_until is not null and retention_until<=now() for update
  ), deleted as (
    delete from public.trial_branch_scopes b using due d where b.tenant_id=d.tenant_id returning b.tenant_id
  )
  select count(distinct tenant_id)::integer into v_count from deleted;

  update public.trial_tenant_scopes
  set lifecycle_status='expired',access_locked=true,lock_reason='trial_data_retention_expired',synced_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('business_data_purged_at',now())
  where retention_until is not null and retention_until<=now();
  return v_count;
end;$$;
revoke all on function app.purge_expired_trial_data() from public,anon,authenticated;
grant execute on function app.purge_expired_trial_data() to service_role;

-- Retire BBQ completely. legacy_code is metadata on the Trial scope.
delete from public.trial_tenant_scopes where metadata->>'legacy_code'='BBQ-TH-002';

-- Convert TEST into a clean customer seed. Delete branch scopes to cascade all copied QA business rows;
-- manual provisioning will seed the real branch scope when IT activates the Trial.
do $$ declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.trial_tenant_scopes where metadata->>'legacy_code'='TEST-TH-003';
  if v_tenant is not null then
    delete from public.trial_branch_scopes where tenant_id=v_tenant;
    update public.trial_tenant_scopes
    set lifecycle_status='trial',trial_started_at=null,trial_expires_at=null,retention_until=null,
        access_locked=true,lock_reason='awaiting_manual_trial_activation',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('customer_seed',true,'public_store_code','100001','qa_data_cleared_at',now()),
        synced_at=now()
    where tenant_id=v_tenant;
  end if;
end $$;
