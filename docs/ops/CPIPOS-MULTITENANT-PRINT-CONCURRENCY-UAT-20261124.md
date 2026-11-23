# CpIPOS multi-owner / multi-branch concurrency & printing UAT (2026-11-24)

> **Staging-only release gate.** Source under test: PR #540, production source branch `main`. This plan is **not** evidence that physical printers or load tests have passed.

## Environment and scope

- Use **CpiPOS-001-compatible isolated staging fixtures**, not live merchant accounts, sales or tax documents; retired Trial data-plane must not be re-enabled.
- At least **2 distinct owner tenants**, **3 branches for owner A**, **2 branches for owner B**; separate authenticated staff sessions, dedicated printer profiles, and unique device codes.
- Simulate **2 concurrent POS devices per branch**. Use isolated network or fake printers for repeatable CI, and real 58/80mm USB/LAN/Bluetooth printers in the separate physical gate.
- Read-only load probes first; use test-only transactional payments/order fixtures for write tests and fully reconcile them. Never send print stress to a production printer.
- Do not commit cookies, tokens or vendor credentials. Scope data and perf reports should be redacted of customer information.

## Required acceptance scenarios

| Case | Workload | Assertions |
| --- | --- | --- |
| T1 | Same sale: 20 concurrent requests to same printer | Exactly one queue job per scoped idempotency key and one physical delivery attempt by the direct-print executor |
| T2 | 2 owners x 4 total branches x 8 simultaneous requests | Cross-owner and cross-branch idempotency keys remain independent; no job or profile leaks |
| T3 | Same owner, two branches, same device/printer name | Claims and receipts stay in their own branch even if names overlap |
| T4 | Two agents claim the same printer queue simultaneously | One lease winner; stale ACK/FAIL rejected by attempt ID; no double printing |
| T5 | Printer offline / paper out / app restarted while printing | POS checkout remains responsive; queue records failure/retry; uncertain physical send is identified for operator review, never silently duplicated |
| T6 | 5 branches print independent receipts simultaneously | Serialise jobs per physical printer but allow independent printers to run concurrently; verify paper content belongs to correct tenant/branch |
| T7 | Multi-owner sales, stock, payment, shift and table QR concurrency | No cross-scope reads/writes, no duplicate charges, no negative inventory race not permitted by store policy |
| T8 | Recovery/soak 30–60 minutes with variable load | No indefinite spinner, growing queue backlog, unbounded memory, duplicate realtime subscriptions or starvation |

## Existing verification scripts

Read-only route soak with authenticated staging scopes:

```bash
# Set CPIPOS_BASE_URL and CPIPOS_SOAK_SCOPES_JSON in the runner's
# protected staging environment. Each named scope needs its own
# authorised staging Cookie / Authorization value.
CPIPOS_BASE_URL=https://STAGING.example.invalid \
CPIPOS_SOAK_SECONDS=300 \
CPIPOS_SOAK_CONCURRENCY=20 \
node scripts/pos-load-soak.mjs --out docs/evidence/pos-multi-tenant-staging.json
```

Existing scripts: `scripts/pos-load-soak.mjs`, `scripts/pos-login-session-bottleneck-load-test.mjs`, `scripts/physical-printer-e2e.mjs`, `scripts/pos-multi-branch-load-test.mjs`. The last multi-branch monitor probe has no authentication support by default and should not be interpreted as an authenticated merchant load test without adaptation.

Always capture per-scope/per-route p50/p95/p99 latency, RPS, 401/403/429/5xx, timeouts and throughput; print job queue depth, max queue age, print ACK success and exact receipt text; database wait and lock events; network/device error rates. Compare with measured unloaded staging baseline; agree on numerical SLOs before declaring capacity.

## Read-only production diagnostics already observed

- DB print jobs: 34 total, 26 printed in last 24h, 6 failed in last 24h, 2 aged pending report jobs (approximately 12 days old as observed).
- 10 active print agents across 8 owner/branch scopes. The 34 job sample reflects 2 owner/branch scopes and is **insufficient to certify 8-owner concurrency**.
- `pg_stat_statements` claim RPC historical: 354,616 calls, mean 12.67ms, max 2803ms. **Statistics reset on 2026-05-17**, so these are not last-day values.
- Print indexes already include scoped claim and scoped idempotency. Supabase has informational missing-FK-index advisories; profile actual SQL plans before selective index changes.
- Three public print RPC wrappers are service-role-only for EXECUTE; their underlying claim code uses tenant/branch filters and `FOR UPDATE SKIP LOCKED`. Review the entire authorization surface separately.

## Release / rollback

1. Confirm PR CI Typecheck/Lint/Vitest/schema drift/build green.
2. Run mixed-owner/branch staging and physical device E2E; attach anonymized evidence and baseline comparison.
3. Review tenant/branch query scopes, retry semantics, stale attempts and pending jobs.
4. Merge to `main` only after approvals and stage the production build; verify live smoke/telemetry and have rollback prepared.
5. Stop rollout on duplicate receipts, cross-owner access, payment discrepancies, queue starvation or elevated 5xx.

**Open risk:** A physical printer may have accepted bytes even when ACK times out. This is an ambiguous-delivery case and needs device-level validation/operator handling to avoid accidental duplicate paper. This document does not assert exactly-once paper under arbitrary hardware faults.
