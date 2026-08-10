-- CpiPOS-002 automatic Trial maintenance.
-- Lock checks run hourly; 30-day retained business data is purged daily.
create extension if not exists pg_cron with schema pg_catalog;

do $$ declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='cpipos_trial_lock_hourly' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('cpipos_trial_lock_hourly','11 * * * *','select app.refresh_trial_scope_locks();');

  v_job:=null;
  select jobid into v_job from cron.job where jobname='cpipos_trial_retention_daily' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('cpipos_trial_retention_daily','25 19 * * *','select app.purge_expired_trial_data();');
end $$;
