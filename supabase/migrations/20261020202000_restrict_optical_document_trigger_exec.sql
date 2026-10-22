-- Optical document numbering: narrow trigger-helper EXECUTE privileges.
-- LIVE 2026-10-20: Supabase migration restrict_optical_document_trigger_exec_20261020
-- was applied with server-generated history version 20261020112455.
-- The version here sorts AFTER the original 20261020200000 and 20261020201000
-- source migrations. Do not rename/replay an already-applied live migration.
--
-- Trigger invocation does not require direct EXECUTE privileges from
-- anon/authenticated when the triggers are already installed.
-- The function is only intended for the two Optical AFTER INSERT triggers;
-- clients must not be able to call it as an exposed RPC.
revoke execute on function public.optical_assign_document_number_after_insert_v1()
  from public, anon, authenticated;
grant execute on function public.optical_assign_document_number_after_insert_v1()
  to service_role;
