-- CpiPOS-001: pin the immutable billing date helper to trusted built-ins.
-- The function uses SQL date arithmetic only; existing monthly/yearly behavior
-- and its IMMUTABLE/SECURITY INVOKER attributes are unchanged.
-- Put pg_temp last to avoid resolving untrusted temporary objects first.
-- No function body replacement, grants, data changes or billing repricing.
alter function app.billing_period_end_date(date, text)
  set search_path = pg_catalog, pg_temp;
