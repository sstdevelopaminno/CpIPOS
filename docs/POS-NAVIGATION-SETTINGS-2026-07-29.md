# POS Navigation Settings 2026-07-29

## Current Decision

- The POS left sidebar is now kept lean for daily selling tasks.
- These former main sidebar entries now live on the `More` / `เพิ่มเติม` menu page at `/preview/pos/more`, shown immediately after Open/Close Shift:
  - Sales Summary: `/preview/pos/sales-summary`
  - Receipt History: `/preview/pos/receipts`
  - Table Management: `/preview/pos/tables`
  - Product Management: `/preview/pos/stock`
  - Members: `/preview/pos/members`
- Main sidebar keeps the high-frequency flow: Sales, Sales List, Open/Close Shift, More, Settings, and Logout.
- Staff role must not see the More menu in the main navigation and direct `/preview/pos/more` access redirects back to `/preview/pos`.
- Each moved page must keep a deterministic Back to More button that links to `/preview/pos/more`; do not rely only on browser history.

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
  - Shows the `More` link for non-staff roles only.
- `apps/backoffice-web/src/app/preview/pos/more/page.tsx`
  - Server-gates direct More page access and redirects staff back to `/preview/pos`.
- `apps/backoffice-web/src/components/pos-preview/pos-more-workspace.tsx`
  - Owns the Settings-style More menu grid and the five moved operational links.
- `apps/backoffice-web/src/components/pos-preview/pos-shell-sidebar.tsx`
  - Renders left vertical and top/bottom horizontal navigation variants.
- `apps/backoffice-web/src/components/pos-preview/pos-shell-frame.tsx`
  - Reads `pos_main_menu_bar_position_v2`.
  - Listens for `pos-main-menu-placement-updated`.
  - Reorders the sidebar and content area for left/top/bottom placement.
- `apps/backoffice-web/src/components/pos-preview/pos-settings-workspace.tsx`
  - Owns system settings, language popup, and main menu placement popup.
  - Settings content is scrollable because the submenu can grow on smaller customer screens.

## Guardrails

- Keep package/feature locks by using `featureForPosRoute()` for More page route links.
- More must remain a normal page, not a popup. Users should navigate into More, open an item, then use Back to More.
- Keep Settings available from the sidebar for system configuration only; do not move Sales Summary, Receipt History, Table Management, Product Management, or Members back into Settings unless product direction changes.
- Do not store menu placement in Supabase without a product decision for per-user or per-device settings.
