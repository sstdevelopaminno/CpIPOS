-- CpiPOS-001: avoid per-row auth.uid() calls for IT Support chat mirror reads.
-- Preserve tenant access, IT role checks, RLS, policy role and command.
-- Corresponds to Supabase security/performance advisor auth_rls_initplan warning
-- for public.support_chat_heads.support_chat_heads_select (2026-10-19).
--
-- Before/after equivalence: only auth.uid() changes to (select auth.uid()).
-- auth.uid() is a stable request-scoped JWT identity, and the scalar subquery
-- allows PostgreSQL to initialize it once per statement.
-- Never memoize app.has_tenant_access(tenant_id), which is row-dependent.
--
-- No table DML, grants, function changes, tenant routing or data removal.
alter policy support_chat_heads_select
on public.support_chat_heads
using (
  app.has_tenant_access(tenant_id)
  or exists (
    select 1
    from public.users_profiles up
    where up.id = (select auth.uid())
      and up.platform_role in ('it_admin', 'it_support')
      and up.is_active = true
      and up.archived_at is null
  )
);
