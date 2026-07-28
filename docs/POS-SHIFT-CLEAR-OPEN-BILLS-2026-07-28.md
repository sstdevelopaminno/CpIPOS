# POS Shift Clear Open Bills 2026-07-28

## Problem

When a shift has passed its scheduled window, the shift reminder blocks `ต่อกะ` if open bills or open table bill sessions remain. This protects sales integrity, but it can trap the next user when an old user left draft/queued/preparing bills and nobody can finish clearing them before midnight.

## Decision

Add a guarded recovery action: `เคลียร์บิลค้างและต่อกะ`.

This action must not delete rows and must not convert open bills into paid sales. It cancels the blocking records, releases tables, writes audit metadata, then lets the existing close-shift/open-shift flow continue.

## Implementation

- API: `POST /api/pos/shifts/clear-open-bills`
- Server file: `apps/backoffice-web/src/app/api/pos/shifts/clear-open-bills/route.ts`
- UI file: `apps/backoffice-web/src/components/pos/pos-shift-cycle-guard.tsx`

Server behavior:

- Requires active POS session, active open shift, and `shift:close` permission.
- Staff can clear only their own shift. Owner/manager/accountant can clear by role rules already used by close-shift flow.
- Cancels current-shift `orders` with status `draft`, `queued`, or `preparing`.
- Cancels branch `table_bill_sessions` with status `open`, `ordering`, or `pending_payment`.
- Releases affected `dining_tables` to `available`.
- Writes `pos_shift_open_bills_cleared` audit log with counts and sample IDs/order numbers.

UI behavior:

- Normal `ต่อกะ` still tries the existing safe close/open flow first.
- If `/api/pos/shifts/close` returns `shift_has_open_bills`, the popup toast appears in Thai and the modal shows `เคลียร์บิลค้างและต่อกะ`.
- Pressing that button calls the clear endpoint, then closes the old shift and opens the next shift.
- The button is only shown for the open-bill blocker, not for unrelated API errors.

## Guardrails For Future AI

- Do not remove the close-shift blocker entirely; it prevents accidental unclosed sales.
- Do not hard-delete orders or table sessions for this recovery path.
- Keep the audit action `pos_shift_open_bills_cleared` if changing internals so operations can track who cleared a stuck shift.
- If stock reversal becomes required, add an explicit stock-compensation path before cancelling queued/preparing orders.
