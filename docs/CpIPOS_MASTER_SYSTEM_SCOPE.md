# CpIPOS Master System Scope & Architecture

> Canonical project continuity document for ChatGPT, Codex, maintainers, and future sessions.
>
> Audit snapshot: 2026-08-09 15:02 ICT
>
> Repository: `sstdevelopaminno/CpIPOS`
>
> Documentation branch created from Print Execution Queue checkpoint `155dad21f4aa445c5948543e2045fcadd9e3e2e0` (`agent/printer-execution-queue`).

## 0. How to use this document

Read these files before changing CpIPOS:

1. `README.md`
2. `context.md`
3. `docs/CpIPOS_MASTER_SYSTEM_SCOPE.md` **(this file)**
4. Only then inspect the files directly related to the current task.

Priority when facts conflict:

1. Live GitHub branch / commit being worked on.
2. Live Supabase schema, migration history, and data state.
3. This master scope and `context.md`.
4. Old chat history or memory only as a fallback.

This document is intentionally persistent so that a lost ChatGPT conversation, a new chat, a recovered Codex conversation, or a new Codex run does not cause the project to restart from old assumptions.

**Important:** the checkpoint SHA in this file is a snapshot, not a permanent branch head. Re-fetch GitHub before every new work package.

---

## 1. System identity and mandatory architecture

CpIPOS is a **multi-tenant / multi-owner / multi-branch POS SaaS**.

Canonical hierarchy:

```text
CpIPOS SaaS
└── Tenant / Owner (shop owner account)
    ├── Branch A
    │   ├── Users / roles
    │   ├── POS devices
    │   ├── Tables / QR
    │   ├── Orders / payments
    │   ├── Inventory
    │   ├── Kitchen
    │   └── Printers
    ├── Branch B
    └── Branch ...
```

Non-negotiable isolation rules:

- Every tenant-scoped business operation must be isolated by `tenant_id`.
- Branch-scoped operations must additionally enforce `branch_id`.
- Never trust tenant, branch, role, device, price, totals, or authorization scope merely because the client sends it.
- Server-side session/context is authoritative.
- No cross-tenant or cross-branch data leakage is acceptable.
- A feature working for one tenant/branch is not sufficient evidence that it is safe for many tenants and many branches.

---

## 2. Canonical UI and business-rule doctrine

### Web App is the reference UI

The Web App is the **reference implementation / master UI & UX** for CpIPOS.

Tablet, Windows, and Mobile clients must follow the same:

- terminology and labels;
- navigation and operating flow;
- business state and error meaning;
- permissions and feature gates;
- transaction behavior;
- visual hierarchy and important interaction patterns.

Native clients do not need to be pixel-identical where the operating system requires a native adaptation, but they must not invent a conflicting workflow or business rule.

### Backend is the business-rule source of truth

Backend/API/database transaction rules are authoritative. Native clients must not fork critical business logic for:

- price/trusted price calculations;
- stock policy;
- order totals;
- payments;
- Table QR submission;
- Kitchen routing;
- Print execution;
- subscription entitlement;
- tenant/branch/device authorization.

---

## 3. Production / Trial data-plane architecture

Live Supabase projects audited on 2026-08-09:

- **CpiPOS-001 / Primary**: `deejlitaivfnsbwqdugy`
- **CpiPOS-002 / Trial Data Plane**: `kawenyvpentwgugtzqec`

Routing doctrine:

- `tenant_data_lifecycle.data_home` is the **runtime routing authority**.
- `desired_data_home` is intent/state only and MUST NOT be used as the runtime routing signal.
- Control-plane data remains on Primary.
- Trial business-data routing requires server-only Trial credentials.
- If Trial is authoritative and Trial routing cannot be completed safely, **fail closed**.
- Never silently fall back to Primary for an authoritative Trial business operation.
- Never expose a Supabase service-role key to browser/mobile/native clients.

### Current audited lifecycle state

At this audit snapshot:

- NDL tenant is on `data_home=primary`, unlocked.
- Trial tenant is still `lifecycle_status=trial`, `data_home=primary`, `desired_data_home=trial`, `migration_status=verifying`, and `access_locked=true`.

Therefore the Trial tenant has **not completed Trial data-plane cutover**. Do not automatically unlock or cut it over.

### Required Trial -> Paid conversion

When a Trial customer purchases a real package, the required flow is:

1. Acquire migration lease / lock writes for the tenant.
2. Snapshot/export only tenant-scoped business data from Trial.
3. Import into Primary while preserving IDs/relationships or using deterministic mappings.
4. Verify row counts, checksums, foreign-key/business invariants, order/payment/stock totals.
5. Register/update routed object IDs when the router architecture requires it.
6. Only after verification, atomically switch authoritative `data_home` to `primary`.
7. Unlock tenant access.
8. Retain Trial snapshot/data according to rollback/retention policy.
9. Audit every migration phase.

Any verification error must fail closed. Data must not be partially cut over.

---

## 4. Package / Subscription system — VERIFIED IMPLEMENTED

The package system is **not missing**. It already exists in the live Primary database.

Audited control-plane tables:

- `package_feature_catalog`
- `subscription_package_features`
- `subscription_packages`
- `tenant_subscription_contracts`
- `tenant_subscription_payment_requests`
- `tenant_subscription_approval_events`
- `tenant_data_lifecycle`

Audit counts:

- package feature catalog: 10
- package-feature mappings: 6
- subscription packages: 9
- tenant subscription contracts: 2
- tenant lifecycle rows: 2

`subscription_packages` already supports quota and application entitlements such as:

- branch/device/user/product limits;
- monthly bill limit;
- storage and retention;
- owner/manager/staff limits;
- CSV export;
- `tablet_pos_enabled`;
- `windows_pos_enabled`;
- `mobile_app_enabled`;
- quota mode;
- active/status/display order.

### Active package catalog found in live DB

Current active codes:

- `S45`
- `BASIC`
- `PRO`
- `PRO_M`
- `ENT`
- `F45`
- `B599`
- `Q1490`
- `Y3490`

Important audit finding: there are overlapping active package families:

```text
BASIC / PRO / PRO_M / ENT
and
F45 / B599 / Q1490 / Y3490
plus S45
```

This is a **catalog normalization/product-policy task**, not a reason to rebuild the package system.

Before Go-Live:

- decide which catalog family is canonical;
- map/migrate existing contracts safely;
- deactivate obsolete packages instead of deleting historical contract references;
- audit the currently partial package-feature mappings;
- verify that tablet/windows/mobile entitlements are enforced at download, enrollment, login/session, and runtime feature gates where applicable.

### Live contracts audited

- NDL has an active paid yearly contract using `Y3490`.
- Trial tenant has an active `trial` contract with no paid package assigned.

---

## 5. Master 12-requirement audit

Status legend:

- ✅ Implemented and verified at the audited layer.
- 🟡 Foundation/core exists but completion/E2E/Go-Live verification remains.
- 🔴 Known open defect/blocker.

| # | Requirement | Audit status | Current truth / remaining work |
|---|---|---|---|
| 1 | Package / Subscription | 🟡 | Core and live data are implemented. 9 active packages + 2 contracts verified. Normalize overlapping package catalogs and finish entitlement mapping/enforcement audit. |
| 2 | Real system + Web App Trial | 🟡 | Production/Trial lifecycle architecture exists. Trial tenant is still locked/verifying and has not completed data-plane cutover. Web App remains reference UI. |
| 3 | Two databases; Trial -> Paid moves data to Primary | 🟡 | Both live DBs and routing/lifecycle foundations exist. Full migration/checksum/rollback/cutover E2E is not yet proven and must be a Go-Live gate. |
| 4 | Tablet + Windows apps + download web | 🟡 | Separate Android Tablet POS and Windows native/runtime codebases exist; build/download infrastructure exists. Current release/version/installer/entitlement E2E still needs final verification. |
| 5 | Mobile application | 🟡 | A separate native Android mobile project exists (`apps/cpipos-mobile-android`). Feature parity and current release QA still need final verification. |
| 6 | Native UI follows Web App | 🟡 | This is now a canonical project rule. Existing clients need parity audit whenever Web UI/flow changes. Backend remains business-rule authority. |
| 7 | Kitchen system | 🟡 | Kitchen schema/routing/dispatch/config/queue foundations exist in GitHub. At this audit, Kitchen Aug-9 schema is not live in Primary/Trial; complete KDS/config UI/realtime/E2E remains. |
| 8 | Printer / physical printer | 🟡 | Print execution queue has claim/lease/retry/stale-attempt hardening. Current checkpoint still has browser-worker compatibility blocker (`agent_attempt_id`) until Codex push is verified. Physical printer E2E remains mandatory. |
| 9 | Finish POS sales + dine-in/table mode | 🟡 | Core flows exist. Edge cases, responsiveness, table lifecycle and full transaction QA remain before Go-Live. |
| 10 | Table QR negative-stock bug | 🔴 | Known open defect: QR -> table POS stock behavior can reject/handle negative stock differently from intended branch policy. Must reproduce and make QR use the same authoritative stock policy/transaction behavior as POS. |
| 11 | Native/Windows version updates through MDM | 🟡 | Version/build and device-management foundations exist, but staged update/download/verify/install/health/rollback E2E is not yet proven. |
| 12 | MDM installed/bundled with Tablet + Windows | 🟡 | Device-agent/native management foundations exist. Installer/bootstrap/enrollment bundling for both platforms must be verified E2E. |

**Conclusion:** the architecture matches the intended 12-part system direction, but the system is **not yet 12/12 Go-Live complete**. Most items have real implementation foundations; remaining work is integration, E2E, policy normalization, UI finishing, migration rollout, and reliability verification.

---

## 6. Applications and release doctrine

Repository application families include:

- `apps/backoffice-web`
- `apps/pos-android` — Tablet POS
- `apps/cpipos-mobile-android` — Mobile application
- `apps/windows-runtime`
- `apps/windows-runtime-native`
- `apps/pos-device-agent`
- IT Admin / desktop support applications

### Version rule

Whenever a released Web reference flow, backend contract, or UI behavior changes in a way that affects a native application:

1. assess Android Tablet, Windows, and Mobile impact;
2. update affected native implementation;
3. bump version/build number;
4. produce release artifact;
5. publish release metadata/download;
6. deploy by staged Device Manager/MDM policy;
7. verify installation and post-update health;
8. retain rollback capability.

Do not assume Web deployment automatically updates native clients.

Recommended release channels:

- `internal`
- `pilot`
- `stable`

A release manifest should include at least:

- platform;
- app version;
- build number;
- minimum supported version;
- artifact/hash/signature metadata;
- release channel;
- release notes;
- rollout policy.

---

## 7. MDM / CpIPOS Device Manager target

CpIPOS Device Manager/MDM is responsible for device fleet control, not POS business logic.

Required functions:

- enrollment and device identity;
- tenant/branch/device assignment;
- heartbeat/health;
- app/agent version reporting;
- policy/config refresh;
- diagnostics;
- disable/enable device;
- staged update rollout;
- artifact download and integrity verification;
- install/restart orchestration;
- post-update health verification;
- rollback/recovery;
- printer/bridge/service diagnostics where supported;
- audit trail.

Tablet and Windows installers must ultimately bootstrap/install the required Device Manager/agent components and enroll them safely. Do not require store staff to assemble multiple technical components manually in the final customer installation flow.

---

## 8. Kitchen system

Recovered Kitchen work includes foundations for:

- Kitchen zones;
- Kitchen routing rules;
- Kitchen tickets/items;
- Kitchen dispatch;
- Kitchen configuration APIs;
- Kitchen queue/status APIs;
- order-item/cancellation event routing;
- Print Queue linkage;
- Primary/Trial data-plane variants.

Intended flow:

```text
POS / Table QR
  -> Order + Order Items
  -> Kitchen Dispatch
  -> Routing Rules
  -> Kitchen Zone
  -> Kitchen Ticket / Items
  -> KDS and/or Print Queue
  -> Preparing
  -> Ready
  -> Served/complete flow
```

At this audit, live Primary contains `print_jobs` but the new Kitchen tables were not found live, and Trial likewise has not received the Aug-9 Kitchen schema. Therefore GitHub implementation must not be mistaken for a production-applied Kitchen system.

Remaining Kitchen gates include:

- migration readiness and drift reconciliation;
- secure Primary + Trial migration application;
- KDS UI;
- Kitchen configuration UI;
- realtime/reconnect behavior;
- branch/tenant isolation QA;
- cancellation/add-item/reprint E2E;
- physical printer E2E;
- load/soak tests.

---

## 9. Printing safety contract

Print execution is asynchronous and must never make the selling UI wait indefinitely for a physical printer.

Hardened model:

```text
pending/retryable job
 -> atomic claim
 -> lease
 -> server-issued agent_attempt_id
 -> physical execution
 -> ACK or FAIL with the same attempt ID
 -> retry/re-claim when allowed
```

Safety rules:

- `agent_attempt_id` is generated/issued by the server claim flow.
- ACK/FAIL must include the exact attempt ID for that job attempt.
- Workers must not generate their own attempt ID.
- A stale/expired attempt must be rejected.
- New re-claim may produce a new attempt ID; the old one must not regain ownership.
- Attempt IDs are per job/per attempt, not a global worker value.
- Print failure must be observable/retryable without losing the business order.

Volatile checkpoint as of this document creation:

- branch: `agent/printer-execution-queue`
- HEAD: `155dad21f4aa445c5948543e2045fcadd9e3e2e0`
- server/SQL QA largely passed;
- existing browser print workers still needed to propagate `agent_attempt_id` to ACK/FAIL;
- Codex was working on that compatibility fix when this document was created.

**Future agents must re-fetch the branch; do not assume this is still the latest HEAD.**

---

## 10. POS sales / dine-in / Table QR

Required operating modes are part of one business system, not separate stock/payment engines:

- normal counter POS;
- dine-in/table mode;
- customer Table QR ordering;
- Kitchen/printing;
- payment/receipt;
- stock movement.

All must converge on authoritative server-side transaction and policy behavior.

### Known Table QR stock defect

Open defect to reproduce and fix:

```text
Customer Table QR
 -> submit order
 -> appears in POS table mode
 -> stock/negative-stock behavior is not consistent with intended branch policy
```

Expected rule:

- if the branch policy allows negative stock, QR and POS must consistently allow the transaction according to that policy;
- if it forbids negative stock, both channels must reject consistently and transactionally;
- QR must not maintain a separate conflicting stock-rule implementation.

Audit end-to-end:

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

## 11. Performance, bottleneck, UI responsiveness and reliability requirements

Because CpIPOS serves many tenants and many branches, correctness alone is insufficient. Performance and responsiveness are Go-Live requirements.

### Database and API

- Index hot paths using tenant/branch plus common status/time/object keys.
- Avoid unbounded queries; paginate and cap list/history endpoints.
- Select only required columns on high-frequency paths.
- Avoid N+1/fan-out requests across branches.
- Keep cross-data-plane routing explicit and fail closed.
- Use transactions for order/payment/stock/QR state transitions.
- Use idempotency keys/attempt IDs where retry can duplicate effects.
- Put printing, Kitchen delivery, device commands, updates, and other slow external work behind queues/background execution.
- Add/query timeouts and cancellation where safe.
- Do not hold a customer-facing request open waiting for printer/update/diagnostic work.

### Web / Tablet / Windows / Mobile UI

- No permanent spinner state.
- Every long operation must have loading, success, error, timeout, and retry behavior.
- Disable duplicate submission while preserving recovery from timeout.
- Cancel stale requests when navigation/context changes where appropriate.
- Do not run heavy synchronous loops on the browser/native UI thread.
- Realtime reconnect must use bounded exponential backoff and avoid duplicate subscriptions.
- Background printer/update/diagnostic work must not freeze POS interaction.
- Optimistic UI is allowed only when rollback/state reconciliation is safe.
- A button that appears clickable must not silently ignore input.

### Observability

Instrument at minimum:

- API p50/p95/p99 latency;
- database query latency / slow-query rate;
- error and timeout rate;
- Table QR submit latency/failure rate;
- POS order/payment latency;
- Print queue depth/age and claim-to-ACK duration;
- Kitchen ticket queue age;
- realtime disconnect/reconnect events;
- device heartbeat age;
- native crash/update failure rate.

### Load / soak tests

Test mixed workloads, not a single-tenant happy path:

- many tenants;
- many branches per tenant;
- simultaneous POS sales;
- Table QR bursts;
- Kitchen ticket bursts;
- Print Queue bursts;
- manager/backoffice reads;
- device heartbeat/update traffic.

Verify both throughput and tenant isolation under load.

Recommended targets may be defined separately, but do not claim an SLA is achieved until measured in production-like tests.

---

## 12. Security invariants

- Tenant/branch isolation is mandatory at API, router, DB policy/transaction, queue, Kitchen, Print, and MDM layers.
- Service-role secrets stay server-side.
- RLS/service-only design must not be weakened merely to fix a client compatibility bug.
- Sensitive SECURITY DEFINER functions must use hardened search paths and minimal grants.
- Client-supplied price/totals/scope are untrusted.
- Audit important auth, device, payment, migration, package, Kitchen, Print, and MDM changes.
- Trial routing and tenant migration fail closed.

---

## 13. Definition of Done / Go-Live gates

CpIPOS is not Go-Live complete merely because typecheck/build succeeds.

Required gates include:

- package catalog and entitlement policy normalized;
- production/trial lifecycle E2E verified;
- Trial -> Primary paid conversion tested with verification + rollback;
- database migrations reconciled and reproducible from GitHub;
- POS/table/QR transaction correctness verified;
- QR negative-stock defect closed;
- Kitchen migrations + KDS/config/realtime E2E verified;
- Print Queue worker compatibility + physical printer E2E verified;
- Android Tablet, Windows, Mobile release QA complete for applicable packages;
- MDM enrollment/update/rollback E2E complete;
- download/release artifacts verified;
- tenant/branch isolation tests pass;
- load/soak/UI responsiveness tests pass;
- monitoring and operational runbooks exist.

---

## 14. Standard Codex work protocol

Every Codex task should follow this pattern unless the task explicitly requires something else.

### Before edits

```text
Read README.md, context.md, and docs/CpIPOS_MASTER_SYSTEM_SCOPE.md first.
Run git status.
Fetch origin.
Checkout the explicitly named working branch.
Pull with --ff-only.
Verify HEAD/ancestor expected by the task.
```

If unrelated local changes exist: **STOP**. Do not reset, stash, discard, or overwrite without explicit instruction.

### Scope

- Inspect only files directly related to the task.
- No broad refactor while fixing a focused defect.
- Do not change Supabase/live data unless the task explicitly authorizes it.
- Do not change `data_home`, unlock Trial, or perform cutover unless explicitly authorized after audit.
- Do not merge or force-push unless explicitly authorized.
- Do not weaken security/tenant isolation to make tests pass.

### Validation

Use the smallest relevant checks first, then targeted typecheck/lint/tests, `git diff --check`, and inspect the final diff for unrelated changes or secrets.

### Final Codex report

Always return:

- branch;
- previous checkpoint and new HEAD;
- exact files changed;
- behavior fixed;
- tests/typecheck/lint results;
- `git diff --check`;
- `git status --short` after push;
- commit SHA;
- push status;
- whether Supabase/live DB was touched;
- whether migrations were changed/applied;
- whether secrets were added;
- whether a merge occurred;
- blockers/TODOs.

After Codex pushes, ChatGPT/maintainer must verify GitHub commit/diff before authorizing the next work package.

---

## 15. Current prioritized roadmap

Do not restart completed foundations. Continue from live GitHub and DB state.

1. Finish browser Print Worker `agent_attempt_id` compatibility; verify pushed commit.
2. Re-run Print execution QA and physical/E2E readiness.
3. Reconcile GitHub <-> Supabase migration history/drift before applying new Kitchen/Print migrations.
4. Apply audited Kitchen/Print migrations to Primary + Trial only after readiness checks.
5. Test Trial lifecycle and Trial -> Primary paid conversion E2E with verification/rollback.
6. Reproduce and fix Table QR negative-stock policy defect.
7. Finish POS sales + dine-in/table edge cases and responsiveness.
8. Complete Kitchen KDS/config/realtime and Kitchen/Print E2E.
9. Normalize package catalog and complete entitlement enforcement audit.
10. Audit Web UI -> Tablet/Windows/Mobile parity; update affected native versions.
11. Complete MDM bundling/enrollment + staged auto-update + rollback.
12. Verify download center/release artifacts.
13. Run multi-tenant/multi-branch load, soak, failure-recovery, UI responsiveness, and isolation tests.
14. Final Go-Live audit.

---

## 16. Do not reopen old bugs without live evidence

Historical issues such as device selection, employee login, shift popup, or older Table QR submit failures must not automatically be treated as current blockers unless live verification reproduces them.

The explicit current Table QR **negative-stock policy** issue in Section 10 remains an open item because it was reported as current project scope.

---

## 17. Continuity rule

If ChatGPT chat history disappears, Codex history disappears, or a new session starts:

1. fetch the current GitHub branch/HEAD;
2. read this document + `context.md` + `README.md`;
3. inspect live Supabase read-only if database state matters;
4. recover the last pushed commit before issuing new edits;
5. never infer that an unpushed or unverified chat instruction was completed;
6. continue from the verified checkpoint rather than rebuilding prior work.

This document is the stable architecture/scope compass. Live code and live database remain the ultimate operational evidence.