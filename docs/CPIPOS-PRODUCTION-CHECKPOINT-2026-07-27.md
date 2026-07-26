# CpIPOS Production Checkpoint

Date: 2026-07-27

## Scope

- Local workspace: `E:\CpIPOS`
- GitHub repo: `https://github.com/sstdevelopaminno/CpIPOS.git`
- Branch: `agent-docs-preflight-schema-drift`
- Vercel project: `cp-ipos-web`
- Production URL: `https://cp-ipos-web.vercel.app`
- Supabase project: `POS-Preview`
- Supabase ref: `deejlitaivfnsbwqdugy`

## Verification

- Vercel production has Supabase environment variables for `production` and `development`:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Vercel production also requires `POS_SESSION_HANDOFF_SECRET`; without it, valid store codes fail after tenant lookup because the pre-entry flow cookie cannot be signed.
- Supabase project `deejlitaivfnsbwqdugy` is `ACTIVE_HEALTHY`.
- Production `/login/store` returned `200`.
- Production `/manifest.webmanifest` returned `200`.
- Production `/api/auth/store-code/verify` with a valid-format fake store code returned `404 store_not_found`, confirming the API reached the existing Supabase database instead of failing on missing environment variables.
- Production `/api/auth/store-code/verify` returned `200` for active existing store codes `SOLO-TH-001`, `NDL-TH-001`, and `BBQ-TH-002` after `POS_SESSION_HANDOFF_SECRET` was added and production was redeployed.
- Production smoke on 2026-07-27 confirmed `/login/store`, `/login/branches`, `/login/employee`, `/login/devices`, and `/manifest.webmanifest` return `200`.
- Production smoke confirmed unauthenticated `/preview/pos` and `/preview/pos/settings` redirect to `/login/store`.
- Production smoke confirmed unauthenticated `/api/pos/session/current`, `/api/pos/features`, and `/api/pos/sales` return `401 missing_pos_session`.
- Production smoke noted unauthenticated `/api/pos/members` returns `503 members_load_failed` with message `POS session is required`; this is an unauthenticated boundary response, not a database connection failure.

## Notes For Next AI

- Do not commit `.vercel/`; it is local project-link metadata.
- Do not write Vercel tokens, Supabase access tokens, database passwords, service-role keys, or `.env.local` values to source control.
- Preview Supabase env was not confirmed because Vercel rejected the preview branch target. Production is the active verified environment.
- Read `docs/AI-GUARDRAILS-CPIPOS.md` before making future CpIPOS changes.
