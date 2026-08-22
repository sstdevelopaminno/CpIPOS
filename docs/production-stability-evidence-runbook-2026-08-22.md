# Production Stability Evidence Runbook - 2026-08-22

This runbook is for the go-live stability gates that must be proven on a real POS branch, not only from API smoke checks.

## 1. Supabase Advisor Debt

Migrations added in this work package:

- `supabase/migrations/20260822012439_advisor_fk_indexes_rls_policy_debt.sql`
- `supabase/trial-data-plane/migrations/20260822012513_advisor_fk_indexes_rls_policy_debt.sql`

What they do:

- Add covering indexes for public foreign keys that do not already have a covering index.
- Add a deny-all client policy to RLS-enabled tables that have no policy, preserving service-role-only behavior.
- Split selected authenticated `ALL` policies into INSERT/UPDATE/DELETE policies when a dedicated SELECT policy already exists, removing duplicate SELECT evaluation without widening writes.

Live apply note:

- Do not apply to production during active POS trading without a maintenance window.
- The FK index section uses normal `create index if not exists` inside an idempotent catalog loop. It has `lock_timeout = '5s'` so it fails closed instead of waiting behind hot writes.
- After apply, run Supabase performance and security advisors again on Primary and Trial.

## 2. Physical Printer E2E

Run this on a manager or owner browser/session from the real POS branch after LAN, USB, and Bluetooth printers are connected through the Android POS / Windows Runtime print agent.

Required auth input:

- `CPIPOS_BASE_URL`, for example `https://cp-ipos-web.vercel.app`
- `CPIPOS_COOKIE` copied from the authenticated manager/owner browser session, or `CPIPOS_AUTHORIZATION` if using an authorized bearer token

Example:

```bash
corepack pnpm qa:printer-e2e -- \
  --base-url https://cp-ipos-web.vercel.app \
  --device POS-COUNTER-01 \
  --printer XP-58 \
  --lan-printer-id <lan-printer-profile-id> \
  --usb-printer-id <usb-printer-profile-id> \
  --bluetooth-printer-id <bluetooth-printer-profile-id> \
  --bluetooth-bridge-url http://127.0.0.1:18181 \
  --out docs/evidence/fg0003-physical-printer-e2e.json
```

Acceptance:

- `discover:all` succeeds.
- `devices` succeeds and shows route assignments.
- `smoke-status` shows fresh runtime heartbeat when device/printer are supplied.
- Every configured LAN/USB/Bluetooth test print is accepted.
- The generated report is committed or attached to the release evidence.

## 3. Multi-Tenant / Multi-Branch Load And Soak

Use multiple authenticated scopes to represent different tenants and branches.

`CPIPOS_SOAK_SCOPES_JSON` example:

```json
[
  { "name": "FG0003-main", "cookie": "<manager-cookie-1>" },
  { "name": "TENANT2-branch-a", "cookie": "<manager-cookie-2>" },
  { "name": "TENANT2-branch-b", "cookie": "<manager-cookie-3>" }
]
```

Command:

```bash
corepack pnpm qa:pos-soak -- \
  --base-url https://cp-ipos-web.vercel.app \
  --seconds 900 \
  --concurrency 24 \
  --timeout-ms 12000 \
  --scopes-json "$CPIPOS_SOAK_SCOPES_JSON" \
  --out docs/evidence/multi-tenant-pos-soak.json
```

Acceptance:

- p95 and p99 are reviewed per route.
- Error rate stays under the configured threshold, default 2%.
- Queue samples do not show growing print queue depth or age.
- No branch scope mismatch is tolerated.

## 4. UI Click Latency

Default route is `/preview/pos` to avoid accidental live sales actions. Use `/pos` only on a controlled test branch/device.

Command:

```bash
corepack pnpm qa:ui-click-latency -- \
  --base-url https://cp-ipos-web.vercel.app \
  --route /preview/pos \
  --iterations 5 \
  --out docs/evidence/pos-ui-click-latency.json
```

For a real POS screen, provide safe selectors explicitly:

```bash
corepack pnpm qa:ui-click-latency -- \
  --base-url https://cp-ipos-web.vercel.app \
  --route /pos \
  --cookie "$CPIPOS_COOKIE" \
  --selectors-json '[{"name":"table-tab","selector":"[role=tab]"},{"name":"mode-switch","selector":"button[aria-label*=mode]"}]'
```

Acceptance:

- Page has content and no framework error overlay.
- Console error count is zero.
- Failed request count is zero or explained.
- p95 click latency is reviewed on the actual two-screen POS hardware.
