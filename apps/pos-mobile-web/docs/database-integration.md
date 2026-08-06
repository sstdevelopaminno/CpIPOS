# Database Integration

Reused tables from SSTiPOS docs/types: `tenants`, `branches`, `branch_devices`, `user_branch_roles`, `pos_user_profiles`, `pos_sessions`, `orders`, `shifts`, `ingredients`, `staff_attendance_records`, `subscription_package_features`, `tenant_feature_subscriptions`, `audit_logs`.

Mobile POS sessions are created only after employee verification and cashier device selection. `pos_sessions.device_id` and `pos_sessions.device_code` are set from the server-validated `branch_devices` row. Shift checks use the selected `device_code` so each cashier device must open its own shift before the `ขาย` menu becomes available.

No schema change was applied. Any mobile-specific tables must be reviewed first.

Takeaway hold and checkout are now designed to call reviewed Supabase RPC functions so bill line replacement, totals, payments, and final order status can be committed atomically. See `docs/proposed-mobile-takeaway-rpc.sql.md`; the SQL is proposal-only until applied to the shared database.

Mobile membership search, member creation, bill attachment, point/stamp balances, and member history are designed against proposal-only tables in `docs/proposed-mobile-membership.sql.md`.
