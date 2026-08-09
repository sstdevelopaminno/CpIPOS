# CpIPOS Master System Scope & Architecture

> Canonical continuity document for ChatGPT, Codex, maintainers, and future sessions.
>
> Audit snapshot: 2026-08-09 15:02 ICT
>
> Repository: `sstdevelopaminno/CpIPOS`
>
> Documentation branch: `docs/master-system-scope-20260809`
>
> Base checkpoint used for the audit: Print Execution Queue commit `155dad21f4aa445c5948543e2045fcadd9e3e2e0`.

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

A checkpoint SHA in a document is a snapshot, not a permanent HEAD. Re-fetch GitHub before each work package.

If ChatGPT/Codex history disappears or a new session starts, recover the latest pushed GitHub checkpoint first. Never infer that an unpushed or unverified chat instruction was completed.

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
- never trust tenant, branch, role, device, price, totals, permissions, or authorization scope just because the client sends it;
- authenticated server context and authoritative DB rules win;
- no cross-tenant/cross-branch leakage is acceptable;
- a feature working for one shop/branch is not sufficient proof for a SaaS release.

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

- `tenant_data_lifecycle.data_home` is the runtime routing authority;
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
9. Audit each migration phase.

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

### Active package codes found

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

- choose the canonical product catalog;
- safely map existing contracts;
- deactivate obsolete packages rather than deleting historical references;
- review the partial feature mapping (10 feature definitions vs 6 mappings at audit time);
- verify tablet/windows/mobile entitlement enforcement at relevant download, enrollment, login/session, and runtime gates.

Live contracts audited:

- NDL has an active paid yearly contract on `Y3490`.
- Trial tenant has an active `trial` contract without a paid package.

---

## 5. Canonical 12-requirement audit

Legend: ✅ verified complete at audited layer; 🟡 foundation/core exists but E2E/Go-Live work remains; 🔴 current open defect/blocker.

| # | Requirement | Status | Current truth / remaining work |
|---|---|---|---|
| 1 | Package / Subscription | 🟡 | Core/live data exists: 9 active packages and 2 contracts. Normalize overlapping catalog and complete entitlement audit. |
| 2 | Real production system + Web App Trial | 🟡 | Lifecycle/routing foundation exists. Trial tenant remains locked/verifying; Web App is reference UI. |
| 3 | Two DBs; Trial -> Paid migrates data to Primary | 🟡 | Both DBs and lifecycle/routing foundations exist. Full migration/checksum/rollback/cutover E2E remains a Go-Live gate. |
| 4 | Tablet + Windows apps + web downloads | 🟡 | Native Tablet POS and Windows runtime exist; release/download work exists. Final release/version/installer/entitlement E2E remains. |
| 5 | Mobile application | 🟡 | Separate native Android project exists at `apps/cpipos-mobile-android`. Feature parity/current release QA remains. |
| 6 | Native UI follows Web App | 🟡 | Canonical rule is now documented. Each material Web/backend change requires native impact/parity review. |
| 7 | Kitchen | 🟡 | Kitchen routing/dispatch/config/queue foundations exist in GitHub. Aug-9 Kitchen schema is not live in Primary/Trial at audit time; KDS/config/realtime/E2E remains. |
| 8 | Printer / physical printer | 🟡 | Claim/lease/retry/stale-attempt hardening exists. At base checkpoint the active blocker was browser-worker `agent_attempt_id`; verify Codex's newer push before changing status. Physical-printer E2E remains mandatory. |
| 9 | Finish POS sales + dine-in/table mode | 🟡 | Core flows exist. Table lifecycle, edge cases, transaction correctness and responsiveness QA remain. |
| 10 | Table QR negative-stock bug | 🔴 | Current reported defect: QR -> table POS stock/negative-stock behavior is inconsistent with intended branch policy. Reproduce and unify with authoritative POS stock policy. |
| 11 | Native/Windows updates through MDM | 🟡 | MDM/device-command and heartbeat foundation exists, but full staged download/verify/install/health/rollback update E2E is not proven. `check_update` was still unsupported in audited command handling. |
| 12 | MDM installed/bundled with Tablet + Windows | 🟡 | Native management foundations exist, but final installer/bootstrap/enrollment bundling for both platforms is not yet proven E2E. |

**Conclusion:** CpIPOS matches the intended 12-part architecture, but it is **not yet 12/12 Go-Live complete**. Most remaining work is integration, E2E, migration rollout, package policy normalization, UI finishing, native release/update, and reliability testing.

---

## 6. Current application inventory verified in `apps/`

At the audited GitHub branch, `apps/` contains exactly:

- `apps/backoffice-web`
- `apps/cpipos-mobile-android`
- `apps/pos-android`
- `apps/windows-runtime-it-admin`
- `apps/windows-runtime-native`

Do not infer legacy/removed app folders from old chats.

### Android Tablet POS

`apps/pos-android` is the native Android Tablet POS direction. The recovered native checkpoint changed the Android workflow from generic Android Runtime to **Android Tablet POS**, version `0.2.0`, and moved away from the previous generic Web-shell framing.

### Mobile

`apps/cpipos-mobile-android` is a separate native Android Mobile application and uses the CpIPOS server ecosystem rather than becoming an independent business system.

### Windows

`apps/windows-runtime-native` is the native Windows POS/runtime application. `apps/windows-runtime-it-admin` is the Windows IT Admin runtime. Keep IT Admin and cashier POS responsibilities distinct.

### Version/release rule

When a released Web reference flow, backend contract, or UI behavior materially affects a native app:

1. assess Tablet/Windows/Mobile impact;
2. update the affected native client;
3. bump version/build;
4. build/publish artifact;
5. publish release metadata/download;
6. deploy through staged Device Manager/MDM policy;
7. verify installation and health;
8. retain rollback/recovery capability.

Do not assume a Web deployment updates native applications.

Recommended channels: `internal`, `pilot`, `stable`.

Release metadata should include platform, version, build number, minimum supported version, artifact hash/signature metadata, channel, release notes, and rollout policy.

---

## 7. MDM / CpIPOS Device Manager — audited foundation vs target

Recovered native/MDM work proves real foundation work exists, including device heartbeat and server-delivered device commands.

Android Tablet code sends periodic device heartbeat and handles command types. The audited command model includes actions such as reload/config/diagnostics/enable-disable, but several commands remained explicitly unsupported, including:

- `clear_print_queue`
- `restart_local_bridge`
- `restart_print_service`
- `test_printer` in the shared unsupported-command registry at that checkpoint
- `check_update`

Therefore do **not** call MDM finished.

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

Final customer installers must bootstrap/install required Device Manager/management components and enroll safely. Store staff should not manually assemble technical components.

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

Live audit: Primary contained `print_jobs`, but new Kitchen tables were not found live; Trial also had not received the Aug-9 Kitchen schema. GitHub implementation must not be mistaken for production-applied Kitchen.

Remaining gates: migration-drift readiness, secure Primary/Trial migration application, KDS UI, configuration UI, realtime/reconnect, tenant/branch isolation, add/cancel/reprint E2E, physical printing, load/soak.

---

## 9. Printing safety contract

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
- ACK/FAIL must send the exact same attempt ID;
- worker must not invent it;
- stale/expired attempt must be rejected;
- re-claim may produce a new attempt ID and old ownership must not return;
- attempt IDs are per-job/per-attempt;
- print failure must be observable/retryable without losing the business order.

Base audit checkpoint:

- branch `agent/printer-execution-queue`;
- base HEAD `155dad21f4aa445c5948543e2045fcadd9e3e2e0`;
- SQL/claim/lease/retry/idempotency/stale protection/routing/security QA passed;
- browser worker compatibility still needed `agent_attempt_id` propagation at that exact checkpoint.

Always re-fetch branch before using this volatile status.

---

## 10. POS / dine-in / Table QR

Counter POS, dine-in/table, customer QR, Kitchen, payment, receipt, and inventory are one business system and must converge on authoritative server transactions/policies.

### Current QR negative-stock defect

```text
Customer Table QR
 -> submit order
 -> appears in POS table mode
 -> negative-stock behavior is inconsistent with intended branch policy
```

Expected:

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
- bounded realtime reconnect/backoff with no duplicate subscription;
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

Verify both throughput and tenant isolation. Do not claim an SLA until measured.

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

Do not call CpIPOS Go-Live complete just because typecheck/build passes.

Required gates include:

- package catalog/entitlements normalized;
- Production/Trial lifecycle E2E;
- Trial -> Primary paid conversion with verify + rollback;
- GitHub/Supabase migrations reproducible and reconciled;
- POS/table/QR transaction correctness;
- QR negative-stock defect closed;
- Kitchen migration + KDS/config/realtime E2E;
- Print worker compatibility + physical printer E2E;
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

After Codex pushes, ChatGPT/maintainer verifies the actual GitHub commit/diff before authorizing the next work package.

---

## 15. Current prioritized roadmap

1. Verify/finish browser Print Worker `agent_attempt_id` compatibility.
2. Print execution QA + physical printer E2E readiness.
3. Reconcile GitHub <-> Supabase migration history before applying new Kitchen/Print migrations.
4. Apply audited Kitchen/Print migrations to Primary + Trial only after readiness approval.
5. Trial lifecycle and Trial -> Primary paid conversion E2E with verification/rollback.
6. Reproduce/fix Table QR negative-stock policy defect.
7. Finish POS sales + dine-in/table edge cases and responsiveness.
8. Complete Kitchen KDS/config/realtime + Kitchen/Print E2E.
9. Normalize package catalog and audit entitlement enforcement.
10. Audit Web UI -> Tablet/Windows/Mobile parity; version affected clients.
11. Complete MDM bundling/enrollment + staged auto-update + rollback.
12. Verify download/release artifacts.
13. Multi-tenant/multi-branch load, soak, failure-recovery, UI responsiveness, and isolation tests.
14. Final Go-Live audit.

---

## 16. Do not reopen stale bugs without evidence

Historical issues such as old device selection, employee login, shift popup, or older Table QR failures are not current blockers unless live verification reproduces them.

The **Table QR negative-stock policy** issue remains explicitly open because it is part of the current requested scope.
