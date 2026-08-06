# Authentication Flow

1. Store code verification resolves active tenant.
2. Active branches are loaded server-side.
3. Single branch can be auto-selected; multi-branch shows branch selection.
4. Employee code verification must resolve membership and role server-side.
5. Employee verification only updates the signed login-flow cookie; it does not create a POS session yet.
6. Cashier device selection loads `branch_devices` server-side and validates the selected device against tenant and branch.
7. Server creates a revocable `pos_sessions` row only after a valid cashier device is selected, then sets the HttpOnly mobile session cookie with device scope.
8. After cashier device selection, the app redirects to `ปิดยอด` so the operator can open the shift for the selected device.
9. The `ปิดยอด` page requires opening cash/change amount, then opens the selected cashier device shift and redirects to `ขาย`.
10. `/dashboard` is compatibility-only and redirects to `ขาย` when a shift is open, or `ปิดยอด` when no shift is open.
11. Logout revokes server session before clearing cookie.
