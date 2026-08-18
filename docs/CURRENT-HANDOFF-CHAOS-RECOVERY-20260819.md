# CpIPOS Current Handoff — Chaos / Recovery Test — 2026-08-19

This checkpoint exists to preserve continuity if the ChatGPT conversation context rolls over.

## Current branch and environment

- Repository: `sstdevelopaminno/CpIPOS`
- Working / production branch: `agent-docs-preflight-schema-drift`
- Primary Supabase: `CpiPOS-001` (`deejlitaivfnsbwqdugy`)
- Trial Supabase: `CpiPOS-002` (`kawenyvpentwgugtzqec`)
- Vercel project: `cp-ipos-web`
- Production alias: `https://cp-ipos-web.vercel.app`

## Completed immediately before this checkpoint

Concurrency load test was completed on Trial using isolated synthetic tenants and later cleaned up. Canonical report:

- `docs/concurrency-load-test-20260818.md`

Validated baseline:

- POS 10 concurrent: 10/10, P95 344 ms
- POS 25 concurrent: 25/25, P95 645 ms
- POS 50 concurrent: 50/50, P95 1.144 s
- QR distinct tables 32 concurrent: 32/32, P95 1.230 s
- QR same-table 24 concurrent (6 x 4 branches): 24/24, P95 661 ms
- QR idempotency replay: 8/8, P95 259 ms
- POS idempotency replay: 8/8, P95 221 ms
- final integrity: 129 orders / 149 items / 60 QR submissions / 149 Kitchen Tickets / 149 Kitchen Ticket Items
- cross-scope, duplicate request, duplicate active bill, missing table snapshot, multiple queue-per-order, shared queue-per-order: all zero
- DB waiting locks and idle-in-transaction after the run: zero

Important fixes already applied:

1. Primary + Trial preserve one Kitchen queue number across NEW/ADD rounds.
2. Trial `enqueue_kitchen_order` RETURNING ambiguity fixed.
3. Trial Kitchen Ticket Item `ON CONFLICT` ambiguity fixed.
4. Trial table-bill composite FK cleanup fixed with selective `SET NULL (order_id)`.

Synthetic load-test data was removed. Trial temporary `http` extension was removed. Temporary test Edge Functions were replaced with JWT-protected HTTP 410 handlers.

## Live FG0003 printing baseline

FG0003 current intended production routes:

- receipt: `Printer001` / Xprinter XP-58 / Bluetooth 58mm
- kitchen MAIN-KITCHEN: verified USB 80mm
- LAN kitchen printer remains physically unreachable and must not be promoted over the verified USB exact-zone assignment

Do not clear the live customer's POS session, cookies, local data, shift, printer pairing, or USB permission during testing.

## Next task — Chaos / Recovery Test

Run on Trial first. Do not inject destructive faults into live FG0003 production traffic.

Required matrix:

1. POS retry after ambiguous client timeout: same request key must result in one order only.
2. QR retry after ambiguous client timeout: same request_id must result in one submission only.
3. Same-table QR contention with one intentionally delayed request: serialization must complete or return a bounded retryable error; never split the active bill.
4. Payment retry after ambiguous timeout: one request_group must not duplicate payment rows; paid_total must equal payment sum and order total.
5. Print Agent offline -> online recovery: queued jobs must remain claimable and not be duplicated.
6. Multiple Print Agents racing after recovery: each job may have only one live claim / attempt identity.
7. Printer transport failure and retry: failed/queued/retry state must not create duplicate business documents or duplicate Kitchen Ticket rows.
8. Runtime lease/data-plane route failure: fail closed / bounded retry rather than cross-routing tenants.
9. Post-test integrity: tenant/branch/order/table/kitchen/print scope checks, waiting locks = 0, idle-in-transaction = 0.

## Safety rules for this test

- Trial only for injected faults and synthetic load.
- Use isolated namespace and cleanup after every phase.
- Never replay historical real FG0003 failed Kitchen Tickets automatically.
- Never change live receipt/kitchen printer defaults as part of synthetic recovery testing.
- No production session/local-data clearing.
- Any Primary change must be a narrowly scoped correctness fix proven on Trial first.
- Record each discovered defect and migration/commit in this file or a final `docs/chaos-recovery-test-20260819.md` report before ending the chat.

## Recovery point

If a new chat must continue this work, read:

1. `docs/AI-GUARDRAILS-CPIPOS.md`
2. `context.md`
3. `docs/concurrency-load-test-20260818.md`
4. this file

Then inspect live GitHub/Vercel/Supabase state before making new changes.