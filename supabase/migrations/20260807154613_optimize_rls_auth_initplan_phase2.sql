-- Phase 2 database housekeeping: preserve RLS semantics while avoiding per-row auth.uid() re-evaluation.

alter policy user_profiles_self_or_admin
on public.users_profiles
using (
  id = (select auth.uid())
  or app.is_it_admin()
  or exists (
    select 1
    from public.user_branch_roles ubr
    where ubr.user_id = users_profiles.id
      and app.has_tenant_access(ubr.tenant_id)
  )
);

alter policy user_profiles_self_update
on public.users_profiles
using (
  id = (select auth.uid())
  or app.is_it_admin()
)
with check (
  id = (select auth.uid())
  or app.is_it_admin()
);

alter policy manager_pin_approvals_insert
on public.manager_pin_approvals
with check (
  app.has_branch_access(tenant_id, branch_id)
  and approved_by = (select auth.uid())
  and app.has_role(tenant_id, branch_id, array['manager'::public.branch_role, 'owner'::public.branch_role])
);

alter policy mobile_device_sessions_select
on public.mobile_device_sessions
using (
  app.is_it_admin()
  or (select auth.uid()) = user_id
  or (
    branch_id is not null
    and app.has_role(tenant_id, branch_id, array['owner'::public.branch_role, 'manager'::public.branch_role])
  )
);

alter policy pos_user_approval_permissions_owner_manage
on public.pos_user_approval_permissions
using (
  exists (
    select 1
    from public.user_branch_roles ubr
    where ubr.user_id = (select auth.uid())
      and ubr.tenant_id = pos_user_approval_permissions.tenant_id
      and ubr.branch_id = pos_user_approval_permissions.branch_id
      and ubr.role = 'owner'::public.branch_role
  )
)
with check (
  exists (
    select 1
    from public.user_branch_roles ubr
    where ubr.user_id = (select auth.uid())
      and ubr.tenant_id = pos_user_approval_permissions.tenant_id
      and ubr.branch_id = pos_user_approval_permissions.branch_id
      and ubr.role = 'owner'::public.branch_role
  )
);

alter policy staff_attendance_events_select_self_or_branch_manage
on public.staff_attendance_events
using (
  app.is_it_admin()
  or user_id = (select auth.uid())
  or app.has_role(tenant_id, branch_id, array['owner'::public.branch_role, 'manager'::public.branch_role])
);

alter policy staff_attendance_records_select_self_or_branch_manage
on public.staff_attendance_records
using (
  app.is_it_admin()
  or user_id = (select auth.uid())
  or app.has_role(tenant_id, branch_id, array['owner'::public.branch_role, 'manager'::public.branch_role])
);

alter policy staff_leave_requests_insert_self_or_manage
on public.staff_leave_requests
with check (
  app.is_it_admin()
  or user_id = (select auth.uid())
  or app.has_role(tenant_id, branch_id, array['owner'::public.branch_role, 'manager'::public.branch_role])
);

alter policy staff_leave_requests_select_self_or_branch_manage
on public.staff_leave_requests
using (
  app.is_it_admin()
  or user_id = (select auth.uid())
  or app.has_role(tenant_id, branch_id, array['owner'::public.branch_role, 'manager'::public.branch_role])
);

alter policy package_feature_catalog_read
on public.package_feature_catalog
to authenticated
using (true);
