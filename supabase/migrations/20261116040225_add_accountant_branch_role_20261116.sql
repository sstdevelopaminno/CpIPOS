-- CpiPOS-001 Production hotfix, 2026-11-16.
-- Finance Accountant was introduced in the POS/IT code while the existing
-- user_branch_roles.role enum only allowed owner/manager/staff/kitchen.
-- Keep the existing enum and all existing user assignments unchanged.
--
-- Applied on CpiPOS-001 as migration add_accountant_branch_role_20261116
-- (Supabase migration history version 20261116040225).
ALTER TYPE public.branch_role ADD VALUE IF NOT EXISTS 'accountant';
