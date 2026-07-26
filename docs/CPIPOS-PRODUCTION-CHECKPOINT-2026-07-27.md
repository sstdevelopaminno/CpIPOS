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
- Supabase project `deejlitaivfnsbwqdugy` is `ACTIVE_HEALTHY`.
- Production `/login/store` returned `200`.
- Production `/manifest.webmanifest` returned `200`.
- Production `/api/auth/store-code/verify` with a valid-format fake store code returned `404 store_not_found`, confirming the API reached the existing Supabase database instead of failing on missing environment variables.

## Notes For Next AI

- Do not commit `.vercel/`; it is local project-link metadata.
- Do not write Vercel tokens, Supabase access tokens, database passwords, service-role keys, or `.env.local` values to source control.
- Preview Supabase env was not confirmed because Vercel rejected the preview branch target. Production is the active verified environment.
