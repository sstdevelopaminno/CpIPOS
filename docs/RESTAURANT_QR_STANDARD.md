# Restaurant QR Standard

Status: source/config contract only. Do not deploy or apply migrations from this work package.

## Product Profile

`RESTAURANT_QR` is the reusable Table QR -> POS review -> Kitchen -> Print lifecycle for restaurant stores.

Enabled stores must be explicit. The engine is shared, but activation is not global.

Current source-enabled store:

| store_code | branch_code | product_profile | update_ring |
| --- | --- | --- | --- |
| FG0003 | FG0003-BKK-01 | RESTAURANT_QR | PRODUCTION_PROTECTED |

Next reserved store code: `FG0004`.

## FG0004 Provisioning Prep

Status: `PROVISIONING` dry-run only. `FG0004` is reserved for the next standard Restaurant QR store, but this work package must not create tenant, branch, table, QR, user, device, printer, shift, payment, or historical rows.

Draft default:

| field | value |
| --- | --- |
| store_code | FG0004 |
| product_profile | RESTAURANT_QR |
| deployment_mode | CENTRAL |
| update_ring | PILOT |
| status | PROVISIONING |
| package | TBD |

Branch code convention: `FG0004-<LOCATION>-01`. Use stable uppercase location codes, for example `FG0004-BKK-01`, only after the real location is supplied.

Device code convention: `FG0004-POS-01`, `FG0004-POS-02`, with new device identities per branch. Shared Android runtime remains `com.cpipos.pos`; do not create an FG0004-specific APK.

Provisioning manifest source: `apps/backoffice-web/src/lib/restaurant-qr-provisioning.ts`.

Dry-run safety contract:

- DB writes: NO
- FG0003 modifications: NO
- Other-store modifications: NO
- FG0003 data/IDs/token/session/printer/device reuse: NO
- Restaurant QR activation path: shared `RESTAURANT_QR` profile / `app.restaurant_qr_store_registry`, not store-specific business branches.
- Future live provisioning must be transactional/idempotent, stop if `FG0004` already exists, and pass preflight/postflight checks before use.

## Future Provisioning Inputs

Required when provisioning a new Restaurant QR store:

- `store_code`
- `display_name`
- `legal_name`
- `branch_code`
- `branch_name`
- `province/city/location_code`
- `package`
- `product_profile = RESTAURANT_QR`
- `table_count`
- `table_naming_style`
- `POS device count`
- `POS hardware models`
- `customer_display`
- `receipt printer count/type`
- `kitchen printer count/type`
- `users/roles`
- `employee_login_required`
- `payment_methods`
- `opening_datetime`
- `subscription/features`

Store prefix convention: `FG####` is reserved for standard Restaurant QR stores.

## IT Registry Contract

Future IT Backoffice store creation should write a registry row with:

- `store_code`
- `product_profile`
- `deployment_mode`
- `update_ring`
- `package`
- `status`

Suggested values:

- `product_profile`: `RESTAURANT_QR`, `BUFFET`, `RETAIL`
- `deployment_mode`: `CENTRAL`, `ISOLATED`
- `update_ring`: `LAB`, `PILOT`, `PRODUCTION`, `PRODUCTION_PROTECTED`

No global MDM action is part of this contract.
