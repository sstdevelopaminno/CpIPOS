# Buffet / FF0001 Foundation

Status: SOURCE FOUNDATION ONLY — NOT PROVISIONED / NOT PRODUCTION-ACTIVE

## Goal

Create a Buffet product line that remains inside the CpIPOS monorepo and shared platform core, while using a separate Vercel project/deployment lane from Restaurant QR.

## Identity

- Product profile: `BUFFET`
- Store-code prefix: `FF`
- First reserved store code: `FF0001`
- Proposed Vercel project: `cp-ipos-buffet-web`
- Required deployment env: `CPIPOS_PRODUCT_PROFILE=BUFFET`

## Isolation rules

1. Restaurant QR Production (`cp-ipos-web`) is not used as the Buffet production deployment target.
2. FF0001 is not created or activated until store/package/device/printer/payment details are explicitly supplied.
3. No Restaurant QR tenant/branch UUID is reused by Buffet.
4. Store/branch/device scoped actions are required; no global MDM rollout is introduced by this foundation.
5. Existing Android Shared Runtime remains the baseline. A Buffet-specific APK is not created unless native hardware behavior later diverges.

## Shared platform capabilities

- Store/login resolution
- POS session and role/permission checks
- Shift lifecycle
- Payments
- Printer routing / Print Agent
- MDM / device heartbeat
- Dual-screen / Customer Display runtime
- Audit and monitoring primitives

## Buffet-specific domain boundary

- Guest count (adult/child or package-specific groups)
- Buffet package/pricing selection
- Session start/end and countdown
- Ordering rounds
- Per-round item/quantity limits
- Last-order cutoff
- Extra-time / extra-charge rules
- Table/session settlement rules

## Source foundation

- `apps/backoffice-web/src/lib/buffet-profile.ts`
- `apps/backoffice-web/src/app/buffet/page.tsx`
- `apps/backoffice-web/src/app/api/system/product-line/route.ts`

The product-line endpoint is deliberately fail-closed: without `CPIPOS_PRODUCT_PROFILE=BUFFET`, it reports `CORE_WEB` and does not advertise FF0001 as ready for provisioning.

## Next gate

Create a separate Vercel project connected to the same GitHub repository, use the Buffet branch as its initial production branch, set the project root to `apps/backoffice-web`, set `CPIPOS_PRODUCT_PROFILE=BUFFET`, then verify `/api/system/product-line` returns `BUFFET_WEB` before any Supabase provisioning.
