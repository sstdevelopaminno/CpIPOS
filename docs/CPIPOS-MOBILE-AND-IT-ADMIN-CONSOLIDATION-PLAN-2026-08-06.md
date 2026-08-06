# CpIPOS Mobile + IT Admin Consolidation Plan — 2026-08-06

Status: **Plan confirmed by user. Not yet implemented.** This document is the required reading before starting this work — read it fully before touching `apps/pos-android`, before creating any new mobile/IT-admin workspace package, and before writing any MDM code.

## Why this document exists

The user asked to fold two separate, pre-existing sibling projects into CpIPOS:

- `E:\SSTiPOSMobile` — a mobile POS web app, wanted as **"CpIPOS Mobile"**.
- `E:\SSTiPOSSupport` — an IT/backoffice admin system, wanted as **the Windows-installable IT control center for the whole CpIPOS product line**, eventually including MDM (remote diagnose/fix/push-update for customer devices).

Both were investigated read-only this round (no files in either project were modified; nothing in `E:\CpIPOS` was touched by that investigation). The findings changed the shape of the plan from a literal "merge both codebases in" to something more specific — read the findings below before assuming either project's code should be copied wholesale.

## Confirmed decision (user approved 2026-08-06)

1. **Adopt `SSTiPOSMobile` as CpIPOS Mobile for real** — bring it into the monorepo, keep its code (it's good).
2. **Do NOT copy `SSTiPOSSupport`'s code into CpIPOS.** CpIPOS's own `apps/backoffice-web/src/app/api/it-admin/**` surface is already a newer, refactored superset of what SSTiPOSSupport does. Instead: package CpIPOS's *own* existing IT-admin web surface as a Windows-installable desktop app, the same way `apps/windows-runtime-native` wraps the POS web UI.
3. **MDM does not exist anywhere yet** (not in CpIPOS, not in SSTiPOSMobile, not in SSTiPOSSupport). It needs to be designed and built from scratch as its own phase — do not assume any existing device-control code can be reused beyond what's already documented in `docs/CPIPOS-WINDOWS-RUNTIME-IT-API-CONTRACT-2026-08-02.md` and `docs/device-heartbeat-api-foundation.md` / `docs/device-mdm-diagnostics-foundation.md` (CpIPOS already has some device-heartbeat/diagnostics foundation work — read those two docs before designing MDM, they may already cover part of this).

## Part 1 — SSTiPOSMobile → CpIPOS Mobile

### Findings (read-only investigation, 2026-08-06)

- **Tech stack**: Next.js 15 / React 19 App Router, pnpm, TypeScript, Tailwind, Vitest. It is a **PWA** (`public/manifest.json`, `public/sw.js`) — there is no native Android/iOS project, no Capacitor, no Expo. It is architecturally the same *class* of thing as `apps/pos-android`'s WebView shell (a mobile web app meant to be viewed fullscreen), not a genuinely different native app.
- **Database**: `.env.local` → `NEXT_PUBLIC_SUPABASE_URL` = `deejlitaivfnsbwqdugy.supabase.co` — **the exact same Supabase project CpIPOS uses.** Not aspirational, actually wired that way today.
- **Branding**: Already internally self-identifies as **"CpIPOS Mobile"** in session metadata (`source_app: "CpIPOS Mobile"`) and in `login/store/page.tsx` subtitle text. This rename/alignment already happened in a prior work pass on that project, independent of this session.
- **Auth/login flow**: `store-code → branch → employee-code → device → session`, same shape as CpIPOS's current flow (`src/lib/auth/mobile-auth-service.ts`), backed by the same shared tables (`tenants`, `branches`, `user_branch_roles`, `branch_devices`, `pos_sessions`, `pos_login_contexts`, `shifts`). No old QR-login code exists in it (grep across `src/lib/auth`, `src/app/login`, `src/app/api/auth` found nothing QR-login-related — the only "qr" hit is an unrelated PromptPay payment-QR generator).
- **API surface** (`src/app/api/`): `auth/{store-code/verify, branches/select, employee/verify, devices/select, session/current, session/logout}`, `mobile/{dashboard, features, shifts, stock}`, `mobile/sales/takeaway/{checkout,hold,cancel,held,held/restore,member}`, `mobile/sales/dine-in/{checkout,hold,cancel}`, `mobile/members*`, `mobile/notifications/{send,subscribe,vapid-public-key}`, `mobile/payments/qr`, `system/{notifications/deploy,version}`.
- **Code quality**: clean — zero TODO/FIXME/HACK/console.log found in `src`, no hardcoded secrets, checkout routes use Zod `safeParse` + try/catch. Actively maintained (commits into late July 2026).
- **Known functional gap**: table and delivery sales **write** flows are still placeholders/read-only per the project's own README — a real gap, not hidden or accidental.
- **Largest file**: `src/components/sales/takeaway-cart-shell.tsx` at 1301 lines — worth a future split, not urgent, nowhere near the severity of CpIPOS's own `pos-sales-module.tsx` (~9,700 lines) problem.
- **Stale artifacts at repo root**: several `tmp-next-*.log` / `.next-stale-*` dev-server leftover directories — cosmetic cleanup only, same class of issue this session already fixed for CpIPOS's own `.gitignore`.

### Overlap with `apps/pos-android` (built earlier this session, 2026-08-06)

`apps/pos-android` (package `com.cpipos.pos`) is a Phase 1 Android WebView shell that currently loads `https://cp-ipos-web.vercel.app/login/store` — i.e., it wraps `apps/backoffice-web`'s desktop-oriented POS UI in a fullscreen Android shell. SSTiPOSMobile is a *separate*, purpose-built mobile web UI already optimized for phone/small-tablet screens (Thai-first, bottom nav, 360-430px targets). Running both is redundant and would double the login/session surface against the same Supabase tables for no benefit.

**Recommended resolution (not yet done):** once SSTiPOSMobile is adopted into the monorepo and deployed, repoint `apps/pos-android`'s `MainActivity.kt` `DEFAULT_START_URL` from CpIPOS Web's `/login/store` to CpIPOS Mobile's deployed URL. The APK shell, CI workflow, and `/download/android` page built this session do **not** need to be rebuilt from scratch — only the target URL changes. Decide at that point whether the APK should keep the `com.cpipos.pos` identity/branding as-is (recommended — it's already live and downloaded) or whether a rename is worth the churn of losing existing installs.

### Suggested integration steps (not yet started — for the next work session)

1. Copy/import `E:\SSTiPOSMobile` into the CpIPOS monorepo as a new workspace app, e.g. `apps/pos-mobile-web` (add to `pnpm-workspace.yaml`, reconcile `package.json` name/version against monorepo conventions).
2. Reconcile environment variables against CpIPOS's `.env.local`/Vercel env — confirm no drift in Supabase anon key, `POS_SESSION_HANDOFF_SECRET`-equivalent, etc. Do **not** assume they're identical without checking; the projects may have diverged env var names even while pointing at the same Supabase project.
3. Decide deployment target: separate Vercel project (e.g. `cp-ipos-mobile.vercel.app`) vs. a route group inside the existing `backoffice-web` deployment. A separate deployment is lower-risk and matches how it already runs today; a merged deployment is more "one codebase" but is a bigger, riskier change. No decision made yet — ask the user.
4. Run CpIPOS's standard verification baseline (`typecheck`, `vitest`, `eslint`, `schema:drift`, `build`) against the imported app once it's wired in.
5. Decide fate of the table/delivery write-flow gap — either finish it as part of this integration, or explicitly document it as a known gap (matching how this project's own README already flags it).
6. Repoint `apps/pos-android` per above, once CpIPOS Mobile has a stable deployed URL.
7. Clean up the stale `tmp-next-*`/`.next-stale-*` artifacts and add matching `.gitignore` entries (same pattern as this session's earlier `.NET`/eslint-cache gitignore fix).
8. Update `docs/ANDROID-APK-PHASE1-2026-08-06.md` and `docs/ACTIVE-DOCS-INDEX.md` once this lands.

## Part 2 — IT Admin: package CpIPOS's own surface as a Windows app (not SSTiPOSSupport's code)

### Findings (read-only investigation, 2026-08-06)

- **SSTiPOSSupport tech stack**: Next.js 15 monorepo (pnpm/Turborepo), deployed to Vercel/Cloudflare. **Web-only — no Electron/Tauri/native wrapper exists in it at all** (confirmed via grep, zero hits). It is actually a split-off of a larger "SSTiPOS / POS-Preview" codebase — the full POS app (sales/shift/delivery/printing) is still physically present in the tree, gated down to admin-only via `APP_SURFACE=it_admin` in production. Last commit `464d9ed`, 2026-06-18 — **about 7 weeks stale** as of this writing. Its own README/docs state it is "improved, but not yet 100% production complete."
- **Database**: same Supabase project as CpIPOS (`deejlitaivfnsbwqdugy`), confirmed live via `.env.local`. Its own README explicitly says "Database: same existing Supabase project/database as POS. Do not create a new Supabase project" — this was already a known, intentional architecture choice by a prior team/session, not something CpIPOS is now discovering.
- **Auth model**: Supabase Auth + server-resolved `platform_role` (`it_admin`, `it_support`, `tenant_user`), same session/auth mechanism family CpIPOS uses — not a separate identity system.
- **API surface**: `admin/tenants` (+ nested branches/contract/devices/features/login-policies/sessions/shifts/users), `admin/activation-tokens`, `admin/audit-logs`, `admin/device-enrollments`, `packages` (+ quote, contracts), `customer-display/{devices,policies}`, `auth/{login,logout}`, `tenants` (list).
- **The critical finding**: CpIPOS's own `apps/backoffice-web/src/app/api/it-admin/**` already implements almost every one of those routes — same paths, same purpose — refactored into a `lib/services/it-admin/tenant-admin-service` service layer that SSTiPOSSupport doesn't have. **CpIPOS additionally has a newer `api/it-admin/v1/**` layer (tenant suspend/reactivate, health check, packages-by-id) that SSTiPOSSupport does not have at all.** SSTiPOSSupport is not a different system to merge — it is an earlier, staler snapshot of the same feature set CpIPOS has already moved past.
- **UI**: functional, role-gated, proper "Forbidden" fallbacks, real dashboard shell — not rough, but not meaningfully better than what CpIPOS already has either.
- **No bugs of note found** in SSTiPOSSupport's it-admin code (no TODO/FIXME, no hardcoded secrets, reasonable error handling) — the issue isn't code quality, it's that it's the wrong (older) copy of functionality CpIPOS has already improved on.

### What to actually build (not started)

The user's real goal — "IT backoffice as a downloadable Windows program, controlling the whole POS system including packages, and eventually MDM" — should be met by **wrapping CpIPOS's own existing IT-admin web surface**, not SSTiPOSSupport's:

1. Read `docs/WINDOWS-NATIVE-RUNTIME-EXE-2026-08-02.md` and `docs/WINDOWS-RUNTIME-MVP-2026-08-02.md` first — the POS Windows Runtime (`apps/windows-runtime-native`) is the direct template to follow. This new IT-admin desktop wrapper should very likely be a **second, small WebView2 shell app** (same general shape as `Cpipos.WindowsRuntime`, new project e.g. `Cpipos.ITAdminRuntime` or a `--mode=it-admin` flag on the existing one — decide which is cleaner once actually scoping this) that loads CpIPOS's own `/it-admin/login` route fullscreen, instead of `/login/store`.
2. It does **not** need its own Local Print Bridge, cash drawer, or POS-specific bridge methods — those are POS-terminal concerns, irrelevant to an admin console. Keep the IT-admin wrapper deliberately minimal (closer in spirit to `apps/pos-android`'s Phase 1 minimalism than to the full POS Windows Runtime's bridge complexity).
3. Add a `/download/it-admin` (or similarly named) page + `/download/it-admin/latest` redirect route, mirroring `/download/windows-runtime` and `/download/android` exactly (same GitHub Release pattern, same `DownloadPageShell` component already built this session — reuse it, don't rebuild).
4. Add a manual `workflow_dispatch` GitHub Actions build, mirroring `.github/workflows/build-windows-runtime.yml`.
5. Once this exists, `E:\SSTiPOSSupport` can be considered fully superseded — do not delete it without the user's explicit go-ahead (it's outside this repo and not this AI's to delete), but stop treating it as a system requiring compatibility/parity checks going forward, since CpIPOS's own IT-admin surface is now the sole source of truth per this confirmed decision.

## Part 3 — MDM (Mobile Device Management) — ground-up design needed

Nothing resembling MDM exists yet in CpIPOS, SSTiPOSMobile, or SSTiPOSSupport. Before writing any code:

1. Read `docs/device-heartbeat-api-foundation.md`, `docs/device-mdm-diagnostics-foundation.md`, and `docs/device-mdm-diagnostics-phase-1-summary.md` — CpIPOS already has *some* foundation-level work here (heartbeat API, diagnostics). Do not assume a blank slate; check what's already built before designing new tables/endpoints.
2. Read `docs/CPIPOS-WINDOWS-RUNTIME-IT-API-CONTRACT-2026-08-02.md` and `docs/CPIPOS-WINDOWS-OFFLINE-PACKAGE-ENTITLEMENT-2026-08-02.md` — these already define IT-admin control over Windows Runtime activation/entitlements, which is adjacent to (maybe overlapping with) what "MDM" means here.
3. The user's stated MDM scope: remotely diagnose issues on customer devices, push fixes/updates immediately, connected to the IT-admin backend, covering **all** CpIPOS surfaces (Web, Windows Runtime, Android APK, CpIPOS Mobile once adopted). This is a genuinely large, security-sensitive feature (remote code/config push to production customer devices) — it needs its own dedicated planning document and explicit user sign-off on the security model (auth, scoping, audit logging, rollback) before any implementation starts. Do not start writing MDM code from this document alone; write a dedicated MDM design doc first and confirm it with the user, the same way this document itself was confirmed before starting Part 1/Part 2 work.

## Guardrails for whoever continues this work

- Do not copy SSTiPOSSupport's `it-admin` code into CpIPOS. CpIPOS's own is newer and more complete — confirmed by direct route-by-route comparison, not assumption.
- Do not build a second, competing "CpIPOS Mobile" from scratch — SSTiPOSMobile already exists, is already CpIPOS-branded internally, and already shares the production database. Import it.
- Do not run both `apps/pos-android` (pointed at backoffice-web) and an adopted SSTiPOSMobile app as permanently separate, unrelated Android surfaces — repoint one into the other per Part 1.
- Do not start MDM implementation without a dedicated design doc and explicit user confirmation of the security model — this is the highest-risk piece of the whole plan (remote control of customer production devices).
- Neither SSTiPOSMobile nor SSTiPOSSupport source trees were modified by the investigation that produced this document — both remain exactly as they were on disk at `E:\SSTiPOSMobile` and `E:\SSTiPOSSupport`.
