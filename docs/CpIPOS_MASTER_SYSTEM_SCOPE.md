# CpIPOS Master System Scope & Architecture

> Canonical continuity document for ChatGPT, Codex, maintainers, and future sessions.
>
> Audit snapshot: 2026-08-09 15:40 ICT
>
> Repository: `sstdevelopaminno/CpIPOS`
>
> Working branch at this checkpoint: `agent/printer-execution-queue`
>
> Verified functional checkpoint before documentation commits: `9160dc6f34c19bfcf3ac2279888d790b33381334` (`fix(print-agent): propagate claim attempt IDs`).

## 0. Continuity and source-of-truth rule

Before changing CpIPOS, read:

1. `README.md`
2. `context.md`
3. `AGENTS.md`
4. `docs/CpIPOS_MASTER_SYSTEM_SCOPE.md`
5. Only then inspect files directly related to the task.

When facts conflict, use this priority:

1. Current live GitHub working branch/commit.
2. Live Supabase schema, migration history, and data when database state matters.
3. This document and `context.md`.
4. Old ChatGPT/Codex conversation history only as fallback.

A checkpoint SHA is a snapshot, not a permanent HEAD. Re-fetch GitHub before every work package.

If ChatGPT/Codex history disappears, recover the latest pushed GitHub checkpoint first. Never infer that an unpushed or unverified chat instruction was completed.

---

## 1. System identity: multi-owner / multi-branch SaaS

CpIPOS is a **multi-tenant / multi-owner / multi-branch POS SaaS**.

```text
CpIPOS SaaS
└── Tenant / Owner
    ├── Branch A
    │   ├── users / roles
    │   ├── POS devices
    │   ├── tables / customer QR
    │   ├── orders / payments
    │   ├── inventory
    │   ├── Kitchen
    │   └── printers
    ├── Branch B
    └── Branch ...
```

Mandatory isolation:

- every tenant-scoped operation must enforce `tenant_id`;
- every branch-scoped operation must also enforce `branch_id`;
- never trust tenant, branch, role, device, price, totals, permissions, or authorization scope merely because the client sends it;
- authenticated server context and authoritative DB rules win;
- no cross-tenant/cross-branch leakage is acceptable;
- single-shop success is not sufficient proof for SaaS release.

---

## 2. UI and business-rule doctrine

### Web App = reference UI/UX

The Web App is the reference implementation for CpIPOS UI/UX. Android Tablet, Windows, and Mobile should follow the same terminology, navigation intent, workflow, important visual hierarchy, state meanings, permission behavior, and transaction flow.

Native clients may adapt controls to the platform, but must not invent conflicting business flows.

### Backend/API/DB = business-rule source of truth

Native/Web clients must not fork critical rules for:

- trusted prices and totals;
- inventory / negative-stock policy;
- orders and payments;
- Table QR submission;
- Kitchen routing;
- Print execution;
- package entitlement;
- tenant/branch/device authorization.

---

## 3. Production / Trial architecture

Live Supabase projects audited:

- **CpiPOS-001 / Primary** — project ref `deejlitaivfnsbwqdugy`.
- **CpiPOS-002 / Trial Data Plane** — project ref `kawenyvpentwgugtzqec`.

Routing invariants:

- `tenant_data_lifecycle.data_home` is runtime routing authority;
- `desired_data_home` is migration/lifecycle intent, not runtime routing authority;
- control-plane data stays on Primary;
- Trial business routing uses server-only Trial credentials;
- if Trial is authoritative and routing fails, fail closed;
- never silently fall back to Primary;
- never expose service-role credentials to Web/Mobile/Native clients.

### Audited lifecycle state

- NDL tenant: `data_home=primary`, unlocked.
- Trial tenant: `lifecycle_status=trial`, `data_home=primary`, `desired_data_home=trial`, `migration_status=verifying`, `access_locked=true`.

Therefore Trial cutover is **not completed**. Do not automatically unlock or change `data_home`.

### Required Trial -> Paid conversion

1. Acquire migration lease / stop unsafe tenant writes.
2. Snapshot/export only the tenant's Trial business data.
3. Import to Primary while preserving relationships/IDs or deterministic mappings.
4. Verify row counts, checksums, FK/business invariants, order/payment/stock totals.
5. Register routed object IDs where required.
6. Atomically switch authoritative `data_home=primary` only after verification.
7. Unlock access.
8. Retain Trial data according to rollback/retention policy.
9. Audit every migration phase.

Any verification error must fail closed. Partial cutover is not acceptable.

---

## 4. Package / Subscription — VERIFIED AS EXISTING

Do **not** rebuild the package system from scratch. It exists in live Primary.

Audited tables:

- `package_feature_catalog`
- `subscription_package_features`
- `subscription_packages`
- `tenant_subscription_contracts`
- `tenant_subscription_payment_requests`
- `tenant_subscription_approval_events`
- `tenant_data_lifecycle`

Audited counts:

- feature catalog: 10
- package-feature mappings: 6
- subscription packages: 9
- tenant subscription contracts: 2
- tenant lifecycle rows: 2

Package records already carry quotas/entitlements including branch/device/user/product limits, bill limits, storage/retention, staff/manager/owner limits, CSV export, and `tablet_pos_enabled`, `windows_pos_enabled`, `mobile_app_enabled`.

Active package codes found:

- `S45`
- `BASIC`
- `PRO`
- `PRO_M`
- `ENT`
- `F45`
- `B599`
- `Q1490`
- `Y3490`

Audit finding: there are overlapping active catalog families:

```text
BASIC / PRO / PRO_M / ENT
F45 / B599 / Q1490 / Y3490
plus S45
```

This is **package catalog normalization**, not missing implementation.

Before Go-Live:

- choose the canonical commercial package family;
- safely map existing contracts;
- deactivate obsolete packages rather than deleting historical references;
- review partial feature mapping (10 feature definitions vs 6 mappings at audit time);
- verify Tablet/Windows/Mobile entitlement enforcement at download, enrollment, login/session, and runtime gates.

Live contracts audited:

- NDL has an active paid yearly contract on `Y3490`.
- Trial tenant has an active `trial` contract without a paid package.

August 8 migration source drift recovery:

- restored `supabase/migrations/20260808133850_subscription_trial_manual_it_demo_baseline.sql`;
- restored `supabase/migrations/20260808134014_internal_demo_30_day_reset.sql`;
- restored `supabase/migrations/20260808134053_subscription_lock_scheduler.sql`;
- restored `supabase/trial-data-plane/migrations/20260808133811_trial_7_day_retention_and_seed_cleanup.sql`;
- restored `supabase/trial-data-plane/migrations/20260808134120_trial_retention_scheduler.sql`;
- live Primary/Trial databases were not modified and no migrations were applied during source recovery;
- Aug-9 Kitchen/Print migrations remain GitHub-side only until explicit live rollout approval;
- next migration gate is Kitchen/Print readiness and controlled Primary/Trial application.

---

## 5. Canonical 12-requirement audit

Legend: ✅ verified complete at audited layer; 🟡 foundation/core exists but E2E/Go-Live work remains; 🔴 current open defect/blocker.

| # | Requirement | Status | Current truth / remaining work |
|---|---|---|---|
| 1 | Package / Subscription | 🟡 | Core/live data exists: 9 active packages and 2 contracts. Normalize overlapping catalog and complete entitlement enforcement audit. |
| 2 | Real production system + Web App Trial | 🟡 | Lifecycle/routing foundation exists. Trial tenant remains locked/verifying; Web App is reference UI. |
| 3 | Two DBs; Trial -> Paid migrates data to Primary | 🟡 | Both DBs and lifecycle/routing foundations exist. Full migration/checksum/rollback/cutover E2E remains a Go-Live gate. |
| 4 | Tablet + Windows apps + web downloads | 🟡 | Native Tablet POS and Windows runtime exist; release/download infrastructure exists. Final release/version/installer/entitlement E2E remains. |
| 5 | Mobile application | 🟡 | Separate native Android project exists at `apps/cpipos-mobile-android`. Feature parity/current release QA remains. |
| 6 | Native UI follows Web App | 🟡 | Canonical rule is documented. Every material Web/backend change requires native impact/parity review. |
| 7 | Kitchen | 🟡 | Kitchen routing/dispatch/config/queue foundations exist in GitHub. Aug-9 Kitchen schema was not live in Primary/Trial at audit time; KDS/config/realtime/E2E remains. |
| 8 | Printer / physical printer | 🟡 | **Browser worker compatibility blocker is CLOSED at `9160dc6`.** Claim/lease/retry/stale-attempt protections and server-issued attempt propagation are aligned. Physical-printer E2E, migration/live rollout and load/soak remain. |
| 9 | Finish POS sales + dine-in/table mode | 🟡 | Core flows exist. Table lifecycle, edge cases, transaction correctness and responsiveness QA remain. |
| 10 | Table QR negative-stock bug | 🟡 | Code fix exists at `084fc2cb3af6cef13a6e967d8b5df4ad3f6f7b70`; physical/E2E verification is not complete yet. |
| 11 | Native/Windows updates through MDM | 🟡 | MDM/device-command and heartbeat foundation exists, but full staged download/verify/install/health/rollback update E2E is not proven. |
| 12 | MDM installed/bundled with Tablet + Windows | 🟡 | Native management foundations exist, but final installer/bootstrap/enrollment bundling for both platforms is not yet proven E2E. |

**Conclusion:** CpIPOS matches the intended 12-part architecture, but it is **not yet 12/12 Go-Live complete**. Most remaining work is integration, E2E, migration rollout, package policy normalization, Kitchen/KDS, native release/update, Table QR physical/E2E verification, and reliability/load validation.

---

## 6. Current application inventory

Verified application families:

- `apps/backoffice-web`
- `apps/cpipos-mobile-android`
- `apps/pos-android`
- `apps/windows-runtime-it-admin`
- `apps/windows-runtime-native`

Do not infer legacy/removed app folders from old chats.

### Android Tablet POS

`apps/pos-android` is the native Android Tablet POS direction. The recovered native checkpoint changed the Android workflow from generic Android Runtime to **Android Tablet POS**, version `0.2.0`, and moved beyond the previous generic Web-shell framing.

### Mobile

`apps/cpipos-mobile-android` is a separate native Android Mobile application and shares the CpIPOS server/business ecosystem.

### Windows

`apps/windows-runtime-native` is the native Windows POS/runtime application. `apps/windows-runtime-it-admin` is the Windows IT Admin runtime. Keep IT Admin and cashier POS responsibilities distinct.

### Version/release rule

When a released Web reference flow, backend contract, or UI behavior materially affects a native app:

1. assess Tablet/Windows/Mobile impact;
2. update affected native client;
3. bump version/build;
4. build/publish artifact;
5. publish release metadata/download;
6. deploy through staged Device Manager/MDM policy;
7. verify installation and health;
8. retain rollback/recovery capability.

Do not assume Web deployment updates native applications.

Recommended channels: `internal`, `pilot`, `stable`.

---

## 7. MDM / CpIPOS Device Manager

Recovered native/MDM work proves real foundation work exists, including device heartbeat and server-delivered commands.

Target responsibilities:

- enrollment/device identity;
- tenant/branch/device assignment;
- heartbeat/health;
- app/agent version reporting;
- policy/config refresh;
- diagnostics;
- enable/disable;
- staged update rollout;
- artifact download/integrity verification;
- install/restart orchestration;
- post-update health;
- rollback/recovery;
- printer/bridge/service diagnostics;
- audit trail.

Final customer installers must bootstrap/install required Device Manager/management components and enroll safely. Store staff should not manually assemble multiple technical components.

Do **not** call MDM complete until Tablet and Windows enrollment/update/rollback E2E is proven.

---

## 8. Kitchen

Recovered GitHub work includes foundations for:

- Kitchen zones;
- routing rules;
- Kitchen tickets/items;
- dispatch;
- configuration APIs;
- queue/status APIs;
- order-item and cancellation events;
- Print Queue linkage;
- Primary/Trial variants.

Intended flow:

```text
POS / Table QR
 -> Order + Items
 -> Kitchen Dispatch
 -> Routing Rules
 -> Kitchen Zone
 -> Kitchen Ticket / Items
 -> KDS and/or Print Queue
 -> Preparing
 -> Ready
 -> served/complete flow
```

At the audit snapshot, live Primary contained `print_jobs`, but new Kitchen tables were not found live; Trial also had not received the Aug-9 Kitchen schema. GitHub implementation must not be mistaken for production-applied Kitchen.

Remaining gates: migration readiness/drift reconciliation, secure Primary/Trial application, KDS UI, configuration UI, realtime/reconnect, tenant/branch isolation, add/cancel/reprint E2E, physical printing, load/soak.

---

## 9. Printing safety contract — UPDATED AFTER CODEX PASS

Printing is asynchronous and must not freeze selling UI while waiting for hardware.

```text
pending/retryable
 -> atomic claim
 -> lease
 -> server-issued agent_attempt_id
 -> physical execution
 -> ACK/FAIL with the same attempt ID
 -> retry/re-claim when allowed
```

Rules:

- attempt ID comes from server claim;
- ACK/FAIL sends the exact same attempt ID;
- worker must not invent it;
- stale/expired attempt must be rejected;
- re-claim may produce a new attempt ID and old ownership must not return;
- attempt IDs are per-job/per-attempt;
- print failure remains observable/retryable without losing the business order.

### Verified checkpoint 2026-08-09 15:40 ICT

Branch: `agent/printer-execution-queue`

Previous checkpoint: `155dad21f4aa445c5948543e2045fcadd9e3e2e0`

Verified functional HEAD: `9160dc6f34c19bfcf3ac2279888d790b33381334`

Commit: `fix(print-agent): propagate claim attempt IDs`

Changed worker/service/test files:

- `apps/backoffice-web/src/components/printing/browser-bluetooth-print-agent.tsx`
- `apps/backoffice-web/src/components/printing/browser-print-agent.tsx`
- `apps/backoffice-web/src/components/printing/browser-print-shared.ts`
- `apps/backoffice-web/src/lib/printing/print-agent-service.ts`
- `apps/backoffice-web/tests/integration/print-agent-security.integration.test.ts`
- `apps/backoffice-web/tests/unit/browser-print-shared.test.ts`

Independent GitHub diff verification confirmed:

- `agent_attempt_id` is overlaid from claim results onto each claimed job;
- Browser Serial worker sends it in ACK and FAIL;
- Browser Web Bluetooth worker sends it in ACK and FAIL;
- a missing attempt ID fails explicitly rather than inventing one;
- tests cover server-issued attempt propagation and stale-attempt rejection.

Codex reported PASS for retry/re-claim, parallel-job safety, stale-attempt protection, existing-worker compatibility, typecheck, lint, targeted tests, and `git diff --check`. Live DB and migrations were not touched. Vercel status for `9160dc6` was independently observed as success.

**This closes the previous browser-worker compatibility blocker.** It does **not** by itself prove physical-printer E2E, Production/Trial migration rollout, or sustained load reliability.

---

## 10. POS / dine-in / Table QR

Counter POS, dine-in/table, customer QR, Kitchen, payment, receipt, and inventory are one business system and must converge on authoritative server transactions/policies.

### QR negative-stock status

```text
Customer Table QR
 -> submit order
 -> appears in POS table mode
 -> negative-stock behavior must follow the authoritative branch policy
```

Code status:

- implementation fix exists at `084fc2cb3af6cef13a6e967d8b5df4ad3f6f7b70`;
- physical/E2E verification is still required before Go-Live completion.

Expected behavior:

- if branch policy allows negative stock, POS and QR consistently permit it according to the same authoritative rule;
- if policy forbids it, both consistently reject transactionally;
- QR must not maintain a conflicting stock engine.

Audit path:

```text
QR context/session
 -> Table QR submit transaction
 -> order/items
 -> authoritative branch stock policy
 -> stock movement
 -> table/POS state
 -> Kitchen/Print events
```

---

## 11. Performance, bottlenecks, hangs and UI responsiveness

Because CpIPOS serves many owners and many branches, performance/reliability is a Go-Live requirement, not optional polish.

### DB/API

- index hot paths around tenant/branch plus common status/time/object keys;
- avoid unbounded reads; paginate/cap history and lists;
- select only required columns on hot endpoints;
- avoid N+1 and branch fan-out;
- keep cross-data-plane routing explicit/fail-closed;
- transactions for order/payment/stock/QR state transitions;
- idempotency for retryable side effects;
- queue/background execution for printing, Kitchen delivery, diagnostics, device commands, and updates;
- use timeouts/cancellation where safe;
- never hold customer UI indefinitely waiting for printer/update/external work.

### Web/Tablet/Windows/Mobile UI

- no permanent spinner;
- loading/success/error/timeout/retry states for long actions;
- prevent duplicate submission while allowing recovery;
- cancel stale requests when context/navigation changes where appropriate;
- no heavy synchronous UI-thread work;
- bounded realtime reconnect/backoff with no duplicate subscriptions;
- background print/update/diagnostic work must not freeze POS interaction;
- clickable controls must not silently ignore input.

### Observability

Measure at minimum:

- API p50/p95/p99;
- DB query latency / slow-query rate;
- error/timeout rate;
- Table QR submit latency/fail rate;
- POS order/payment latency;
- Print queue depth/age and claim-to-ACK time;
- Kitchen queue age;
- realtime reconnect events;
- device heartbeat age;
- native crash/update failure rate.

### Load / soak

Use mixed production-like load:

- many tenants;
- multiple branches per tenant;
- simultaneous POS sales;
- Table QR bursts;
- Kitchen bursts;
- Print bursts;
- manager/backoffice reads;
- heartbeat/update traffic.

Verify throughput **and** tenant isolation. Do not claim an SLA until measured.

---

## 12. Security invariants

- tenant/branch isolation at API/router/DB/queue/Kitchen/Print/MDM layers;
- service-role secrets stay server-side;
- never weaken RLS/service-only design for a compatibility shortcut;
- hardened search path/minimal grants for sensitive SECURITY DEFINER functions;
- client price/totals/scope are untrusted;
- audit auth/device/payment/migration/package/Kitchen/Print/MDM changes;
- Trial routing/migration fails closed.

---

## 13. Go-Live gates

Do not call CpIPOS Go-Live complete merely because typecheck/build succeeds.

Required gates include:

- package catalog/entitlements normalized;
- Production/Trial lifecycle E2E;
- Trial -> Primary paid conversion with verify + rollback;
- GitHub/Supabase migrations reproducible and reconciled;
- POS/table/QR transaction correctness;
- QR negative-stock defect closed;
- Kitchen migration + KDS/config/realtime E2E;
- Print physical-printer E2E and production-like load/soak;
- Tablet/Windows/Mobile release QA where package permits;
- MDM enrollment/update/rollback E2E;
- download/release artifacts verified;
- tenant/branch isolation tests;
- load/soak/UI responsiveness tests;
- monitoring and operational runbooks.

---

## 14. Standard Codex protocol

Before edits:

```text
Read README.md, context.md, AGENTS.md, docs/CpIPOS_MASTER_SYSTEM_SCOPE.md.
git status
git fetch origin
git checkout <explicit branch>
git pull --ff-only origin <explicit branch>
git log -8 --oneline --decorate
```

If unrelated local changes exist: STOP. Do not reset/stash/discard/overwrite without explicit authorization.

During work:

- narrow scope;
- no broad refactor during focused fixes;
- no live Supabase changes unless explicitly authorized;
- no migration apply unless explicitly authorized;
- no `data_home`/Trial unlock/cutover unless explicitly authorized;
- no merge/force-push unless explicitly authorized;
- no secrets;
- do not weaken security/isolation/fail-closed behavior.

Validation: smallest relevant checks first, targeted typecheck/lint/tests, `git diff --check`, then final diff/security review.

Final report must state branch, old/new HEAD, exact files changed, behavior fixed, tests, diff-check, final git status, commit/push, DB/migration impact, secrets, merge status, blockers/TODOs.

---

## 15. Next-priority doctrine after print-worker closure

Do not reopen the browser `agent_attempt_id` worker compatibility issue unless regression evidence appears.

Next work should be selected from live verification of the remaining yellow gates. **Table QR negative-stock consistency (#10)** has a code fix at `084fc2cb3af6cef13a6e967d8b5df4ad3f6f7b70`, but physical/E2E verification remains. Kitchen/Print migration readiness and live rollout, KDS, physical-printer E2E, package normalization, Trial migration E2E, and MDM update/install remain major Go-Live workstreams.

Before starting any of them, re-fetch GitHub and live Supabase read-only because the current branch may have moved after this document commit.
