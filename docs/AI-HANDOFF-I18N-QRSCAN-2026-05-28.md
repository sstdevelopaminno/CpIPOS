> [!WARNING]
> ARCHIVED (2026-05-31): This document references legacy QR login flow and is kept for historical/audit context only.
> Active runtime flow: apps/backoffice-web `/login/store -> /login/branches|employee -> /login/devices`.
> See: `docs/ARCHIVE-QR-DECOMMISSION-2026-05-31.md`.
# AI Handoff: i18n + QR Scan Login UI (2026-05-28)

## Scope Completed
- Fixed Thai mojibake text in QR login web pages.
- Added Thai/English runtime language switching (persisted with cookie/localStorage key: `sstipos_lang`).
- Updated root layout language attribute to follow selected language.
- Updated mobile install section behavior to support i18n and button-only mode.
- Aligned QR login UI with latest requirements:
  - `/qr-scan` is the primary entry page.
  - Removed numbered labels `1)` and `2)` from store/user fields on QR entry page.
  - Store login and QR scan pages now show install button only (no instruction text block).

## Files Updated
- `apps/qr-login-web/src/lib/app-language-client.ts`
- `apps/qr-login-web/src/lib/app-language-server.ts`
- `apps/qr-login-web/src/components/i18n/app-language-switcher.tsx`
- `apps/qr-login-web/src/components/pwa/mobile-install-guide.tsx`
- `apps/qr-login-web/src/app/layout.tsx`
- `apps/qr-login-web/src/app/qr-scan/page.tsx`
- `apps/qr-login-web/src/app/qr-scan/register/page.tsx`
- `apps/qr-login-web/src/app/login/store/page.tsx`
- `apps/qr-login-web/src/app/login/qr-scan/page.tsx`
- `apps/qr-login-web/src/app/scan/page.tsx`
- `apps/qr-login-web/src/app/globals.css`

## Validation Run
- `corepack pnpm --filter qr-login-web typecheck` ✅
- `corepack pnpm --filter qr-login-web exec eslint src` ✅
- Note: `corepack pnpm --filter qr-login-web lint` checks `.open-next` generated files and currently fails there due external config/rule mismatch; source code lint is clean.

## Current Functional Flow (Login -> POS)
1. User opens `qr-login-web` root (`/`) and is redirected to `/qr-scan`.
2. User verifies store code + employee name.
3. System routes by branch model:
   - multi-branch -> `/login/branches`
   - single branch -> `/login/employee` or `/login/devices` as returned by API
4. QR approval step at `/login/qr-scan` supports:
   - camera scan
   - fallback token paste
5. After approval, flow continues to POS handoff (`/login/qr-success`) and then POS session pages in backoffice app.

## Next Suggested Phase
- Mobile-first QR scanner UI phase:
  - tighten ergonomics for one-hand use
  - larger CTA + status feedback
  - camera permission empty states
- Full E2E rerun with screenshots:
  - login flow
  - branch/device
  - POS entry with active session
- Optional: add central i18n dictionary extraction for all remaining `qr-login-web` pages.
