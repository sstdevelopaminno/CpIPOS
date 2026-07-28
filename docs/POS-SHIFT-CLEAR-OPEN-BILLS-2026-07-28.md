# POS Shift Clear Open Bills 2026-07-28

## Problem

When a shift has passed its scheduled window, the shift reminder blocks `ต่อกะ` if open bills or open table bill sessions remain. This protects sales integrity, but it can trap the next user when an old user left draft/queued/preparing bills and nobody can finish clearing them before midnight.

## Decision

Add a guarded recovery action and an automatic UI-side recovery flag for stuck shift close/handoff.

This action must not delete rows and must not convert open bills into paid sales. It cancels the blocking records, releases tables, writes audit metadata, then lets the existing close-shift/open-shift flow continue.

## Implementation

- API: `POST /api/pos/shifts/clear-open-bills`
- Close API flag: `POST /api/pos/shifts/close` with `clear_open_bills: true`
- Shared server helper: `apps/backoffice-web/src/lib/pos-shift-open-bills.ts`
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

- The shift-cycle guard sends `clear_open_bills: true` when closing a shift from the modal, continuing to the next shift, or auto-closing an overdue shift.
- If the UI still receives `shift_has_open_bills`, the popup toast appears in Thai and the modal keeps a manual recovery button visible.
- In continue mode, the manual button clears/ closes the old shift and opens the next shift.
- In urgent/auto-close mode, the manual button clears/ closes the old shift and redirects to branch selection.

## Guardrails For Future AI

- Do not remove the close-shift blocker entirely; it prevents accidental unclosed sales.
- Do not hard-delete orders or table sessions for this recovery path.
- Keep the audit action `pos_shift_open_bills_cleared` if changing internals so operations can track who cleared a stuck shift.
- Keep `clear_open_bills: true` in the POS shift-cycle UI unless replacing it with an equal or safer automatic recovery, because otherwise users can be trapped by old open bills after the shift window.
- If stock reversal becomes required, add an explicit stock-compensation path before cancelling queued/preparing orders.
