# AI Guardrails For CpIPOS

Date: 2026-07-27

## Current Project

- Active local workspace: `E:\CpIPOS`
- Active GitHub repo: `https://github.com/sstdevelopaminno/CpIPOS.git`
- Active branch: `agent-docs-preflight-schema-drift`
- Active Vercel project: `cp-ipos-web`
- Active production URL: `https://cp-ipos-web.vercel.app`
- Active Supabase project: `POS-Preview`
- Active Supabase ref: `deejlitaivfnsbwqdugy`

## Do Not Confuse With Old Project

- Do not develop new Web POS work from `E:\SSTiPOS`.
- Do not push new CpIPOS work to `sstdevelopaminno/SSTiPOS.git`.
- Do not create parallel worktrees or sibling copies unless the user explicitly requests it.
- Use `E:\CpIPOS` as the single source of truth for the new CpIPOS Web POS.

## Required Production Env

Vercel production must include these server/runtime variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POS_SESSION_HANDOFF_SECRET`

`POS_SESSION_HANDOFF_SECRET` is required for valid store-code login because the server signs the pre-entry login-flow cookie after tenant and branch lookup.

## Verified Login Store Codes

These store codes exist in the current Supabase project and were verified against production:

- `SOLO-TH-001`: returns `200`, one branch, next step `employee`
- `NDL-TH-001`: returns `200`, two branches, next step `branches`
- `BBQ-TH-002`: returns `200`, one branch, next step `employee`
- `ABC999`: returns `404 store_not_found`, expected for a fake code

## Production Smoke Expectations

- `/login/store`: `200`
- `/login/branches`: `200`
- `/login/employee`: `200`
- `/login/devices`: `200`
- `/manifest.webmanifest`: `200`
- `/preview/pos`: redirects to `/login/store` without a POS session
- `/preview/pos/settings`: redirects to `/login/store` without a POS session
- `/api/pos/session/current`: `401 missing_pos_session` without login
- `/api/pos/features`: `401 missing_pos_session` without login
- `/api/pos/sales`: `401 missing_pos_session` without login

## Security Rules

- Never commit `.vercel/`, `.env.local`, Vercel tokens, Supabase access tokens, database passwords, service-role keys, or generated local cache folders.
- Keep Supabase service-role usage server-only.
- If valid store-code login returns `500`, first check Vercel env for `POS_SESSION_HANDOFF_SECRET` before changing database schema.
