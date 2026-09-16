-- Phase 2 Full MDM transport hardening.
-- MDM authority remains server-only through service-role clients. Browser/user sessions
-- must not read or mutate managed-device command state directly.

create index if not exists idx_mdm_command_audit_command_id
  on public.mdm_command_audit (command_id)
  where command_id is not null;

create index if not exists idx_mdm_remote_support_command_id
  on public.mdm_remote_support_sessions (command_id)
  where command_id is not null;

revoke all privileges on table public.mdm_devices from anon, authenticated;
revoke all privileges on table public.mdm_commands from anon, authenticated;
revoke all privileges on table public.mdm_command_audit from anon, authenticated;
revoke all privileges on table public.mdm_remote_support_sessions from anon, authenticated;

grant all privileges on table public.mdm_devices to service_role;
grant all privileges on table public.mdm_commands to service_role;
grant all privileges on table public.mdm_command_audit to service_role;
grant all privileges on table public.mdm_remote_support_sessions to service_role;

comment on index public.idx_mdm_command_audit_command_id is
  'Supports Full MDM command audit joins and FK maintenance by command id.';
comment on index public.idx_mdm_remote_support_command_id is
  'Supports remote-support session lookup and FK maintenance by command id.';
