# POS business-mode entitlement contract

## Purpose

CpIPOS business modes are product capabilities, not price checks. Commercial package prices are configured in IT Admin and must never be used by POS source code to infer access.

## Business groups

| Group | Meaning | Current modes |
| --- | --- | --- |
| `FG` | Food / restaurant sales family | Takeaway, Dine-in, Delivery |
| `FF` | Buffet sales family | Buffet table |
| `SD` | Stock Direct / general retail sales | General Sale |

Business-group identity is independent from transaction `order_type`. `SD/general_sale` deliberately reuses the proven Home/Takeaway transaction engine instead of introducing another order/payment engine.

## Effective access

The existing feature-gate control plane remains authoritative:

1. the active tenant subscription contract selects a package;
2. `subscription_package_features` determines package inclusion;
3. tenant-level `tenant_feature_subscriptions` can override package inclusion;
4. branch-level `tenant_feature_subscriptions` can override the tenant result;
5. `/api/pos/features` exposes the effective branch result to the authenticated POS session.

The POS must fail closed when a mode-specific feature is not effectively enabled.

## Current mode-to-feature mapping

- `dine_in` -> `table_management`
- `buffet_table` -> `table_management`
- `delivery` -> `delivery_ordering`
- `general_sale` (`SD`) -> `barcode_scanner_mode`

`home` remains the baseline Core POS Sales path and is protected by the existing route/permission feature gate (`core_pos_sales`).

## SD / General Sale rules

- The General Sale control is exposed only when `barcode_scanner_mode` is effectively enabled for the active branch.
- SKU/barcode matching is exact after Unicode/whitespace/case normalization; product-name fuzzy matching is not used.
- Scanning adds an item to the normal POS cart. It does not create a second sales transaction path.
- Payment, receipt, shift and server-authoritative totals remain on the existing POS checkout path.
- Stock authority remains server-side. Client-side mode state must never be treated as permission to bypass stock or payment validation.

## Pricing rule

Values such as THB 350, THB 550, or future package prices are commercial configuration owned by IT Admin package/billing data. POS mode code must depend on stable feature codes only, never on numeric package price thresholds.

## Release boundary

This contract does not change printer routing, Kitchen behavior, database schema, production data, or physical acceptance status. Issue #74 release freeze remains independent from this work.
