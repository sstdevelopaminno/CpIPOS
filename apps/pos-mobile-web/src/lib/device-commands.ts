// Mirrors apps/backoffice-web/src/lib/device-commands.ts - kept in sync manually
// since pos-mobile-web is a separate codebase with no shared package linking the two.

export const DEVICE_COMMAND_TYPES = [
  "request_diagnostics_bundle",
  "reload_ui",
  "clear_print_queue",
  "restart_local_bridge",
  "refresh_config",
  "disable_device",
  "enable_device"
] as const;

export type DeviceCommandType = (typeof DEVICE_COMMAND_TYPES)[number];

export type PendingDeviceAction = {
  id: string;
  command_type: DeviceCommandType;
  issued_at: string;
};

// CpIPOS Mobile has no local print bridge - these two are never actionable here.
export const UNSUPPORTED_DEVICE_COMMAND_TYPES: readonly DeviceCommandType[] = ["clear_print_queue", "restart_local_bridge"];
