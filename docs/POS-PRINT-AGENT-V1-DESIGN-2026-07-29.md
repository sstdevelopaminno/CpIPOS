# POS Print Agent v1 Design 2026-07-29

Status: implemented locally, pending production migration apply, commit, push, and deploy.

## Goal

Make receipt/kitchen/report printing stable for web POS by moving hardware work to a local Windows/Electron Print Agent while keeping payment and shift close independent from printer success.

## Multi-Tenant Scope

Every agent is scoped by database state, not by client-provided tenant values:

- `tenant_id`
- `branch_id`
- `device_id`
- `device_code`
- `api_key_hash`
- `status`

The agent sends only its key. The API resolves tenant/branch/device from `print_agents`, so one owner/store/branch cannot claim another branch's jobs.

## Added Schema

Migration: `supabase/migrations/20260728173858_print_agent_v1.sql`

- `print_agents`
  - one row per local print worker/device
  - stores token hash only
  - no anon/authenticated grants
  - service-route access only
- `print_jobs`
  - `claimed_by_agent_id`
  - `claimed_at`
  - `claim_expires_at`
  - `agent_attempt_id`
  - `agent_error_code`

## Agent API

Authentication:

- Header: `x-print-agent-key: <secret>`
- Or `Authorization: Bearer <secret>`
- Server hashes the secret and compares with `print_agents.api_key_hash`.

Endpoints:

- `POST /api/print-agent/v1/heartbeat`
  - updates `last_seen_at`, `app_version`, metadata
- `POST /api/print-agent/v1/jobs/claim`
  - body: `{ "limit": 5, "lease_seconds": 45, "app_version": "1.0.0" }`
  - returns jobs from the agent's tenant+branch only
- `POST /api/print-agent/v1/jobs/{jobId}/ack`
  - marks claimed job as `printed`
- `POST /api/print-agent/v1/jobs/{jobId}/fail`
  - marks claimed job as `retrying` or `failed`

Claim rules:

- Claims only `pending`, `retrying`, or expired `printing` jobs.
- Jobs are assigned atomically by status and claim expiry.
- Printer profiles may restrict which agent can claim them using metadata:
  - `assigned_agent_id`
  - `assigned_agent_ids`
  - `agent_device_code`
  - `agent_device_codes`
- If no assignment metadata is set, any active print agent in the same branch can claim the printer's jobs.

## Bridge Timeout

Added timeout guard for current bridge adapters:

- `LOCAL_BRIDGE`: default 6000 ms
- `BLUETOOTH_BRIDGE`: default 8000 ms
- Metadata/env override:
  - `metadata.bridge_timeout_ms`
  - `metadata.timeout_ms`
  - `PRINT_LOCAL_BRIDGE_TIMEOUT_MS`
  - `PRINT_BLUETOOTH_BRIDGE_TIMEOUT_MS`
  - `PRINT_BRIDGE_TIMEOUT_MS`

Timeout becomes a print failure, not a payment failure.

## Settings UI Direction

Add a compact printer settings submenu under POS/backoffice settings:

- Printers
- Print Agents
- Test Print
- Assignment

Required fields:

- Printer role: receipt, kitchen, report
- Paper width: 58mm or 80mm
- Connection type: network, local bridge, Bluetooth bridge, future agent
- For multiple machines in one branch:
  - assign printer to `agent_device_code` or `assigned_agent_id`
  - show agent heartbeat status and last claim time

Implemented locally:

- `Settings > Printer Settings > Print Agents` lists agents for the active tenant/branch.
- Create agent returns a one-time `cpi_pa_...` secret and stores only `api_key_hash`.
- Revoke/block updates the agent status; inactive/blocked agents cannot claim jobs.

Do not expose raw agent secrets after creation. Show once, then store only hash.

## Cash Drawer Slice

Implemented locally:

- Migration `20260728180311_cash_drawer_v1.sql` adds `cash_drawer_events` for audit.
- Printer metadata can include:
  - `cash_drawer.enabled`
  - `connectionMode: "printer-kick"`
  - `kickPin`, `pulseOnMs`, `pulseOffMs`
  - `statusSupported`, `autoOpenOnCashPayment`
- `POST /api/pos/cash-drawer/open` opens manually for owner/manager only, requires a reason, applies a 3s cooldown, queues a print job, and records audit/event rows.
- `GET /api/pos/cash-drawer/open` lets POS hide the button when no receipt printer has drawer support configured.
- Network ESC/POS builds the `ESC p` pulse inside the trusted adapter. Browser clients never send raw ESC/POS bytes.
- Local/Bluetooth bridge requests include `action: "cash_drawer_open"` and `metadata.command: "open_cash_drawer"` for the Windows/Electron agent to handle safely.

## Next Slice

- Build the actual Windows/Electron Print Agent `/cash-drawer/open` and `/cash-drawer/status` handlers with signed localhost security.
- Change payment print path to enqueue-only once agent deployment is ready.
- Add a small Windows/Electron worker that calls heartbeat -> claim -> print -> ack/fail.
- Add automatic drawer open after successful cash payment only, using the same safe queue/event path.
- Keep browser print fallback for emergency only.
