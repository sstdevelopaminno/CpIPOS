# POS CUSTOM Startup — Browser E2E Gate

Run this **before** releasing a change to the POS mode startup architecture. CI's static contract tests, lint, build and TypeScript checks are necessary but NOT substitutes for authenticated browser E2E.

## Prerequisites
- Use only internal QA store `900001 / NDL-TH-001`, or isolated QA tenants approved for testing. Never activate the pending IMDC OPTICAL customer trial.
- Use a verified QA owner/employee, cashier device and an **already open shift**. Test opening/closing a shift separately using an authorized QA workflow; this script **never** opens a shift, creates an order or changes IT entitlements.
- Capture a Playwright `storageState` for each QA login (store it in `.qa/`, outside Git). This may require an authenticated browser profile. Never commit the state, credentials or cookies.
- Each test must be run with the relevant IT configuration **actually applied and saved**. Do not fake permissions in browser storage.

## Test matrix
Create `.qa/pos-custom-modes.json` (do not commit it):

```json
[
  {"name":"optical_only","storageState":".qa/optical.json","expectedMode":"optical_retail"},
  {"name":"dine_only","storageState":".qa/dine.json","expectedMode":"dine_in"},
  {"name":"buffet_only","storageState":".qa/buffet.json","expectedMode":"buffet_table"},
  {"name":"delivery_only","storageState":".qa/delivery.json","expectedMode":"delivery"},
  {"name":"sd_only","storageState":".qa/sd.json","expectedMode":"general_sale"},
  {"name":"home_only","storageState":".qa/home.json","expectedMode":"home"},
  {"name":"no_modes","storageState":".qa/no-modes.json","expectedMode":"none"},
  {"name":"shift_closed","storageState":".qa/closed-shift.json","expectedMode":"shift_required"}
]
```

Use a separate isolated store/session for different mode grants, or change grants one at a time between test runs and save a new QA session state; don't change entitlements of a live selling tenant.

Run:
```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
POS_E2E_CASES_FILE=.qa/pos-custom-modes.json node scripts/pos-custom-mode-e2e.mjs
```

Windows PowerShell:
```powershell
$env:POS_E2E_CASES_FILE=".qa/pos-custom-modes.json"
node scripts/pos-custom-mode-e2e.mjs
```

The script checks the **committed React mode**, a dismissed startup gate, Optical header, and a browser reload. It saves error screenshots and `.qa/pos-custom-evidence/report.json` locally (do not publish session information). Also manually check switch-mode list visibility, E2E shift transition, session switch and preservation of a cart/draft. All must pass to authorize release.

## Failure policy
- No QA `storageState` available => **E2E NOT RUN**, not PASS.
- CI PASS without signed-in E2E evidence => do **not** deploy to Production.
- A failure in only-Optical, only-table or unauthorized-mode tests => block deployment and fix first.
- Server APIs (payment, stock, receipt) still enforce server-side permissions; these tests authorize only front-end startup.
