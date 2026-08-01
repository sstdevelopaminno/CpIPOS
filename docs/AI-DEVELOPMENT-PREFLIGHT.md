# AI Development Preflight For CpIPOS

Last reviewed: 2026-08-01

Use this file as the short canonical checklist before any new development round.

## Canonical Runtime

- Workspace: `E:\CpIPOS`
- App: `apps/backoffice-web`
- Repo: `https://github.com/sstdevelopaminno/CpIPOS.git`
- Current login flow: `/login/store -> /login/branches|employee -> /login/devices -> /preview/pos`
- Current active docs index: `docs/ACTIVE-DOCS-INDEX.md`

## Required Read Order

1. `docs/ACTIVE-DOCS-INDEX.md`
2. `docs/AI-GUARDRAILS-CPIPOS.md`
3. `docs/CPIPOS-HANDOFF-2026-07-28.md`
4. The feature-specific doc for the requested work area.

## Hard Guardrails

- Do not develop from `E:\SSTiPOS`.
- Do not push CpIPOS work to `sstdevelopaminno/SSTiPOS.git`.
- Do not use `apps/qr-login-web`, `/qr-scan`, `/login/qr-*`, or `/api/auth/qr/*` as current implementation guidance.
- Treat `docs/NEW-CHAT-BOOTSTRAP-PROMPT-2026-05-28.txt` and `docs/AI-HANDOFF-QRSCAN-*.md` as archived QR-login history only.
- Keep service-role keys, Vercel tokens, Supabase tokens, `.env.local`, `.vercel/`, and generated caches out of commits.
- Do not revert or delete pending local work unless the user explicitly asks.

## Worktree Preflight

If `git` is missing from PATH in PowerShell, use:

```powershell
$env:Path="C:\Program Files\Git\cmd;C:\Program Files\nodejs;$env:Path"
git status -sb
```

If sandbox ACL errors block Git, continue with focused file reads and mention that Git status could not be verified.

## Implementation Rules

- Use server-resolved tenant, branch, user, role, device, POS session, shift, and feature gates.
- Do not trust client-submitted tenant, branch, device, or secret values.
- For IT-admin list/summary work, use pagination and RPC/view-backed summaries; avoid unbounded app-memory aggregation.
- For Supabase migrations, create committed migration files and avoid broad `supabase db push --include-all` until existing migration drift is reviewed.
- For Print Agent and Cash Drawer work, remember the docs mark production migration/commit/deploy as pending unless freshly verified.
- For stuck shift open-bill recovery, do not hard-delete records; cancel safely and preserve audit logs.

## Verification Baseline

Before closing implementation work, run the checks relevant to touched files. Full baseline:

```powershell
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web exec vitest run --cache false
corepack pnpm --filter backoffice-web exec eslint src scripts tests next.config.ts eslint.config.mjs --cache --cache-location ..\..\.tmp-eslintcache --no-error-on-unmatched-pattern
corepack pnpm schema:drift
corepack pnpm --filter backoffice-web build
```

If full lint/build times out without printed errors, run targeted checks for touched files and record the timeout as tooling latency.

## Documentation Closeout

Every implementation round must update the related doc or handoff note so the next AI can continue without guessing.