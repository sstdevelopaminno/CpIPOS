create or replace function public.cleanup_pos_runtime_data(
  p_login_attempt_days integer default 30,
  p_perf_event_days integer default 30,
  p_audit_log_days integer default 180
)
returns table(area text, deleted_rows bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  delete from public.pos_login_contexts
  where status <> 'active'
     or expires_at < now();
  get diagnostics v_count = row_count;
  area := 'pos_login_contexts_expired_or_consumed';
  deleted_rows := v_count;
  return next;

  delete from public.login_attempts
  where created_at < now() - make_interval(days => greatest(p_login_attempt_days, 1));
  get diagnostics v_count = row_count;
  area := 'login_attempts_old';
  deleted_rows := v_count;
  return next;

  delete from public.table_management_perf_events
  where created_at < now() - make_interval(days => greatest(p_perf_event_days, 1));
  get diagnostics v_count = row_count;
  area := 'table_management_perf_events_old';
  deleted_rows := v_count;
  return next;

  delete from public.mobile_push_subscriptions
  where status <> 'active';
  get diagnostics v_count = row_count;
  area := 'mobile_push_subscriptions_inactive';
  deleted_rows := v_count;
  return next;

  delete from public.pos_qr_login_tokens
  where status <> 'active'
     or expires_at < now();
  get diagnostics v_count = row_count;
  area := 'pos_qr_login_tokens_inactive_or_expired';
  deleted_rows := v_count;
  return next;

  delete from public.activation_tokens
  where status <> 'active'
     or expires_at < now();
  get diagnostics v_count = row_count;
  area := 'activation_tokens_inactive_or_expired';
  deleted_rows := v_count;
  return next;

  delete from public.audit_logs
  where created_at < now() - make_interval(days => greatest(p_audit_log_days, 30));
  get diagnostics v_count = row_count;
  area := 'audit_logs_old';
  deleted_rows := v_count;
  return next;
end;
$$;
