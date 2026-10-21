-- Allow the audited Android Device Owner release command used only by the
-- IT-confirmed tenant offboarding workflow.

alter table public.mdm_commands drop constraint if exists mdm_commands_type_check;
alter table public.mdm_commands
  add constraint mdm_commands_type_check
  check (command_type = any (array[
    'lock_device','unlock_device','request_location','start_remote_support','stop_remote_support',
    'install_app','uninstall_app','sync_policy','revoke_device_access','financing_lock',
    'diagnostics_ping','release_device_owner'
  ]::text[]));

comment on constraint mdm_commands_type_check on public.mdm_commands
is 'Allowed Full MDM commands. release_device_owner is reserved for explicit IT-confirmed tenant offboarding and must be acknowledged before permanent tenant deletion.';
