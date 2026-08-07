# CpIPOS IT Admin — Repository Split (2026-08-07)

Date: 2026-08-07
Status: **In progress. Code extracted and deployed to a new repo/Vercel project. NOT yet verified end-to-end by a human. Do not delete IT-admin code from this repo (`apps/backoffice-web`) until verification below is confirmed complete.**

## Why

User request 2026-08-07: split IT-admin out of the CpIPOS monorepo into its own project so it can have **separate GitHub access control per team** — this is an access-control decision, not primarily a build/deploy-collision fix (confirmed via direct clarifying questions; build/deploy collision is real too — `/it-admin` was a route group inside `apps/backoffice-web`, same Next.js app/build/Vercel project as POS — but it is not the reason this split was requested).

This is a deliberate reversal of a smaller decision, not a contradiction of it: `docs/CPIPOS-MOBILE-AND-IT-ADMIN-CONSOLIDATION-PLAN-2026-08-06.md` Part 2 originally chose to package CpIPOS's *own* IT-admin web surface as a Windows app (`apps/windows-runtime-it-admin`) rather than reuse the old separate `SSTiPOSSupport` project, specifically because a separately-maintained IT-admin codebase had gone stale (~7 weeks, unmaintained) once it diverged from the main product. This 2026-08-07 split is different in kind: it is a one-time code export ("vendor/fork"), not an ongoing parallel codebase intended to diverge — see "Extraction strategy" below for why that distinction matters and is expected to avoid repeating the earlier staleness problem.

## What moved

- New GitHub repo: **`https://github.com/sstdevelopaminno/CpIPOS-IT-Admin`** (private — was briefly created as **public** by mistake by a different tool/flow before this repo existed on disk; corrected to private the same session, before any external traffic. If you ever see this repo public again, that is wrong — fix it immediately.)
- Local folder: **`E:\CpIPOS-IT-Admin`** (sibling to `E:\CpIPOS`, not nested inside it)
- Vercel project: **`cpipos-it-admin`** (team `sstdevelopaminnos-projects`), live at `https://cpipos-it-admin.vercel.app`. Same Supabase project as CpIPOS (`deejlitaivfnsbwqdugy`) — no database migration, `it_admin` is a `platform_role` value on the same `users_profiles` table CpIPOS uses, not a separate auth system.
- The Windows wrapper (`Cpipos.ITAdminRuntime`) moved with it, now at `E:\CpIPOS-IT-Admin\windows-runtime\` — **its `Program.cs` hardcoded URL still points at the OLD domain** (`https://cp-ipos-web.vercel.app/it-admin/login`) and has not been updated yet. Do not repoint it until the new deployment is verified working (see Blockers).
- The `/download/it-admin` page and its GitHub-Releases redirect route moved into the new repo too.

## Extraction strategy — vendor/fork, not a shared package

IT-admin code had almost no coupling to the rest of `apps/backoffice-web`: zero `@pos/ui` design-system usage, and only 3 type names imported from `@pos/shared-types` (now inlined locally). Given that low coupling and that this is a one-time split (not an ongoing dual-maintained fork), the code was **copied and adapted**, not published as a shared package consumed by both repos. The one deliberate exception, documented in both repos:

- `src/lib/device-commands.ts` (the MDM command-type allowlist) exists as an independent copy in both `E:\CpIPOS\apps\backoffice-web\src\lib\device-commands.ts` (POS device-heartbeat side, consumes commands) and `E:\CpIPOS-IT-Admin\src\lib\device-commands.ts` (IT-admin side, issues commands). **These must be kept in sync by hand.** If you add/change a command type on one side, update the other. There is no tooling enforcing this.

`auth-context.ts` was forked, not copied verbatim: the CpIPOS original pulls in `pos-session-guard.ts` for POS-session concerns IT-admin never used (confirmed by grep: no copied IT-admin code reads `.tenantId`/`.branchId`/`.branchRole` off `AuthContext`, only `.userId`/`.platformRole`, always with `requireBranchScope: false` — IT-admin login is pure Supabase Auth via `signInWithPassword`, no POS session cookie involved). The new repo's `auth-context.ts` is a simplified version that only resolves the Supabase user and their `platform_role`.

## What stays in CpIPOS (not moved, and why)

`apps/backoffice-web/src/lib/activation-admin-guard.ts` and the 4 routes that use it — `api/it-admin/admin/activation-tokens`, `api/it-admin/admin/device-enrollments`, `.../[id]/approve`, `.../[id]/revoke` (plus their `v1/*` re-export shims, 8 files total) — were **not** moved. This guard is shared with `owner`/`manager` branch roles, not IT-admin-exclusive; moving it would directly affect POS/backoffice functionality. IT-admin staff still use this one feature through `apps/backoffice-web` as before — this is an intentional, permanent scope boundary, not a temporary gap.

## Known runtime gap in the new repo

`/it-admin/monitoring` (page copied as instructed) calls `/api/admin/pos/monitor`, a route that pulls in POS-specific infra (`mapWithConcurrency`, `POS_GUARDS`, tenant-scoped logic) and was intentionally **not** vendored — out of scope for an IT-admin extraction. That page will 404 at runtime in the new repo until someone deliberately decides whether to vendor that route too or remove the page.

## Current blockers (as of 2026-08-07) — read before assuming this is done

1. **`SUPABASE_SERVICE_ROLE_KEY` is not set on the new Vercel project.** Vercel stores this var as "sensitive" on the old `cp-ipos-web` project, which makes it write-only — it cannot be read back via CLI/API by anyone, including this AI session. It must be entered directly by a human into the `cpipos-it-admin` Vercel project's dashboard (Settings → Environment Variables). Until this is set, IT-admin API routes that use `getSupabaseServiceClient()` (effectively all of them) will fail at runtime.
2. **No human has completed a real login test yet.** The deployment sits behind Vercel's team SSO protection (same as `cp-ipos-web` and `cp-ipos-mobile` — expected, not a bug), so this AI session cannot curl-test the login flow from outside. A human with Vercel team access needs to open `https://cpipos-it-admin.vercel.app/it-admin/login` in a browser and confirm a real `it_admin` account can log in and load at least one tenant page.
3. Until both of the above are confirmed working, **do not delete IT-admin code from `apps/backoffice-web`**, do not repoint the Windows wrapper's `Program.cs` URL, and do not remove `apps/windows-runtime-it-admin`, `build-it-admin-runtime.yml`, or `/download/it-admin` from this repo.

## DO NOT (for future AI sessions and developers)

- Do not assume this extraction is "done" because `pnpm typecheck`/`pnpm build` passed in the new repo — that only proves the code compiles, not that it works against real Supabase data or that login succeeds.
- Do not add a shared npm package between `CpIPOS` and `CpIPOS-IT-Admin` to "fix" the `device-commands.ts` duplication — that reintroduces the cross-repo coupling this split was meant to remove. Keep syncing it by hand; it changes rarely.
- Do not delete anything IT-admin-related from this repo (`apps/backoffice-web`, `apps/windows-runtime-it-admin`) until the Blockers above are explicitly resolved and the user gives a specific go-ahead for cleanup — this was an explicit checkpoint in the approved plan, not an oversight.
- Do not re-create the `CpIPOS-IT-Admin` GitHub repo as public.

## Next steps (in order)

1. User adds `SUPABASE_SERVICE_ROLE_KEY` to the `cpipos-it-admin` Vercel project.
2. User logs into `https://cpipos-it-admin.vercel.app/it-admin/login` and confirms it works end-to-end.
3. Update `windows-runtime/Cpipos.ITAdminRuntime/Program.cs` (`ProductionAppUrl` and `IsProductionAppUri`) in `E:\CpIPOS-IT-Admin` to point at the verified new domain.
4. Only after 1–3 are confirmed: remove IT-admin code from `apps/backoffice-web` in this repo (route group, `api/it-admin/**` minus the 8 files listed above, `it-admin-guard.ts`, `components/it-admin/**`, `lib/services/it-admin/**`), remove `apps/windows-runtime-it-admin`, remove `.github/workflows/build-it-admin-runtime.yml`, remove `/download/it-admin` pages, and update `docs/ACTIVE-DOCS-INDEX.md` to reflect the completed split.
