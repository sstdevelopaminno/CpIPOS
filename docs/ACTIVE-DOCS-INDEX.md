# Active Documentation Index

Last reviewed: 2026-08-02

Use this page as the first stop before new development. It separates active implementation guidance from historical QR-era material.

## Current Runtime

- App: `apps/backoffice-web`
- Mobile app: `apps/pos-mobile-web` (CpIPOS Mobile, imported 2026-08-06 from `E:\SSTiPOSMobile` — see consolidation plan below; not yet deployed)
- Workspace: `E:\CpIPOS`
- GitHub repo: `https://github.com/sstdevelopaminno/CpIPOS.git`
- Active branch/default branch: `agent-docs-preflight-schema-drift`
- Login flow: `/login/store -> /login/branches|employee -> /login/devices -> /preview/pos`
- Identity anchor: store code is the required starting identity for CpIPOS Web, CpIPOS Windows, and future CpIPOS app runtimes.
- Database: Supabase migrations in `supabase/migrations`
- Verification baseline: run `typecheck`, `test`, `lint`, `schema:drift`, and `build` before closing implementation work.
- Latest printing decision: Web Serial is no longer the default. Use Print Adapter Architecture 2026-08-02; default small-shop adapter is `LOCAL_BRIDGE_WINDOWS`.
- Latest Windows runtime direction: CpIPOS Windows is an installable WebView2 runtime with local SQLite offline foundation, local print bridge, and package/license entitlements resolved from store code.
- Latest production/Vercel print-performance handoff: commit `08afac88ce6e1bbc28f34310f1c43773e72ec104` was checked as Vercel `success` on 2026-08-02.
- Latest local baseline on 2026-07-29 passed frozen install, typecheck, Vitest, full lint, schema drift, and production build for `backoffice-web`. Re-run the baseline locally after pulling 2026-08-02 changes.

## Read First

- [CpIPOS Mobile + IT Admin Consolidation Plan 2026-08-06](./CPIPOS-MOBILE-AND-IT-ADMIN-CONSOLIDATION-PLAN-2026-08-06.md)
- [Android APK Phase 1 2026-08-06](./ANDROID-APK-PHASE1-2026-08-06.md)
- [POS Bluetooth Print + Cash Drawer 2026-08-06](./POS-BLUETOOTH-PRINT-DRAWER-2026-08-06.md)
- [POS Stability Fixes 2026-08-06](./POS-STABILITY-FIXES-2026-08-06.md)
- [AI Development Preflight](./AI-DEVELOPMENT-PREFLIGHT.md)
- [CpIPOS Handoff 2026-08-02](./CPIPOS-HANDOFF-2026-08-02.md)
- [CpIPOS Windows Offline + Package Entitlement 2026-08-02](./CPIPOS-WINDOWS-OFFLINE-PACKAGE-ENTITLEMENT-2026-08-02.md)
- [CpIPOS Windows Runtime IT API Contract 2026-08-02](./CPIPOS-WINDOWS-RUNTIME-IT-API-CONTRACT-2026-08-02.md)
- [Print Adapter Architecture 2026-08-02](./PRINT-ADAPTER-ARCHITECTURE-2026-08-02.md)
- [Local Print Bridge Windows 2026-08-02](./LOCAL-PRINT-BRIDGE-WINDOWS-2026-08-02.md)
- [CpIPOS Handoff 2026-07-28](./CPIPOS-HANDOFF-2026-07-28.md)
- [CpIPOS AI Guardrails](./AI-GUARDRAILS-CPIPOS.md)
- [CpIPOS Production Checkpoint](./CPIPOS-PRODUCTION-CHECKPOINT-2026-07-27.md)
- [Local Dev Login Performance Checkpoint](./LOCAL-DEV-LOGIN-PERFORMANCE-2026-07-27.md)
- [Stability / Network / API Audit 2026-07-28](./STABILITY-NETWORK-API-AUDIT-2026-07-28.md)
- [System Recheck 2026-07-28](./SYSTEM-RECHECK-2026-07-28.md)
- [IT Backoffice API Design 2026-07-28](./IT-BACKOFFICE-API-DESIGN-2026-07-28.md)
- [POS Printing And Receipt Audit 2026-07-29](./POS-PRINTING-RECEIPT-AUDIT-2026-07-29.md)
- [Cross-Platform Web POS Printing 2026-08-02](./CROSS-PLATFORM-WEB-POS-PRINTING.md)
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
- [CpIPOS Windows Offline + Package Entitlement 2026-08-02](./CPIPOS-WINDOWS-OFFLINE-PACKAGE-ENTITLEMENT-2026-08-02.md)
- [CpIPOS Windows Runtime IT API Contract 2026-08-02](./CPIPOS-WINDOWS-RUNTIME-IT-API-CONTRACT-2026-08-02.md)
- [POS Catalog And Stock Checkpoint](./POS-CATALOG-STOCK-CHECKPOINT-2026-07-22.md)
- [POS Catalog Trash And Modifier Checkpoint](./POS-CATALOG-TRASH-MODIFIER-CHECKPOINT-2026-07-22.md)
- [POS Menu Modifiers And Ingredient Options](./POS-MENU-MODIFIERS-INGREDIENTS-PLAN-2026-07-22.md)
- [POS Shift Close Reliability](./POS-SHIFT-CLOSE-RELIABILITY-2026-07-10.md)
- [POS Printing And Receipt Audit 2026-07-29](./POS-PRINTING-RECEIPT-AUDIT-2026-07-29.md)
- [Print Adapter Architecture 2026-08-02](./PRINT-ADAPTER-ARCHITECTURE-2026-08-02.md)
- [Local Print Bridge Windows 2026-08-02](./LOCAL-PRINT-BRIDGE-WINDOWS-2026-08-02.md)
- [Cross-Platform Web POS Printing 2026-08-02](./CROSS-PLATFORM-WEB-POS-PRINTING.md)
- [CpIPOS Handoff 2026-08-02](./CPIPOS-HANDOFF-2026-08-02.md)
- [POS Navigation Settings 2026-07-29](./POS-NAVIGATION-SETTINGS-2026-07-29.md)
- [POS Table QR Live Order And Payment Lock 2026-07-30](./POS-TABLE-QR-LIVE-ORDER-LOCK-2026-07-30.md)
- [POS Print Agent v1 Design 2026-07-29](./POS-PRINT-AGENT-V1-DESIGN-2026-07-29.md)
- [POS Login Device Splash](./POS-LOGIN-DEVICE-SPLASH-2026-07-11.md)
- [POS Single Register Mode 2026-08-01](./POS-SINGLE-REGISTER-MODE-2026-08-01.md)
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
- `docs/NEW-CHAT-BOOTSTRAP-PROMPT-2026-05-28.txt`
- `docs/AI-HANDOFF-QRSCAN-REGISTER-2026-05-28.md`
- `docs/AI-HANDOFF-I18N-QRSCAN-2026-05-28.md`
- Older audit docs that mention `/scan`, `/qr-scan`, `/login/qr-*`, or `/api/auth/qr/*`

## Preflight Commands

When PATH is missing Node/Git, use the installed Windows paths:

```powershell
$env:Path="C:\\Program Files\\nodejs;C:\\Program Files\\Git\\cmd;$env:Path"
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web exec vitest run --cache false
corepack pnpm --filter backoffice-web exec eslint src scripts tests next.config.ts eslint.config.mjs --cache --cache-location ..\\..\\.tmp-eslintcache --no-error-on-unmatched-pattern
corepack pnpm schema:drift
corepack pnpm --filter backoffice-web build
```

If build or lint fails with `EPERM` against `.next`, `.eslintcache`, or `node_modules/.vite`, clear the locked cache from an elevated/local user shell or use a clean checkout before treating it as a code failure.

## Pull Latest Local Source

GitHub is the source of truth. Vercel deploys from GitHub; do not try to pull Vercel build output back into the repository.

```powershell
$env:Path="C:\\Program Files\\nodejs;C:\\Program Files\\Git\\cmd;$env:Path"
cd E:\\CpIPOS
git status -sb
git fetch origin
git checkout agent-docs-preflight-schema-drift
git pull --ff-only origin agent-docs-preflight-schema-drift
```

If local changes exist:

```powershell
git stash push -u -m "local-backup-before-pull"
git pull --ff-only origin agent-docs-preflight-schema-drift
```
