# CpIPOS Current Package Catalog

Authoritative commercial baseline as of 2026-08-11.

## Canonical packages

Only these packages are current and selectable:

### STARTER — 350 THB / month

- 1 branch
- 1 POS device
- up to 1,000 products
- up to 3,000 bills / month
- 3 GB storage
- 6 months data retention
- CSV export
- Tablet POS / Windows POS supported
- registered-device enforcement remains required
- device quota source: package

### GROWTH — 550 THB / month

- 1 branch
- 2 POS devices
- up to 2,000 products
- up to 5,000 bills / month
- 5 GB storage
- 12 months data retention
- up to 5 staff accounts
- real-time sync
- CSV export
- Tablet POS / Windows POS supported
- registered-device enforcement remains required
- device quota source: package
- recommended package

### CUSTOM — contact sales / inquiry

CUSTOM is designed with the customer based on business requirements. It is not a fixed unlimited retail package.

- price is configured by IT / commercial agreement
- branch, terminal, user, product, bill, storage and retention limits are negotiated
- effective limits must come from the active tenant subscription contract controlled by IT Admin
- Tablet POS / Windows POS may be enabled under the contract
- all POS tablets/terminals remain registered devices
- device enrollment, approval, revoke, health/diagnostics and future safe MDM commands remain tenant + branch + device scoped and audit controlled
- CUSTOM must never disable registered-device policy or bypass POS session/auth guards

## Trial

Trial is not a paid package row.

- 7-day Trial lifecycle
- business data is routed to the Trial data plane while `data_home='trial'`
- paid activation/promotion must be verified before switching to Primary
- Trial must fail closed; never silently fall back to Primary

## IT Admin / MDM integration rule

Package entitlement and device management are separate but connected layers:

1. Package/contract decides how many branches/devices the tenant is entitled to use.
2. IT Admin controls device enrollment and approval within that entitlement.
3. Tablet/Windows POS must still pass server-side tenant, branch, device and POS-session validation.
4. MDM/diagnostics may monitor application/runtime/device health and issue only audited, scoped commands supported by the system.
5. No package may grant a security bypass. Registered-device enforcement, tenant isolation, branch isolation, session guards and RLS remain mandatory.
6. CUSTOM device quota is contract-driven; STARTER/GROWTH device quota is package-driven.

## Retired packages

Any package code other than `starter`, `growth`, or `custom` is not a current package and must not appear in sales, signup, renewal or activation UI.

Legacy rows that still have foreign-key references from historical contracts/audit data are retained only as hidden audit references (`status='retired'`, `is_active=false`, `public_package=false`). They are not valid commercial packages. Unreferenced obsolete package rows may be physically removed, but audit/contract history must not be destroyed merely to remove a package from the catalog.
