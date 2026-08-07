-- Security follow-up for the branch-aware negative-stock trigger.
-- Trigger execution does not require elevated privileges here because stock
-- updates are already performed by trusted server/service-role or SECURITY
-- DEFINER transaction functions. Keep the trigger function SECURITY INVOKER
-- so it is not exposed as a privileged RPC surface.

alter function public.enforce_ingredient_negative_stock_policy() security invoker;
