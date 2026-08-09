# CpIPOS Agent / Codex Guardrails

This repository is a multi-tenant, multi-owner, multi-branch POS SaaS. Before making changes, read in this order:

1. `README.md`
2. `context.md`
3. `docs/CpIPOS_MASTER_SYSTEM_SCOPE.md`
4. Then inspect only files directly related to the task.

## Source of truth

When information conflicts, use this priority:

1. Current live GitHub branch/commit being worked on.
2. Live Supabase schema/migration/data state when database state matters.
3. `docs/CpIPOS_MASTER_SYSTEM_SCOPE.md` and `context.md`.
4. Old chat/session history only as fallback.

Never assume an old chat checkpoint is the current HEAD. Fetch first.

## Multi-tenant / multi-branch invariants

- Tenant isolation by `tenant_id` is mandatory.
- Branch-scoped operations must also enforce `branch_id`.
- Do not trust client-supplied tenant, branch, role, device, price, total, permission, or authorization scope.
- Server-side authenticated context and authoritative database rules win.
- Never fix a bug by weakening tenant/branch isolation.

## Primary / Trial routing

- Primary: CpiPOS-001.
- Trial Data Plane: CpiPOS-002.
- `tenant_data_lifecycle.data_home` is the runtime routing authority.
- `desired_data_home` is NOT a runtime routing signal.
- If Trial is authoritative and cannot be reached/routed safely, fail closed.
- Never silently fall back to Primary for authoritative Trial business operations.
- Service-role credentials remain server-side only.
- Do not change `data_home`, unlock a Trial tenant, or perform Trial/Primary cutover unless the task explicitly authorizes it after audit.

## UI / application doctrine

- The Web App is the reference UI/UX implementation.
- Backend/API/database transactions are the business-rule source of truth.
- Android Tablet, Windows, and Mobile clients must not fork critical business rules.
- When a Web/backend change affects a native client, assess that platform, update it when required, bump its version/build, and verify release/update behavior.

## Performance and reliability are Go-Live requirements

CpIPOS must remain responsive with many tenants and many branches.

- Avoid unbounded queries and N+1/fan-out request patterns.
- Keep hot tenant/branch/status/time paths indexed appropriately.
- Paginate and cap large lists/history.
- Keep order/payment/stock/QR state transitions transactional and idempotent where retries are possible.
- Put printing, Kitchen execution, diagnostics, and app updates behind asynchronous queue/background execution where appropriate.
- Never block the customer-facing POS UI indefinitely on a printer, update, diagnostic, or slow external operation.
- Every long UI action needs loading, timeout/error, retry/recovery behavior; no permanent spinner and no silently dead button.
- Avoid heavy synchronous work on the browser/native UI thread.
- Realtime reconnect must be bounded and must not create duplicate subscriptions.
- Validate p50/p95/p99 latency, error/timeout rate, queue age/depth, QR/POS transaction latency, device heartbeat age, and native update/crash failure rates before Go-Live claims.
- Test mixed multi-tenant/multi-branch load and soak, not only a single happy-path shop.

## Current project scope

The canonical 12-part scope and current audit are in `docs/CpIPOS_MASTER_SYSTEM_SCOPE.md`, covering:

1. Package/subscription.
2. Production + Trial Web App.
3. Primary/Trial database lifecycle and Trial-to-paid migration.
4. Android Tablet + Windows apps and download delivery.
5. Mobile application.
6. Web App as native UI reference.
7. Kitchen.
8. Print execution / physical printers.
9. POS sales + dine-in/table mode finishing.
10. Table QR negative-stock policy defect.
11. Native version/update lifecycle through Device Manager/MDM.
12. Device Manager/MDM installation/bootstrap with Tablet + Windows.

Do not rebuild foundations already present. Verify live code/database status first.

## Standard task protocol

Before edits:

```bash
git status
git fetch origin
git checkout <explicit-working-branch>
git pull --ff-only origin <explicit-working-branch>
git log -8 --oneline --decorate
```

If unrelated local changes exist, STOP. Do not reset, stash, discard, or overwrite them without explicit authorization.

During work:

- Keep scope narrow.
- Do not broad-refactor during a focused defect fix.
- Do not touch live Supabase unless explicitly authorized.
- Do not apply migrations unless explicitly authorized.
- Do not merge or force-push unless explicitly authorized.
- Do not add secrets.
- Preserve fail-closed routing/security behavior.

Validation:

- Run the smallest relevant tests first.
- Run targeted typecheck/lint/tests.
- Run `git diff --check`.
- Review final `git diff` for unrelated changes and secrets.

Final report must include:

- branch;
- previous checkpoint and new HEAD;
- exact files changed;
- behavior fixed;
- tests/typecheck/lint;
- `git diff --check`;
- `git status --short` after push;
- commit SHA and push status;
- whether Supabase/live DB was touched;
- whether migrations were changed/applied;
- whether secrets were added;
- whether merge occurred;
- blockers/TODOs.

After a Codex push, the maintainer/ChatGPT must verify the GitHub commit/diff before the next work package.

## Continuity rule

If ChatGPT/Codex history disappears or a new session starts:

1. Fetch the current branch/HEAD.
2. Read `README.md`, `context.md`, this file, and `docs/CpIPOS_MASTER_SYSTEM_SCOPE.md`.
3. Inspect Supabase read-only when live DB state matters.
4. Recover the last pushed commit before issuing new edits.
5. Never infer that an unpushed/unverified instruction was completed.
6. Continue from the verified checkpoint rather than restarting old work.
