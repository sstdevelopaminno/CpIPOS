-- Read scoped choices for cashiers; only owners/managers may configure them.
do $body$
declare tbl text;
begin
  foreach tbl in array array['product_modifier_groups','product_modifier_options','product_modifier_option_ingredients'] loop
    execute format('drop policy if exists %I on public.%I',tbl||'_isolation',tbl);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.user_branch_roles r where r.user_id=(select auth.uid()) and r.tenant_id=%I.tenant_id and r.branch_id=%I.branch_id))',tbl||'_scoped_read',tbl,tbl,tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.user_branch_roles r where r.user_id=(select auth.uid()) and r.tenant_id=%I.tenant_id and r.branch_id=%I.branch_id and r.role in (''owner'',''manager'')))',tbl||'_manager_insert',tbl,tbl,tbl);
    execute format('create policy %I on public.%I for update to authenticated using (exists (select 1 from public.user_branch_roles r where r.user_id=(select auth.uid()) and r.tenant_id=%I.tenant_id and r.branch_id=%I.branch_id and r.role in (''owner'',''manager''))) with check (exists (select 1 from public.user_branch_roles r where r.user_id=(select auth.uid()) and r.tenant_id=%I.tenant_id and r.branch_id=%I.branch_id and r.role in (''owner'',''manager'')))',tbl||'_manager_update',tbl,tbl,tbl,tbl,tbl);
    execute format('create policy %I on public.%I for delete to authenticated using (exists (select 1 from public.user_branch_roles r where r.user_id=(select auth.uid()) and r.tenant_id=%I.tenant_id and r.branch_id=%I.branch_id and r.role in (''owner'',''manager'')))',tbl||'_manager_delete',tbl,tbl,tbl);
  end loop;
end;
$body$;