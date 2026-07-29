# POS Navigation Settings 2026-07-29

## Current Decision

- The POS left sidebar is now kept lean for daily selling tasks.
- These former main sidebar entries live under `/preview/pos/settings` as settings submenu links:
  - Product Management: `/preview/pos/stock`
  - Members: `/preview/pos/members`
  - Receipt History: `/preview/pos/receipts`
  - Sales Summary: `/preview/pos/sales-summary`
- Main sidebar keeps the high-frequency flow: Sales, Sales List, Open/Close Shift, Settings, and Logout.

## Main Menu Placement

- The settings page includes a submenu named `Main Menu Position` / `สลับแถบเมนูหลัก`.
- Clicking it opens a popup with two choices:
  - `top`: main menu appears near the top under the brand.
  - `bottom`: main menu appears at the bottom of the scroll area, above logout.
- The setting is client-side per POS terminal and intentionally does not require a schema migration.
- Storage key: `pos_main_menu_placement_v1`.
- Cross-component event: `pos-main-menu-placement-updated`.

## Implementation Files

- `apps/backoffice-web/src/components/pos-preview/pos-staff-menu.tsx`
  - Defines the daily POS sidebar items.
  - Do not re-add Product Management, Members, Receipt History, or Sales Summary here unless product direction changes.
- `apps/backoffice-web/src/components/pos-preview/pos-shell-sidebar.tsx`
  - Reads `pos_main_menu_placement_v1`.
  - Listens for `pos-main-menu-placement-updated`.
  - Applies top/bottom placement inside the sidebar scroll region.
- `apps/backoffice-web/src/components/pos-preview/pos-settings-workspace.tsx`
  - Owns settings submenu links for the moved menu items.
  - Owns the language popup and main menu placement popup.

## Guardrails

- Keep package/feature locks by using `featureForPosRoute()` for moved route links.
- Keep Settings available from the sidebar because the moved menus depend on it.
- Do not store menu placement in Supabase without a product decision for per-user or per-device settings.
