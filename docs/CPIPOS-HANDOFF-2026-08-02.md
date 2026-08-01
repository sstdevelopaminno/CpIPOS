# CpIPOS Handoff 2026-08-02

Last reviewed: 2026-08-02 02:53 Asia/Bangkok
Workspace: `E:\CpIPOS`
Repo: `https://github.com/sstdevelopaminno/CpIPOS.git`
Active branch/default branch: `agent-docs-preflight-schema-drift`
Production/Vercel project: `cp-ipos-web`
Latest deployed commit reviewed here: `08afac88ce6e1bbc28f34310f1c43773e72ec104`
Latest Vercel status checked: `success`

## Purpose

This document records the print, receipt, POS payment responsiveness, and cross-platform web POS printing changes made during the 2026-08-02 support round. Read this file before continuing any POS printing, Browser Print Agent, receipt layout, payment latency, or tablet/iPad/Android Chrome work.

## Current rule for future AI work

Do not confuse this project with the old `E:\SSTiPOS` workspace or old QR-login era docs. Current code is `E:\CpIPOS`, repo `sstdevelopaminno/CpIPOS`, app `apps/backoffice-web`, and active login flow is `/login/store -> branch/employee -> devices -> /preview/pos`.

Before making future code changes, read:

1. `docs/ACTIVE-DOCS-INDEX.md`
2. `docs/AI-DEVELOPMENT-PREFLIGHT.md`
3. `docs/AI-GUARDRAILS-CPIPOS.md`
4. `docs/CPIPOS-HANDOFF-2026-08-02.md`
5. Feature-specific docs, especially printing docs listed below

## Recent commits in this round

### `3fe665b8540d6cd6e73b19b097724cce44163f01`

File changed:

- `apps/backoffice-web/src/components/printing/browser-print-agent.tsx`

Intent:

- Improve Browser Print Agent raster rendering for auto print jobs.
- Convert legacy receipt HTML/text payloads into structured receipt layout before sending bytes to the thermal printer.
- Improve label repair for legacy corrupted Thai labels and improve receipt layout closer to the browser print preview.

Notes:

- This affected the agent side, not server-side receipt generation.
- It was a compatibility fix for jobs that still arrive as legacy text/pre-wrap HTML.

### `7819f2d06aaa2d3da495a43f01dd35797706918a`

File changed:

- `apps/backoffice-web/src/app/api/pos/payments/route.ts`

Intent:

- Fix slow/unresponsive payment button behavior after pressing cash or bank transfer payment.
- Move print job queueing out of the blocking response path using Next.js `after()`.

Old behavior:

```text
POST /api/pos/payments
-> complete payment transaction
-> update order payment snapshot
-> query print queue depth
-> query order/items
-> enqueue receipt/kitchen print jobs
-> maybe process/defer jobs
-> finally return response to POS
```

New behavior:

```text
POST /api/pos/payments
-> complete payment transaction
-> update order payment snapshot
-> close table/session if needed
-> return response to POS quickly
-> after(response): query print queue depth and enqueue print jobs
```

Expected user-facing result:

- Payment confirmation should return faster for both cash and bank transfer.
- Receipt printing may start a few seconds later through Browser Print Agent polling.
- Payment success must not wait for printer queue depth, receipt job creation, or printer availability.

Response flag added:

```json
{ "print_jobs_deferred": true }
```

Important caution:

- Do not reintroduce blocking `await enqueuePrintJobsForOrderSnapshot(...)` directly in the payment response path unless intentionally reverting Fast Payment.

### `e14f91e5aea8be387a9ade48f111113eb4a9632a`

Files changed:

- `apps/backoffice-web/src/components/printing/browser-print-agent-alert.tsx`
- `apps/backoffice-web/src/app/layout.tsx`

Intent:

- Add Print Agent Alert Popup for POS pages.
- Show warnings for Browser Print Agent disabled, unsupported browser, missing agent key, missing serial permission, printer not ready, print failures, paper-related states if known.

Status codes covered in the popup include:

```text
disabled
web_serial_unsupported
agent_key_missing
serial_permission_required
agent_error
print_failed
browser_serial_print_failed
serial_port_not_writable
paper_out
cover_open
paper_jam
printer_offline
```

Important limitation:

- `paper_out`, `cover_open`, `paper_jam`, and `printer_offline` can only be shown precisely if the printer/adapter/agent can surface those states.
- Many low-cost 58/80mm thermal printers do not return detailed status over browser Web Serial or Bluetooth bridge. In that case the UI must show a generic print failure/printer not responding warning.

### `f9798ec9bfce53dfea36b24aa19d875a61b79cfb`

File added:

- `apps/backoffice-web/src/components/printing/browser-print-agent-pos-host.tsx`

File changed:

- `apps/backoffice-web/src/app/layout.tsx`

Intent:

- Fix missing popup problem caused by mounting only `BrowserPrintAgentAlert` without mounting `BrowserPrintAgent` on the POS page.
- POS route now mounts a print host on `/preview/pos` so the agent can dispatch `cpi-browser-print-agent-status` events and the popup can receive them.

Root cause of missing popup:

```text
Alert component existed.
Browser Print Agent was not mounted in the POS route.
Therefore no status event was emitted in the POS page.
```

Expected result:

- On Windows/desktop Chrome/Edge with Browser Print Agent enabled, POS page receives status events and can show popup alerts.

### `08afac88ce6e1bbc28f34310f1c43773e72ec104`

Files changed/added:

- `apps/backoffice-web/src/components/printing/browser-print-agent-pos-host.tsx`
- `docs/CROSS-PLATFORM-WEB-POS-PRINTING.md`

Intent:

- Improve cross-platform web POS printing stability for Windows, Android, and iOS Chrome/web app usage.
- Make Windows/desktop Chrome/Edge the recommended Browser Print Agent/Web Serial print station.
- Make Android tablet/iPad/iPhone web POS operate primarily as sales terminals that create server-side `print_jobs`, while a dedicated print station claims and prints.

Modes introduced in the POS host:

```text
desktop_local_agent
mobile_remote_station
unsupported_remote_station
```

Expected architecture:

```text
Android/iOS/Windows POS browser
-> uses POS sales/payment UI
-> creates server print_jobs

Windows/Desktop/bridge print station
-> runs Browser Print Agent or bridge
-> claims print_jobs
-> sends bytes to printer
```

Mobile direct print policy:

- Android/iOS direct browser printing is not the default because mobile browser hardware APIs are inconsistent and often do not support common receipt printer protocols.
- There is an opt-in localStorage escape hatch for carefully tested Android devices:

```js
localStorage.setItem("cpi_browser_print_agent_mobile_direct_v1", "1")
```

Use that only for validated hardware; do not make it the default path.

## Current print architecture

### Payment auto print

`POST /api/pos/payments` completes the payment first, returns response, then uses `after()` to enqueue print jobs. Browser Print Agent or another print station claims and prints jobs later.

Key file:

- `apps/backoffice-web/src/app/api/pos/payments/route.ts`

### Browser Print Agent

The browser agent polls `/api/print-agent/v1/jobs/claim`, renders receipt HTML/text to ESC/POS raster bytes, writes to the serial port, then calls ack/fail endpoints.

Key files:

- `apps/backoffice-web/src/components/printing/browser-print-agent.tsx`
- `apps/backoffice-web/src/components/printing/browser-print-agent-pos-host.tsx`
- `apps/backoffice-web/src/components/printing/browser-print-agent-alert.tsx`
- `apps/backoffice-web/src/app/api/print-agent/v1/jobs/claim/route.ts`
- `apps/backoffice-web/src/lib/printing/print-agent-service.ts`

### Receipt layout

There are currently multiple receipt rendering paths:

1. POS modal/browser print preview in `pos-sales-module.tsx` / payment modal flow.
2. Auto print queue payload from `print-service.ts`.
3. Browser Print Agent compatibility rendering for legacy text/pre-wrap HTML.

Known design issue:

- The cleanest long-term fix is to unify receipt HTML generation so popup preview and auto print queue share one canonical receipt HTML builder.
- The recent patches reduce the mismatch by repairing legacy payloads in Browser Print Agent, but future refactor should centralize the source of receipt HTML to avoid drift.

## Known performance / responsiveness findings

### Fixed: payment button slow after cash/bank transfer

Cause:

- Payment API previously waited for print queue checks and print job enqueueing before returning.

Fix:

- Moved print enqueueing to `after()`.

Expected behavior:

- Payment UI should return faster.
- Printing may occur asynchronously after the payment success response.

### Watch: print queue backlog

Symptoms:

- Receipts print late.
- Agent keeps retrying.
- POS payment may be fast but receipt appears delayed.

Check:

- Query `print_jobs` for statuses `pending`, `printing`, `retrying`, `failed` by tenant/branch.
- Confirm Browser Print Agent is active, has correct agent key, and is assigned to the target printer profile/device code.

### Watch: Browser Print Agent not mounted or unsupported on device

Symptoms:

- No popup, no printing, no status change on mobile browsers.

Expected after latest patch:

- Desktop POS route mounts Browser Print Agent and popup.
- Mobile POS route uses remote print station mode and should not attempt local Web Serial unless explicitly opted in.

### Watch: paper out / paper jam status precision

Symptoms:

- User expects exact popup for paper out or jam.

Reality:

- Exact states require printer/adapter status feedback.
- Generic failures are still valuable: write failure, port not writable, no serial permission, offline/agent errors.

## Verification commands for local machine

Run after pulling latest code:

```powershell
$env:Path="C:\Program Files\nodejs;C:\Program Files\Git\cmd;$env:Path"
cd E:\CpIPOS
git status -sb
git branch --show-current
git fetch origin
git checkout agent-docs-preflight-schema-drift
git pull --ff-only origin agent-docs-preflight-schema-drift
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web exec vitest run --cache false
corepack pnpm --filter backoffice-web exec eslint src scripts tests next.config.ts eslint.config.mjs --cache --cache-location ..\..\.tmp-eslintcache --no-error-on-unmatched-pattern
corepack pnpm schema:drift
corepack pnpm --filter backoffice-web build
```

If local code has uncommitted edits, do not overwrite them blindly. Save first:

```powershell
git status -sb
git stash push -u -m "local-backup-before-pull-2026-08-02"
git pull --ff-only origin agent-docs-preflight-schema-drift
```

## Vercel note

Vercel builds from GitHub. There is no normal workflow to pull the built Vercel output back into the local repo. The local source of truth should be GitHub plus `.env.local` pulled from Vercel if needed.

To pull Vercel environment values locally:

```powershell
cd E:\CpIPOS
npx vercel login
npx vercel link
npx vercel env pull apps/backoffice-web/.env.local
```

Only do this on a secure development machine. Do not commit `.env.local` or secrets.

## Manual QA checklist for next test

### Windows print station

1. Open Chrome/Edge on Windows.
2. Open `/preview/pos`.
3. Ensure Browser Print Agent is enabled and has the correct agent key.
4. Select/allow printer serial port if needed.
5. Create a new bill after latest Vercel deploy.
6. Pay cash.
7. Pay bank transfer.
8. Confirm payment UI responds quickly.
9. Confirm receipt prints later through agent.
10. Force a failure by disconnecting printer or leaving port unavailable and confirm popup appears.

### Android/iOS sales terminal

1. Open Chrome/web app on Android tablet or iPad/iPhone.
2. Login and enter POS.
3. Create and pay a bill.
4. Confirm the tablet does not require direct printer access.
5. Confirm Windows/bridge print station prints the receipt from the server queue.

## Do not change without explicit reason

- Do not move print enqueueing back into the blocking payment path.
- Do not rely on iOS Chrome or Android Chrome direct printer access as the primary production path.
- Do not delete Browser Print Agent compatibility rendering until canonical receipt HTML is unified and tested.
- Do not use old QR login docs as current login guidance.

## Recommended next improvements

1. Create a canonical shared receipt HTML builder used by both POS receipt preview and auto print jobs.
2. Add a print station status panel in POS/settings showing: agent online/offline, last seen, last claimed job, last error, queue depth.
3. Add print retry button linked to failed print jobs.
4. Add optional ESC/POS status probe for printers that support status feedback, while keeping generic failure handling for printers that do not.
5. Add metrics around `/api/pos/payments` duration and print job enqueue duration.
