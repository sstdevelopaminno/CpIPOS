-- Trial print_jobs.status is text + CHECK, while Primary uses
-- public.print_job_status. A copied Primary implementation of
-- app.claim_print_jobs_v2 retained two enum casts in the expired-lease path,
-- causing recovery to fail with:
--   type "public.print_job_status" does not exist
--
-- Patch only the Trial/text variant. Primary (enum-backed) is unchanged.

do $$
declare
  v_def text;
begin
  if to_regtype('public.print_job_status') is null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'print_jobs'
         and column_name = 'status'
         and data_type = 'text'
     ) then
    select pg_get_functiondef(
      'app.claim_print_jobs_v2(uuid,uuid,uuid,uuid[],integer,integer)'::regprocedure
    ) into v_def;

    v_def := replace(
      v_def,
      '''retrying''::public.print_job_status',
      '''retrying'''
    );
    v_def := replace(
      v_def,
      '''failed''::public.print_job_status',
      '''failed'''
    );

    if position('public.print_job_status' in v_def) > 0 then
      raise exception 'TRIAL_PRINT_STATUS_CAST_PATCH_INCOMPLETE';
    end if;

    execute v_def;
  end if;
end;
$$;
