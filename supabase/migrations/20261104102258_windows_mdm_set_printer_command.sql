-- Windows Web POS 0.2.0: allow only the additional safe, machine-scoped MDM
-- command type already enforced by authenticated backoffice API.
-- Do not loosen the status checks or printer routing/agent permissions.
ALTER TABLE public.device_commands
  DROP CONSTRAINT device_commands_command_type_check,
  ADD CONSTRAINT device_commands_command_type_check CHECK (
    command_type = ANY (ARRAY[
      'request_diagnostics_bundle'::text,
      'request_diagnostics'::text,
      'reload_ui'::text,
      'restart_app'::text,
      'test_network'::text,
      'test_printer'::text,
      'set_printer'::text,
      'clear_print_queue'::text,
      'restart_local_bridge'::text,
      'restart_print_service'::text,
      'refresh_config'::text,
      'check_update'::text,
      'disable_device'::text,
      'enable_device'::text
    ])
  );
