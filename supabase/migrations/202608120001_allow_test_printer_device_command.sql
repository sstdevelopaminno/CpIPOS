alter table public.device_commands
  drop constraint if exists device_commands_command_type_check;

alter table public.device_commands
  add constraint device_commands_command_type_check
  check (
    command_type = any (
      array[
        'request_diagnostics_bundle'::text,
        'reload_ui'::text,
        'clear_print_queue'::text,
        'restart_local_bridge'::text,
        'refresh_config'::text,
        'disable_device'::text,
        'enable_device'::text,
        'test_printer'::text
      ]
    )
  );
