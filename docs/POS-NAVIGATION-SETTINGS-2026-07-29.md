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
- Clicking it opens a popup with three choices for the whole navigation bar, not just the item group inside the left sidebar:
  - `left`: original vertical sidebar on the left.
  - `top`: horizontal navigation bar at the top of the POS screen.
  - `bottom`: horizontal navigation bar at the bottom of the POS screen.
- The setting is client-side per POS terminal and intentionally does not require a schema migration.
- Storage key: `pos_main_menu_bar_position_v2`.
- Cross-component event: `pos-main-menu-placement-updated`.

## Implementation Files

- `apps/backoffice-web/src/components/pos-preview/pos-staff-menu.tsx`
  - Defines the daily POS sidebar items.
  - Do not re-add Product Management, Members, Receipt History, or Sales Summary here unless product direction changes.
- `apps/backoffice-web/src/components/pos-preview/pos-shell-sidebar.tsx`
  - Renders left vertical and top/bottom horizontal navigation variants.
- `apps/backoffice-web/src/components/pos-preview/pos-shell-frame.tsx`
  - Reads `pos_main_menu_bar_position_v2`.
  - Listens for `pos-main-menu-placement-updated`.
  - Reorders the sidebar and content area for left/top/bottom placement.
- `apps/backoffice-web/src/components/pos-preview/pos-settings-workspace.tsx`
  - Owns settings submenu links for the moved menu items.
  - Owns the language popup and main menu placement popup.

## Guardrails

- Keep package/feature locks by using `featureForPosRoute()` for moved route links.
- Keep Settings available from the sidebar because the moved menus depend on it.
- Do not store menu placement in Supabase without a product decision for per-user or per-device settings.
