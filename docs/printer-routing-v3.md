# Printer Routing V3

Updated: 2026-08-12

## Goal

CpIPOS printer routing must support every tenant independently, with multiple branches per tenant, multiple POS/runtime devices per branch, and different printer hardware per POS or branch. Customer-facing paper widths are 58 mm and 80 mm. Hardware transport may be LAN, USB, or Bluetooth/Android/Runtime bridge.

## Scope hierarchy

Every runtime print decision must preserve this scope:

`tenant_id -> branch_id -> POS runtime device_code -> print purpose -> kitchen zone -> printer profile`

A printer configured for another tenant or branch is never eligible. When a POS `device_code` is available, routing precedence is:

1. assignment bound to the exact POS/runtime device;
2. branch-wide assignment whose `runtime_device_code` is empty;
3. legacy printer-role fallback, but only an exact runtime-targeted profile or an unbound branch profile;
4. no route. Never fall across to a printer bound to another POS.

## Print purposes

`printer_device_assignments.purpose` is the primary routing intent:

- `receipt` - sales/checkout receipt
- `reprint` - historical receipt reprint
- `shift_report` - shift close/report
- `kitchen` - kitchen ticket
- `drink` - drink station
- `bar` - bar station
- `payment_slip` - payment slip
- `cash_drawer` - cash drawer controller association

One printer may have several purposes. `copies`, `is_default`, and `zone_key` belong to the assignment, not to the tenant globally.

## Kitchen routing

The existing Kitchen subsystem remains the source of truth for split kitchen routing:

- `kitchen_routing_rules` classifies products/categories/default routes.
- `kitchen_zones` defines branch-local stations.
- `kitchen_zones.default_printer_id` selects the printer for each station.
- `app.enqueue_kitchen_order` creates zone tickets and print jobs.

Printer Settings V3 synchronizes zoned kitchen assignments with `kitchen_zones.default_printer_id`; it does not create a second kitchen routing engine.

If a branch has no Kitchen Zone yet, POS order creation falls back to the branch-wide `kitchen` printer and prints all order items there. Once active zones exist and routing returns zone tickets, the fallback is not used.

## POS entry points

### Sales / order creation

`POST /api/pos/orders`

After the order transaction succeeds, kitchen dispatch runs in `after()` so printer/KDS failures cannot roll back the sale. Active Kitchen Zones split tickets by existing routing rules; otherwise the branch-wide kitchen fallback is used.

### Checkout receipt

`POST /api/pos/payments`

Receipt routing uses the active POS session `device_code`. `receipt` assignment is preferred for that POS, then branch-wide fallback. Receipt rendering uses the selected printer's `paper_width_mm` (58/80).

### Historical receipt

`POST /api/pos/receipts/[orderId]/reprint`

Manager/owner approval remains required. Routing uses `reprint`, falls back to `receipt`, and is scoped to the current POS session device.

### Shift close

`POST /api/pos/shift` with `action=close`

Shift close commits independently of printing. A shift-close report is queued in `after()` using `shift_report`, then `receipt` as a fallback, scoped to the POS device. The report renderer uses 58/80 column width.

## Printer Settings V3

The backoffice screen stores:

- branch-local printer identity and transport;
- 58/80 mm paper width;
- optional POS/runtime device binding;
- one or more print purposes;
- optional Kitchen Zone selections for kitchen/drink/bar;
- assignment copies/default flags.

Leaving runtime device code empty makes a printer branch-wide. Binding it to a POS makes it eligible only for that POS (unless a separate branch-wide fallback is also configured).

## Data-home behavior

`getSupabaseServiceClient()` is the routed service client. Business data such as `printer_profiles`, `print_jobs`, `orders`, and Kitchen tables follows the tenant data-home router. POS session/control-plane scope still provides authoritative `tenant_id`, `branch_id`, and `device_code`.

## Compatibility

Legacy `printer_role` (`receipt`, `kitchen`, `report`) remains a fallback for tenants that have not yet created V3 assignments. New configuration should use `printer_device_assignments`.

## Safety rules

- Never route across tenant or branch boundaries.
- Never route a POS to a printer explicitly bound to a different POS.
- Do not invent LAN IP addresses or physical device identifiers.
- Printer failure must not roll back a completed sale or shift close; queue/dead-letter/audit instead.
- Kitchen Zone names/codes are business configuration and must not be invented when a branch has not defined them.
