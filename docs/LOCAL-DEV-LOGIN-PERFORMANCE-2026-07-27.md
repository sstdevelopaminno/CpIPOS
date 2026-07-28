# Local Dev Login Performance Checkpoint

Date: 2026-07-27

Use this before spending time on `localhost:3000` login slowness.

## Current Local Baseline

- Workspace: `E:\CpIPOS`
- App: `apps/backoffice-web`
- Dev server: `corepack pnpm --filter backoffice-web dev`
- Port: `3000`
- Dev bundler default: webpack through `apps/backoffice-web/scripts/dev-safe.mjs`
- Local env file: `apps/backoffice-web/.env.local`
- Dev warm store code: `NEXT_DEV_WARM_STORE_CODE=NDL-TH-001`

## What Was Fixed

- Pulled Vercel development env into `apps/backoffice-web/.env.local`.
- Added local-only `TABLE_QR_SIGNING_SECRET`.
- Removed accidental quotes around `.env.local` values.
- Restarted the dev server outside the sandbox so server-side fetch can reach Supabase.
- Changed `dev-safe.mjs` default bundler back to webpack after repeated local Turbopack panic logs on 2026-07-28.
- Added `dev-safe.mjs` route warm-up for `/login/store`, `/login/branches?flow=multi`, `/login/employee?flow=multi`, `/login/devices`, `/manifest.webmanifest`, and `/api/auth/store-code/verify`.
- Added 5-minute in-memory cache for store-code tenant+branch lookup in `POST /api/auth/store-code/verify`.

## Expected Behavior

- First route compile after a restart can still be slow. Do not treat this as runtime login slowness.
- Wait for log lines like `[dev-safe] Warmed GET /login/store`, `[dev-safe] Warmed GET /login/branches?flow=multi`, and `[dev-safe] Warmed POST /api/auth/store-code/verify`.
- After warm-up, repeated `POST /api/auth/store-code/verify` for `NDL-TH-001` should show `x-auth-api-ms` in single-digit or low double-digit ms.
- If the first browser click is still slow immediately after restart, check whether warm-up finished before debugging code.

## Known Local Bottleneck

Next reports `Slow filesystem detected` for `.next/dev` under `E:\CpIPOS\apps\backoffice-web`. This is a local filesystem/cache issue, not necessarily an app bug.

## Fast Checks

Do not print secret values. Check only presence/length.

```powershell
$path = "apps\backoffice-web\.env.local"
$names = @(
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "POS_SESSION_HANDOFF_SECRET",
  "TABLE_QR_SIGNING_SECRET",
  "NEXT_DEV_WARM_STORE_CODE"
)
$lines = Get-Content $path
foreach ($name in $names) {
  $line = $lines | Where-Object { $_ -match "^$([regex]::Escape($name))=" } | Select-Object -First 1
  if (-not $line) { "$name=MISSING" } else { "$name=SET length=$($line.Substring($name.Length + 1).Length)" }
}
```

Connectivity check:

```powershell
$url = (Get-Content apps\backoffice-web\.env.local | Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_URL=' } | Select-Object -First 1).Substring('NEXT_PUBLIC_SUPABASE_URL='.Length)
Invoke-WebRequest -UseBasicParsing -Uri "$url/rest/v1/" -Method Head -TimeoutSec 10
```

Expected status is `401`, which means Supabase is reachable without exposing keys.

Local API timing check:

```powershell
$body = '{ "store_code": "NDL-TH-001" }'
1..3 | ForEach-Object {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $res = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/auth/store-code/verify' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
  $sw.Stop()
  "status=$($res.StatusCode) totalMs=$($sw.ElapsedMilliseconds) apiMs=$($res.Headers['x-auth-api-ms'])"
}
```

## Do Not Waste Tokens On

- Do not assume port `3000` is missing if `/login/store` loads. Check API/env/logs first.
- Do not debug Supabase schema when the log says `Missing Supabase service role environment variables`; fix `.env.local`.
- Do not run the dev server inside a sandbox if the API must reach Supabase. Start it with network access.
- Do not expose or paste `.env.local` secret values into chat, docs, commits, or screenshots.
- Do not repeatedly restart the server and test immediately before warm-up finishes.
