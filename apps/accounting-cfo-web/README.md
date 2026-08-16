# Cutting Point Accounting & CFO Mobile PWA

Standalone, read-only management web app for the company accounting system.

## Isolation rules

- This directory is intentionally **not** part of the CpIPOS pnpm workspace.
- It must be deployed as a separate Vercel project with Root Directory `apps/accounting-cfo-web`.
- It does not import CpIPOS packages, POS auth/session code, or POS Supabase clients.
- It does not write to CpiPOS-001 or CpiPOS-002.
- Google Sheets and Google Drive are read through a read-only service account.
- Financial pages send `Cache-Control: private, no-store`.
- The PWA service worker never caches accounting responses.

## Roles

- `cfo`: dashboard, income, expenses, documents, bank, reports, marketing.
- `marketing`: limited dashboard, sales documents, sales/commission view. No expense/bank/loan view.

Initial authentication uses separate server-side access keys stored only in Vercel environment variables. The signed session cookie is HttpOnly and does not reuse POS cookies.

## Required environment variables

Copy `.env.example` values into the separate Vercel project. Share the source spreadsheets and accounting Drive folder with the Google service account as **Viewer** only.

## Production checklist

1. Create a separate Vercel project and set Root Directory to `apps/accounting-cfo-web`.
2. Do not reuse the `cp-ipos-web` Vercel project.
3. Add required environment variables only to the Accounting project.
4. Keep the service account read-only.
5. Build and verify `/login`, `/`, `/transactions`, `/documents`, `/bank`, `/reports`, `/marketing`.
6. Verify marketing role cannot open CFO-only routes.
7. Verify file view/download works only through signed URLs and an authenticated session.
