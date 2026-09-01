# Vercel Hobby request-budget guardrails — 2026-09-01

## Incident trigger

The `cp-ipos-web` Vercel project exceeded the Hobby request/compute budget and was paused. The emergency objective of this patch is to stop runaway request churn before the project is resumed.

Observed incident signals supplied during the recovery work:

- Fluid Active CPU exceeded the free allocation.
- Edge Requests exceeded 1M.
- Function Invocations exceeded 1M.
- Provisioned Memory was not the primary limiting resource.

## Mandatory runtime rules

1. Recurring browser/network polling must have a **30 second minimum network cadence**. Prefer 30–60 seconds, adaptive backoff, visibility/focus wake, or explicit user refresh.
2. Normal telemetry must never create a high-frequency request loop. Error telemetry may bypass normal sampling.
3. Server-side work must be bounded to **15 seconds or less**. Hot routes should use a smaller 5–10 second route limit when practical.
4. Shared, non-sensitive read-only metadata may use CDN caching such as `s-maxage=60, stale-while-revalidate=300`.
5. Tenant/session/order/payment/shift/device state must **not** be public-CDN cached. Use `private, no-store` when the response is user/branch/session scoped.
6. Writes are never placed in the browser read cache. Browser snapshot caches are invalidated after API mutations.
7. Future AI proxy routes must use streaming for long outputs, bounded upstream timeouts, request de-duplication, and no status polling loop. No AI proxy route was introduced as part of this emergency patch.

## Emergency implementation

### Browser request floor

`apps/backoffice-web/src/instrumentation-client.ts` now enforces a 30-second browser network floor for legacy read loops whose scope is safely represented by the request URL or current document scope:

- `/api/pos/tables`
- `/api/pos/tables/{tableId}/bill`
- `/api/pos/tables/{tableId}/qr-orders`
- `/api/table-order/{token}?view=status`

Successful read responses are kept only in the current browser document and returned as cloned `Response` objects. Any same-origin API mutation, except observational `/api/pos/perf` telemetry, advances the read-scope epoch and clears the snapshot cache. Payment/order/write routes are never cached.

This is an emergency network-boundary protection for legacy components that may still schedule local refresh callbacks more frequently than 30 seconds. Those callbacks no longer produce Vercel requests inside the protected window. A later UI cleanup may lengthen every local timer directly without changing this network guard.

### Direct polling fixes

- Native Customer Display V2 healthy polling: **30s**; device/auth/transient backoff: **60s**.
- Global Table QR alerts: **30s → 45s → 60s** adaptive cadence, with immediate focus/visibility wake and a 10s request timeout.
- Android native Print Agent idle claims: **30s → 45s → 60s**. `notifyPrintQueued()` remains event-driven and wakes the worker immediately (plus the existing 350ms retry), so locally queued print jobs do not wait for idle polling.
- Android heartbeat remains 45s, which is within the 30–60s recurring cadence.

### Telemetry

Normal `/api/pos/perf` telemetry is sampled in the browser to at most one network request per minute per browser document. Error telemetry (`error_code` or HTTP status >= 400) bypasses browser sampling.

The server also coalesces normal telemetry writes for 60 seconds per tenant/branch/user/route/source. This is defense in depth; browser sampling is the layer that reduces Vercel Edge Requests and Function Invocations.

### Timeout ceiling

- `pos-resilience.ts` clamps POS promise timeouts to **15s maximum** and prevents the monitor poll environment value from going below 30s.
- `server/bounded-timeout.ts` clamps abortable server work to **15s maximum**, even if an environment variable previously allowed a larger value.
- Hot route limits added in this patch include 5s, 10s, or 15s depending on the route.

### Caching boundary

Safe shared deployment metadata now uses:

`Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=300`

Applied to:

- `/api/system/version`
- `/api/system/build-info`

Sensitive/session-scoped operational routes touched by this patch explicitly remain private/no-store where applicable. Do not add shared CDN caching to bills, orders, payments, shifts, customer display session state, or branch-scoped alert state.

## Database / schema impact

None. No Supabase migrations, RLS changes, transaction-history changes, tenant resets, or payment/order-history modifications are part of this patch.

## Secrets / environment impact

No new secret or required environment variable is introduced. Existing timeout environment values above 15 seconds are intentionally clamped by runtime policy.

## Deployment safety

The emergency changes are developed on a separate branch and should be reviewed through a pull request. Do not unpause or redeploy `cp-ipos-web` until CI passes and the final diff has been reviewed. Do not create a new Vercel project as a workaround.

## Validation target

Before merge/resume:

```bash
pnpm --filter backoffice-web exec vitest run tests/integration/polling-request-churn-regression.integration.test.ts tests/unit/print-latency-stability-contract.test.ts
pnpm --filter backoffice-web typecheck
pnpm --filter backoffice-web lint
```

After deployment, verify that an idle POS tab no longer generates sub-30-second Vercel network traffic for the protected endpoints and that normal `/api/pos/perf` traffic is at most one request per minute per active browser document, aside from error telemetry.
