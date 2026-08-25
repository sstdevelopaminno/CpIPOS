# Buffet / FF0001 Foundation

Status: SOURCE READY / DEPLOYMENT LANE PREP — NOT PROVISIONED / NOT CUSTOMER-ACTIVE

## Goal

Create a Buffet product line that remains inside the CpIPOS monorepo and shared platform core, while using a separate Vercel project/deployment lane from Restaurant QR.

## Identity

- Product profile: `BUFFET`
- Store-code prefix: `FF`
- First reserved store code: `FF0001`
- Vercel project: `cp-ipos-buffet-web`
- Production branch: `buffet/main`
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

## Buffet-specific capabilities already present in the shared POS source

- Buffet table mode and persisted table-session summaries
- Guest/set additions and package selection
- Branch-scoped buffet pricing and exact quantity controls
- Dynamic buffet plans and set catalog management
- Package-scoped QR menu policy
- Timed/bill QR lifecycle and countdown/lockout
- Checkout/payment flow preservation for buffet table mode

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

## Delivery gate

1. Vercel project `cp-ipos-buffet-web` must track `buffet/main`.
2. Root directory remains `apps/backoffice-web` for the current shared-POS Buffet lane.
3. `CPIPOS_PRODUCT_PROFILE=BUFFET` must be present in Production and Preview.
4. `/api/system/product-line` must return `BUFFET_WEB` before FF0001 provisioning.
5. Provision FF0001 as `PROVISIONING / INACTIVE` first, run store/branch/device/printer/payment preflight, then activate only after customer acceptance.

## Android runtime

The website download `CpIPOS-Android-POS-1.0.20` remains the shared Android runtime for Restaurant QR and Buffet. Do not create a Buffet-specific APK unless native hardware requirements diverge.
