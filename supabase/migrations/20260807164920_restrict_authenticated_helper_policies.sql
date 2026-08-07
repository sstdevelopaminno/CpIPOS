do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles = '{public}'
      and (
        coalesce(qual, '') ~ 'app\.(has_branch_access|has_role|is_it_admin|current_user_id)'
        or coalesce(with_check, '') ~ 'app\.(has_branch_access|has_role|is_it_admin|current_user_id)'
      )
  loop
    execute format(
      'alter policy %I on %I.%I to authenticated',
      r.policyname,
      r.schemaname,
      r.tablename
    );
  end loop;
end
$$;
