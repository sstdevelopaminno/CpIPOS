alter table public.pos_user_profiles
  add column if not exists preferred_language text not null default 'th';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.pos_user_profiles'::regclass
      and conname = 'pos_user_profiles_preferred_language_check'
  ) then
    alter table public.pos_user_profiles
      add constraint pos_user_profiles_preferred_language_check
      check (preferred_language in ('th','en','lo'));
  end if;
end
$$;
