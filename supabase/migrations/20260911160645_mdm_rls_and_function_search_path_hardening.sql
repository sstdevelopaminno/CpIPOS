-- Harden MDM RLS posture and function search_path after Android 1.0.23 Web Production migration.
-- Tables remain tenant scoped. Direct client access is denied by default until application RPC/API policies are explicitly introduced.

alter function public.mdm_android_1023_web_production_eligible(text, text, text, text, text, text, boolean, jsonb)
  set search_path = public, pg_temp;

alter function public.mdm_devices_set_eligibility()
  set search_path = public, pg_temp;

-- Create restrictive policies so Supabase advisor does not report RLS enabled with no policy.
-- Service role keeps operational access via bypassrls; client roles receive no direct table access by default.
drop policy if exists mdm_devices_deny_anon_authenticated_direct_access on public.mdm_devices;
create policy mdm_devices_deny_anon_authenticated_direct_access
on public.mdm_devices
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists mdm_commands_deny_anon_authenticated_direct_access on public.mdm_commands;
create policy mdm_commands_deny_anon_authenticated_direct_access
on public.mdm_commands
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists mdm_command_audit_deny_anon_authenticated_direct_access on public.mdm_command_audit;
create policy mdm_command_audit_deny_anon_authenticated_direct_access
on public.mdm_command_audit
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists mdm_remote_support_sessions_deny_anon_authenticated_direct_access on public.mdm_remote_support_sessions;
create policy mdm_remote_support_sessions_deny_anon_authenticated_direct_access
on public.mdm_remote_support_sessions
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

comment on policy mdm_devices_deny_anon_authenticated_direct_access on public.mdm_devices is
  'Deny direct client access. MDM device registry must be accessed through vetted server-side APIs/RPCs only.';
comment on policy mdm_commands_deny_anon_authenticated_direct_access on public.mdm_commands is
  'Deny direct client access. Command queue writes require server-side validator and audit path.';
comment on policy mdm_command_audit_deny_anon_authenticated_direct_access on public.mdm_command_audit is
  'Deny direct client access. Audit rows are server-written and reviewed through authorized backoffice APIs only.';
comment on policy mdm_remote_support_sessions_deny_anon_authenticated_direct_access on public.mdm_remote_support_sessions is
  'Deny direct client access. Remote support sessions require audited server-side orchestration.';
