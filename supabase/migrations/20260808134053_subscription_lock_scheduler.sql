-- Automatic expiry locking. This job is allowed to LOCK only; it never unlocks.
create extension if not exists pg_cron with schema pg_catalog;

do $$ declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='cpipos_subscription_lock_hourly' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('cpipos_subscription_lock_hourly','7 * * * *','select app.refresh_subscription_locks();');
end $$;
