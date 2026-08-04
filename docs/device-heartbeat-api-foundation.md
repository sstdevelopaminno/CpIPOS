# CpIPOS Device Heartbeat API Foundation

This phase connects the Device MDM & Diagnostics foundation to server-side storage so cashier Windows devices can report health snapshots for after-sales support.

## Scope

Added in this phase:

- Supabase tables for latest device health, historical snapshots, and derived incidents.
- POS-session authenticated API endpoint: `POST /api/pos/device-heartbeat`.
- Server-side incident derivation using `device-mdm-diagnostics.ts`.
- 30-day offline sale grace and 45-day hard sync policy signals are preserved in the stored summary and incidents.

Not added in this phase:

- Remote control.
- Screen capture.
- Key logging.
- Reading customer private files.
- Device command execution.
- IT dashboard UI.

## Endpoint

```text
POST /api/pos/device-heartbeat
```

The request must come from a valid POS session. The server resolves tenant, branch, POS device, and session identity from the session guard; payload tenant/branch values are not trusted.

## Minimal payload

```json
{
  "identity": {
    "device_code": "POS-COUNTER-01",
    "machine_id": "WIN-ABC123",
    "hostname": "CASHIER-01",
    "runtime_version": "0.1.5",
    "app_version": "2026.08.05"
  },
  "connectivity": {
    "internet_online": true,
    "server_reachable": true,
    "dns_healthy": true,
    "latency_ms": 42
  },
  "system": {
    "os_name": "Windows",
    "os_version": "10",
    "uptime_seconds": 3600,
    "cpu_percent": 18,
    "memory_percent": 62,
    "disk_total_gb": 237,
    "disk_free_gb": 42,
    "clock_drift_seconds": 2
  },
  "runtime": {
    "cpi_windows_runtime_running": true,
    "local_bridge_online": true,
    "bridge_version": "cpipos-windows-native-bridge-0.1.5",
    "printed_jobs": 0,
    "failed_jobs": 0,
    "drawer_commands": 0,
    "last_error": null
  },
  "peripherals": {
    "default_printer": "XP-58",
    "selected_printer": "XP-58",
    "selected_printer_valid": true,
    "printer_status": "normal",
    "print_queue_count": 0,
    "cash_drawer_supported": true
  },
  "offline_sale": {
    "offline_sale_enabled": true,
    "offline_sale_queue_count": 0,
    "offline_sale_failed_count": 0,
    "offline_since_days": 0
  }
}
```

## Storage tables

- `pos_device_health_latest`: one latest record per tenant, branch, device code, and machine id.
- `pos_device_health_snapshots`: append-only heartbeat history.
- `pos_device_incidents`: derived incidents, such as disk low, printer error, local bridge offline, or offline sale grace expired.

## After-sales diagnostic intent

This gives IT support evidence to separate POS defects from store environment issues:

- Windows printer queue stuck.
- Printer out of paper.
- Local Bridge offline.
- Disk space low.
- RAM/CPU saturation.
- DNS/server/network issue.
- Offline sale queue waiting for sync.
- Device clock drift.
- Tamper/security signals reported by the runtime.

## Next phase

Recommended next phase: Windows Runtime heartbeat sender.

The Windows Runtime should call `/health`, collect safe system telemetry, then post to `/api/pos/device-heartbeat` every 1 to 5 minutes while the POS session is active. It should use bounded retry and never block sales, printing, or drawer opening.
