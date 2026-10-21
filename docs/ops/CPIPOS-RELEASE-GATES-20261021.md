# CpiPOS release gates & read-only audit — 2026-10-21 (ICT)

> **Status: NO-GO for final signoff.** This is a read-only Production audit and follow-up plan. It does not authorize database writes, migration replay, financial test transactions, printer activation, or a Production deployment. The active production/integration source is `main`, not the GitHub repository default.

## Verified source & deployment

- Repository `sstdevelopaminno/CpIPOS`, production `main`: `a5cad2bf4369b76dbba17140c278a6c9935b3426` (CUSTOM tenant-wide device quota fix, PR #336).
- Latest checked CI push run on the above SHA: `39552439949`, success. Typecheck, lint, tests, CpiPOS-001/Trial source schema checks, migration-audit unit tests and web build passed. Green CI **does not establish** real device, signed-in cashier, or payment UAT.
- Vercel `cp-ipos-web` deployment `dpl_4sofKerxSp9EKuVdw7sT3ePeY5a3`: READY, Production, Git SHA `a5cad2bf`, aliases include `cp-ipos-web.vercel.app`.
- Production Vercel runtime error aggregation for the inspected 1h window reported no clusters; this does not prove availability outside retention or authenticated workflow correctness.

## Gate 1 — GitHub branch/release topology

- GitHub repository default remains `agent-docs-preflight-schema-drift`, but POS Production/integration is `main`. Their histories diverged (on 2026-10-21: `main` 244 commits ahead, one commit behind old default). Do **not** force merge/reset either branch.
- Legacy draft PR #257 (`main` -> old default) was **closed, not merged** on 2026-10-21.
- PR #252 still targets old default from a significantly stale feature branch; do not merge/retarget automatically without comparing the current `main` behavior and conflict resolution.
- Required **administrator settings change**, NOT a source-code change: set repository default branch to `main`, confirm Vercel production branch is `main`, update automation/branch references, then enable protection/rulesets for `main` with required CI, PR review, and no force-push.
- Re-read repo branch metadata and production SHA after each administration change. Do not deploy solely to change the GitHub default.

## Gate 2 — Supabase migration provenance and access

Read-only comparison between `main`'s `supabase/migrations/*.sql` and CpiPOS-001 migration-history metadata:

| Measure | Result |
| --- | ---: |
| Repository primary migration files | 225 |
| Live Primary migration-history entries | 320 |
| Exact matching version IDs | 129 |
| Repository-only version IDs | 96 |
| Database-only version IDs | 191 |
| Same version, different migration name | 0 |
| Same migration name but different version ID, unverified candidates | 56 |

These are metadata/version comparisons, **not** SQL semantic equivalence checks. A matching name is not evidence that a live migration and a source migration have identical bodies; a source-only version is **not** evidence of a missing table. Do not `db push`, bulk `migration repair`, replay backfills, or manually edit `supabase_migrations.schema_migrations`.

- Connected Supabase access verified CpiPOS-001 Primary; CpiPOS-002 Trial is **not** accessible to the current connector and must not be described as verified.
- Live Optical document-number helper privilege check: `anon=false`, `authenticated=false`, `service_role=true`; both optical document numbering triggers enabled.
- Live Security Advisor (at audit time): 28 authenticated-executable SECURITY DEFINER warnings; 104 RLS-enabled-with-no-policy informational findings; one leaked-password-protection setting warning. These require itemized permission review and are **not** a basis for blanket GRANT/REVOKE or opening RLS policies.
- Use `node scripts/audit-live-migration-history.mjs --history <private-export>.json` offline for each authorized data plane. Do not commit production exports/secrets. For candidate renamed migrations, verify full SQL/function definitions, ownership/GRANT/RLS, indexes, trigger identity, dependency order and live effects before mapping. Confirm Trial access with the authorized project owner.

## Gate 3 — Subscription/CUSTOM payments and POS authorization

- `main` contains focused fixes in PRs #317–#336 for expired trial messaging, canonical invoice display, verified-slip provisional access, IT manual review without automatic timeout, CUSTOM quote approval and tenant-wide provisioning limits.
- Evidence to gather using **controlled QA tenants only**: Trial expiry vs paid status, fixed Growth vs CUSTOM IT-approved invoice, bank slip amount/payee/reference/transfer-time validation, duplicate submission, denial before IT quote approval, provisional access while pending IT settlement, IT rejection rollback, locked cash-register refresh from LINE, and users/branches/device quota changes.
- Never infer a legitimate bank credit solely from OCR evidence. No live slip uploads or customer payment rewrites in this audit.
- **Live contract anomaly (read-only, same-day query):** one tenant currently has **three** simultaneously effective active/trial contract rows under a simple `started_at` / `ended_at` / `status` effective-window check. IT must reconcile authoritative billing/approval provenance before updating contracts or running Optical stock-adjustment UAT; do not pick the newest row or delete/supersede a contract by guesswork. Related staged IT guard PR #147 remains unmerged.
- Latest main CI passed but signed-in two-tenant/two-branch API and browser acceptance evidence is outstanding.

## Gate 4 — CUSTOM Optical ↔ IT ↔ CRM & hardware

- POS Drafts: #295 (IT API kill switches, staff permissions and staged RLS; `mergeable=false`), #296 (read-only QR deposit recall and printer-route 58/80; `mergeable=false`), #276 (isolated ledger/schema proposal). Keep these as Draft, do not merge or apply proposal SQL to live production without isolated DB E2E.
- Companion staged changes: IT #151 and CRM #36; verify server-side entitlements, approved CUSTOM menus, assigned branch staff authorization, and no cross-tenant/cross-branch customer/work-order access.
- Receipt QR is a scoped **locator only**, never proof of bank settlement or instruction to mutate inventory. Made-to-order work orders are separate from immediate ready-stock retail sales. Prevent duplicate work orders, double stock decrement and payment ledger duplication across retries.
- Live CpiPOS-001 has eight printer profiles, **all disabled** (seven receipt, one kitchen) at audit time. No physical thermal/kitchen printer acceptance can be asserted. Only qualified on-site staff should select and validate the real tenant/branch/device profile, endpoint, paper width and QR/raster capability before enabling it; never guess IP, blindly resend old jobs, or change device assignments during an audit.
- Validate customer receipts at 58/80 mm, CRM A5 job sheet, scanning of the exact order, manager-PIN checks, LAK/THB historical money separation, cash reconciliation and shift close with authenticated, instrumented UAT.

## Gate 5 — Final production acceptance: still OPEN

Track using #153 (POS stabilization), #74 (physical print), #261 (Optical rollout) and #274 (THB/LAK/USD). Require evidence for:

1. Production SHA/alias match, no sustained 5xx cluster, and safe rollback path.
2. Sign in by store/employee/device and role; shift open/close, cash drawer and locked entitlement states.
3. FG/FF/SD checkout, stock once, receipts, Table QR approve/reject, Kitchen and Customer Display.
4. Verified subscription + CUSTOM checkout ledger, Provisional/IT review/settlement/rejection, tenant-wide device/users/branches quotas.
5. Optical work order vs ready-stock, customer and prescription history, partial deposit/final settlement, dedupe, cross-tenant denial, scoped CRM Staff/Owner and printer routing.
6. Real assigned printers and Android install/update/ACK verified on physical customer equipment.

**Release decision:** do not close issues or claim complete Production/Optical/printing UAT until signed-in test evidence, isolated migration verification and real hardware signoff exist.

## Cross-system scope and safety

The connected Supabase account currently exposes Primary CpiPOS-001 plus the separate Communications project, but **not** Trial CpiPOS-002. Preserve the existing Primary/Trial architecture; do not create a paid database project. Do not modify any live contracts, payments, customers, stock, printer profiles, user permissions, secrets, or migrations as part of this documentation audit.

Reference: `docs/ops/CPIPOS-PRODUCTION-READINESS-20261020.md`, `AGENTS.md`, `docs/CpIPOS_MASTER_SYSTEM_SCOPE.md`.
