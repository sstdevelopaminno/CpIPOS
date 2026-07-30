# Active Documentation Index

Last reviewed: 2026-07-29

Use this page as the first stop before new development. It separates active implementation guidance from historical QR-era material.

## Current Runtime

- App: `apps/backoffice-web`
- Workspace: `E:\CpIPOS`
- GitHub repo: `https://github.com/sstdevelopaminno/CpIPOS.git`
- Login flow: `/login/store -> /login/branches|employee -> /login/devices -> /preview/pos`
- Database: Supabase migrations in `supabase/migrations`
- Verification baseline: run `typecheck`, `test`, `lint`, and `build` before closing implementation work.
- Latest local baseline on 2026-07-29 passed frozen install, typecheck, Vitest, full lint, schema drift, and production build for `backoffice-web`.

## Read First

- [CpIPOS Handoff 2026-07-28](./CPIPOS-HANDOFF-2026-07-28.md)
- [CpIPOS AI Guardrails](./AI-GUARDRAILS-CPIPOS.md)
- [CpIPOS Production Checkpoint](./CPIPOS-PRODUCTION-CHECKPOINT-2026-07-27.md)
- [Local Dev Login Performance Checkpoint](./LOCAL-DEV-LOGIN-PERFORMANCE-2026-07-27.md)
- [Stability / Network / API Audit 2026-07-28](./STABILITY-NETWORK-API-AUDIT-2026-07-28.md)
- [System Recheck 2026-07-28](./SYSTEM-RECHECK-2026-07-28.md)
- [IT Backoffice API Design 2026-07-28](./IT-BACKOFFICE-API-DESIGN-2026-07-28.md)
- [POS Printing And Receipt Audit 2026-07-29](./POS-PRINTING-RECEIPT-AUDIT-2026-07-29.md)
- [POS Navigation Settings 2026-07-29](./POS-NAVIGATION-SETTINGS-2026-07-29.md)
- [POS Table QR Live Order And Payment Lock 2026-07-30](./POS-TABLE-QR-LIVE-ORDER-LOCK-2026-07-30.md)
- [POS Print Agent v1 Design 2026-07-29](./POS-PRINT-AGENT-V1-DESIGN-2026-07-29.md)
- [POS Shift Clear Open Bills 2026-07-28](./POS-SHIFT-CLEAR-OPEN-BILLS-2026-07-28.md)
- [POS Sales Summary UI 2026-07-28](./POS-SALES-SUMMARY-UI-2026-07-28.md)
- [POS Sales List UI 2026-07-28](./POS-SALES-LIST-UI-2026-07-28.md)
- [Repository README](../README.md)
- [Historical Context Handoff](../context.md)
- [Project Audit Handoff](./PROJECT-AUDIT-HANDOFF-2026-06-02.md)
- [System Stability Audit](./system-stability-audit-2026-06-04.md)
- [Definition of Done](./definition-of-done.md)

## Active Feature Areas

- [POS UI System](./POS-UI-SYSTEM.md)
- [POS Sales Flow](./POS-SALES-FLOW.md)
- [POS Catalog And Stock Checkpoint](./POS-CATALOG-STOCK-CHECKPOINT-2026-07-22.md)
- [POS Catalog Trash And Modifier Checkpoint](./POS-CATALOG-TRASH-MODIFIER-CHECKPOINT-2026-07-22.md)
- [POS Menu Modifiers And Ingredient Options](./POS-MENU-MODIFIERS-INGREDIENTS-PLAN-2026-07-22.md)
- [POS Shift Close Reliability](./POS-SHIFT-CLOSE-RELIABILITY-2026-07-10.md)
- [POS Printing And Receipt Audit 2026-07-29](./POS-PRINTING-RECEIPT-AUDIT-2026-07-29.md)
- [POS Navigation Settings 2026-07-29](./POS-NAVIGATION-SETTINGS-2026-07-29.md)
- [POS Table QR Live Order And Payment Lock 2026-07-30](./POS-TABLE-QR-LIVE-ORDER-LOCK-2026-07-30.md)
- [POS Print Agent v1 Design 2026-07-29](./POS-PRINT-AGENT-V1-DESIGN-2026-07-29.md)
- [POS Login Device Splash](./POS-LOGIN-DEVICE-SPLASH-2026-07-11.md)
- [Stock Engine Architecture](./STOCK-ENGINE-ARCHITECTURE.md)
- [Table Management Floor Plan](./TABLE-MANAGEMENT-FLOOR-PLAN.md)
- [INET NOPS QR Operations Manual](./INET-NOPS-QR-OPERATIONS-MANUAL.md)

## Operations And Go-live

- [Production Deployment and Operations Index](./PRODUCTION-DEPLOYMENT-OPERATIONS-INDEX.md)
- [Production Readiness Checklist](./production-readiness-checklist.md)
- [Production Environment Checklist](./production-env-checklist.md)
- [Go-live Evidence Checklist](./go-live-evidence-checklist.md)
- [Supabase Migration Runbook](./supabase-migration-runbook.md)
- [RLS Verification Checklist](./rls-verification-checklist.md)
- [Monitoring and Alerting Runbook](./monitoring-alerting-runbook.md)
- [Incident Runbook](./incident-runbook.md)

## Archived Or Historical

Do not use archived QR login docs as current implementation guidance. The active flow is store code, branch, employee, device, then POS.

- [QR Login Decommission Record](./ARCHIVE-QR-DECOMMISSION-2026-05-31.md)
- `docs/AI-HANDOFF-QRSCAN-REGISTER-2026-05-28.md`
- `docs/AI-HANDOFF-I18N-QRSCAN-2026-05-28.md`
- Older audit docs that mention `/scan`, `/qr-scan`, `/login/qr-*`, or `/api/auth/qr/*`

## Preflight Commands

When PATH is missing Node/Git, use the installed Windows paths:

```powershell
$env:Path="C:\Program Files\nodejs;C:\Program Files\Git\cmd;$env:Path"
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web exec vitest run --cache false
corepack pnpm --filter backoffice-web exec eslint src scripts tests next.config.ts eslint.config.mjs --cache --cache-location ..\..\.tmp-eslintcache --no-error-on-unmatched-pattern
corepack pnpm schema:drift
corepack pnpm --filter backoffice-web build
```

If build or lint fails with `EPERM` against `.next`, `.eslintcache`, or `node_modules/.vite`, clear the locked cache from an elevated/local user shell or use a clean checkout before treating it as a code failure.

## Current CI Branch Coverage

CI must cover `main`, `develop`, `hotfix/**`, and the current development/default branch `agent-docs-preflight-schema-drift` until the branch strategy is finalized in GitHub settings.
