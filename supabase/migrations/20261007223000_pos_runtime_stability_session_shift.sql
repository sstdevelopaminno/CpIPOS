-- POS runtime stability hardening.
--
-- Session renewal is intentionally application-driven so the authoritative
-- branch-device state is checked before extending a cashier lease.
--
-- Shift auto-close remains on the existing POS close endpoint/guard path so
-- open-bill checks and tenant data-plane routing stay authoritative. A previous
-- runtime experiment briefly installed DB cron jobs; clean them up here.

alter table public.tenants
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='cpipos_shift_autoclose_1m' limit 1;
  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;

  select jobid into v_job from cron.job where jobname='cpipos_session_lease_1m' limit 1;
  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;
end $$;

drop function if exists app.auto_close_overdue_pos_shifts(timestamptz);
drop function if exists app.pos_shift_auto_close_deadline(timestamptz);
drop function if exists app.refresh_active_pos_session_leases(timestamptz, integer);
