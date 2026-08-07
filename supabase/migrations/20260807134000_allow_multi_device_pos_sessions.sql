-- P0 session stability: allow the same POS user to stay signed in on multiple devices
-- within the same tenant/branch. Device exclusivity remains enforced by the existing
-- active-session unique indexes on device_id and device_code.
--
-- The old user+branch unique index contradicts the current application session model:
-- a user may have one active session per device, while a device may have only one
-- active POS session in its tenant/branch scope.

drop index if exists public.uq_pos_sessions_user_branch_active;
