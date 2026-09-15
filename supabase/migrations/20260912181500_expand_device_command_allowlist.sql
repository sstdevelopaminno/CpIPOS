-- Keep the generic POS command queue aligned with the application allowlist.
-- This queue remains non-destructive; Full MDM actions use public.mdm_commands.

alter table public.device_commands
  drop constraint if exists device_commands_command_type_check;

alter table public.device_commands
  add constraint device_commands_command_type_check check (command_type in (
    'request_diagnostics_bundle',
    'request_diagnostics',
    'reload_ui',
    'restart_app',
    'test_network',
    'test_printer',
    'clear_print_queue',
    'restart_local_bridge',
    'restart_print_service',
    'refresh_config',
    'check_update',
    'disable_device',
    'enable_device'
  ));

comment on table public.device_commands is
  'IT Admin-issued non-destructive POS runtime commands delivered through device heartbeat. Full Android Device Owner MDM actions use mdm_commands.';
