-- Add a dedicated Kitchen branch role without changing existing owner/manager/staff semantics.
-- PostgreSQL enum additions are intentionally additive and safe for existing rows.

alter type public.branch_role add value if not exists 'kitchen';
