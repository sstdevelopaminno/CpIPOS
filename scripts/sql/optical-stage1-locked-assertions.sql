-- No customer role may query or mutate Optical Stage-1 while finance is not activated.
\set ON_ERROR_STOP on
DO $checks$
DECLARE tab text; count_ int;
BEGIN
  FOREACH tab IN ARRAY ARRAY[
    'optical_stock_bins','optical_work_orders','optical_work_order_lines',
    'optical_stock_reservations','optical_payment_ledger',
    'optical_work_order_events','optical_stock_movements'
  ] LOOP
    IF NOT EXISTS(
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=tab AND c.relrowsecurity
    ) THEN RAISE EXCEPTION 'missing RLS for %',tab; END IF;
    IF has_table_privilege('anon',format('public.%I',tab),'SELECT')
      OR has_table_privilege('authenticated',format('public.%I',tab),'SELECT')
      OR has_table_privilege('anon',format('public.%I',tab),'INSERT')
      OR has_table_privilege('authenticated',format('public.%I',tab),'INSERT')
      OR has_table_privilege('authenticated',format('public.%I',tab),'UPDATE')
      OR has_table_privilege('authenticated',format('public.%I',tab),'DELETE')
      THEN RAISE EXCEPTION 'unapproved client privileges for %',tab; END IF;
    SELECT count(*) INTO count_ FROM pg_policies WHERE schemaname='public' AND tablename=tab;
    IF count_<>0 THEN RAISE EXCEPTION 'unexpected live policy on locked table %',tab; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.optical_work_orders)
    OR EXISTS (SELECT 1 FROM public.optical_payment_ledger)
    OR EXISTS (SELECT 1 FROM public.optical_stock_movements)
  THEN RAISE EXCEPTION 'Stage 1 must be completely empty'; END IF;
END
$checks$;
select 'stage1_optical_schema_locked_passed' as outcome;
