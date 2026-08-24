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

## Future Provisioning Inputs

Required when provisioning a new Restaurant QR store:

- `store_code`
- `display_name`
- `branch_code`
- `branch_name`
- `package`
- `product_profile = RESTAURANT_QR`
- `table_count`
- `POS devices`
- `receipt printers`
- `kitchen printers`
- `users/roles`
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
