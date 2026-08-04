# CpIPOS Device MDM & Diagnostics Foundation

## Purpose

CpIPOS Device MDM & Diagnostics is the after-sales and IT operations layer for cashier devices. The goal is to separate POS application issues from Windows, network, printer, cash drawer, storage, and tamper issues before support staff visit a customer site.

This foundation is designed to support stores that may run offline for up to 30 days while still giving the CpIPOS IT backoffice enough evidence to diagnose the device when connectivity returns.

## Scope of this phase

This phase adds shared diagnostics primitives only. It does not yet send heartbeats to the backend and does not expose a customer-facing remote control capability.

Included:

- Device identity model.
- Connectivity health model.
- Windows system health model.
- CpIPOS Runtime and Local Bridge health model.
- Printer and cash drawer health model.
- Offline sale queue and grace-period health model.
- Security and tamper signal model.
- Incident derivation helpers.
- Summary helper for future IT dashboard cards.

Not included yet:

- Supabase tables.
- `/api/it/devices/heartbeat` endpoint.
- Windows Runtime heartbeat sender.
- IT Device Health dashboard.
- Remote command execution.
- Screen capture, key logging, or private file inspection.

## Offline sale policy

Default policy:

| Range | Behavior |
| --- | --- |
| 0-7 days | Normal offline cash sale grace period. |
| 8-30 days | Offline sale allowed with warning and sync reminder. |
| 31-45 days | Owner or manager override should be required. |
| More than 45 days | Hard sync required before continuing offline sale. |

The default maximum normal offline sale grace period is 30 days because many small shops may lose internet access for billing or infrastructure reasons.

## Health categories

### Device identity

Tracks which tenant, branch, cashier device, and Windows machine submitted the heartbeat.

Expected fields:

- `tenant_id`
- `branch_id`
- `device_code`
- `machine_id`
- `hostname`
- `windows_username`
- `runtime_version`
- `app_version`

### Connectivity

Tracks whether the issue is caused by internet, DNS, local network, or backend reachability.

Expected signals:

- internet online/offline
- server reachable
- DNS healthy
- latency
- offline since
- last seen

### System health

Tracks Windows-level health, not POS logic.

Expected signals:

- CPU usage
- memory usage
- disk space
- uptime
- Windows version
- clock drift
- power status

### Runtime health

Tracks CpIPOS Windows Runtime and Local Bridge status.

Expected signals:

- runtime running
- local bridge online
- bridge version
- token requirement
- print queue busy
- drawer queue busy
- printed job count
- failed job count
- drawer command count
- last error

### Peripheral health

Tracks printer and cash drawer status.

Expected signals:

- default printer
- selected printer
- selected printer valid
- printer status
- print queue count
- last print time
- cash drawer support
- last drawer command time

### Offline sale health

Tracks offline sale risk per cashier device.

Expected signals:

- last sync time
- offline sale queue count
- offline sale failed count
- offline sale total amount
- offline since days

### Security and tamper signals

Tracks after-sales investigation signals without turning the POS into spyware.

Allowed examples:

- CpIPOS files missing.
- Runtime stopped repeatedly.
- Device token reset.
- Printer port changed.
- Windows clock changed.
- Repeated login failures.
- Abnormal shutdown.
- Offline queue deletion attempt.

Not allowed without explicit customer consent:

- Key logging.
- Continuous screen recording.
- Reading private customer files.
- Stealing or storing Windows passwords.

## Incident codes

Current foundation incident codes:

- `internet_offline`
- `server_unreachable`
- `dns_unhealthy`
- `disk_low`
- `memory_high`
- `cpu_high`
- `clock_drift`
- `runtime_offline`
- `local_bridge_offline`
- `printer_missing`
- `printer_error`
- `print_queue_busy`
- `drawer_error`
- `offline_sale_sync_required`
- `offline_sale_grace_warning`
- `offline_sale_grace_expired`
- `tamper_signal`

## Next phases

### Phase MDM-2: Backend heartbeat intake

Add Supabase tables and API endpoint:

- `pos_device_health_snapshots`
- `pos_device_incidents`
- `pos_device_security_events`
- `POST /api/it/devices/heartbeat`

### Phase MDM-3: Windows Runtime telemetry sender

Make CpIPOS Windows Runtime collect and send heartbeat payloads.

Initial heartbeat interval suggestion:

- online healthy: every 60 seconds
- degraded: every 30 seconds
- critical: every 15 seconds
- offline: store locally and flush later

### Phase MDM-4: IT Device Health Center

Add backoffice pages for support staff:

- device list
- health summary
- incident timeline
- printer diagnostics
- offline sale queue status
- sync required view

### Phase MDM-5: Remote diagnostics commands

Add safe commands only:

- request diagnostics bundle
- restart local bridge
- clear print queue
- refresh config
- test printer
- test cash drawer

Remote commands must be audited and scoped by tenant, branch, device, operator, and role.
