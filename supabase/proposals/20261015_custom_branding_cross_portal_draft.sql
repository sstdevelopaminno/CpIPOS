-- Shared POS/CRM CUSTOM white-label presentation; no fixed-plan writes.
-- Change control: apply to target Supabase only after schema/RLS QA.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('custom-branding','custom-branding',true,1048576,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set file_size_limit=1048576,
 allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.customer_portal_custom_branding_v1(
 p_tenant_id uuid,p_payload jsonb default null)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,auth,app
as $$
declare v_role text;v_meta jsonb;v_value jsonb;v_active boolean;v_name text;
 v_accent text;v_sidebar text;v_logo text;
begin
 if auth.uid() is null then raise exception 'BRANDING_AUTH_REQUIRED'; end if;
 select r.role::text into v_role from public.user_branch_roles r
 join public.users_profiles u on u.id=r.user_id and u.is_active=true
 where r.user_id=auth.uid() and r.tenant_id=p_tenant_id
   and r.role::text in ('owner','manager')
 order by case r.role::text when 'owner' then 0 else 1 end limit 1;
 if v_role is null then raise exception 'BRANDING_OWNER_MANAGER_REQUIRED'; end if;
 select exists(
  select 1 from public.tenant_subscription_contracts c
  join public.subscription_packages sp on sp.id=c.package_id
  where c.id=(select d.id from public.tenant_subscription_contracts d
    where d.tenant_id=p_tenant_id order by d.created_at desc limit 1)
  and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now())
  and lower(sp.code)='custom'
 ) into v_active;
 if not v_active then raise exception 'BRANDING_CUSTOM_ONLY'; end if;
 select coalesce(t.metadata,'{}'::jsonb) into v_meta
 from public.tenants t where t.id=p_tenant_id for update;
 if not found then raise exception 'BRANDING_TENANT_NOT_FOUND'; end if;
 if p_payload is not null then
   if jsonb_typeof(p_payload)<>'object' then raise exception 'BRANDING_INVALID'; end if;
   v_name=btrim(p_payload->>'system_name');
   v_accent=upper(p_payload->>'accent_color');
   v_sidebar=upper(p_payload->>'sidebar_color');
   v_logo=nullif(btrim(coalesce(p_payload->>'logo_url','')),'');
   if char_length(v_name)<2 or char_length(v_name)>55 or v_name~'[<>]' then
     raise exception 'BRANDING_NAME_INVALID'; end if;
   if v_accent !~ '^#[0-9A-F]{6}$' or v_sidebar !~ '^#[0-9A-F]{6}$' then
     raise exception 'BRANDING_COLOR_INVALID'; end if;
   if v_logo is not null and (
    char_length(v_logo)>900 or
    v_logo !~ ('^https://[^/]+/storage/v1/object/public/custom-branding/'||
      p_tenant_id::text||'/[A-Za-z0-9_.-]+[.](png|jpg|webp)$')
   ) then raise exception 'BRANDING_LOGO_INVALID'; end if;
   v_value=jsonb_build_object('system_name',v_name,'accent_color',v_accent,
     'sidebar_color',v_sidebar,'logo_url',v_logo);
   update public.tenants set metadata=v_meta||jsonb_build_object('custom_branding',v_value),
     updated_at=now() where id=p_tenant_id;
 else
   v_value=coalesce(v_meta->'custom_branding',jsonb_build_object(
     'system_name','CpiPOS','accent_color','#1453A6',
     'sidebar_color','#071B37','logo_url',null));
 end if;
 return v_value;
end $$;
revoke all on function public.customer_portal_custom_branding_v1(uuid,jsonb) from PUBLIC,anon;
grant execute on function public.customer_portal_custom_branding_v1(uuid,jsonb) to authenticated;

-- Upload path is TENANT-ID/file.ext. CRM authenticated uploads use the same
-- branch-owner/manager CUSTOM checks. Server-side POS uses service_role.
create policy "custom_branding_owner_upload" on storage.objects
for insert to authenticated with check(
 bucket_id='custom-branding'
 and (storage.foldername(name))[1] is not null
 and exists(select 1 from public.user_branch_roles r
   join public.users_profiles u on u.id=r.user_id and u.is_active=true
   join public.tenant_subscription_contracts c on c.tenant_id=r.tenant_id
   join public.subscription_packages sp on sp.id=c.package_id
   where r.user_id=auth.uid() and r.role::text in ('owner','manager')
     and r.tenant_id::text=(storage.foldername(name))[1]
     and c.id=(select d.id from public.tenant_subscription_contracts d
       where d.tenant_id=r.tenant_id order by d.created_at desc limit 1)
     and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now())
     and lower(sp.code)='custom')
);
-- Public reads only from public bucket; no UPDATE/DELETE policy to users.

-- POS authenticated session is validated by the Next.js API, which then calls
-- a service-only atomic JSON patch. Reject all browser roles at database level.
create or replace function public.cpipos_service_save_custom_branding_v1(
  p_tenant_id uuid,p_branding jsonb)
returns void language plpgsql security invoker
set search_path=pg_catalog,public
as $$
begin
 if current_user not in ('service_role','postgres') then
  raise exception 'BRANDING_SERVICE_ONLY'; end if;
 update public.tenants set
  metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),
    '{custom_branding}',p_branding,true),
  updated_at=now() where id=p_tenant_id;
 if not found then raise exception 'BRANDING_TENANT_NOT_FOUND'; end if;
end $$;
revoke all on function public.cpipos_service_save_custom_branding_v1(uuid,jsonb)
 from PUBLIC,anon,authenticated;
grant execute on function public.cpipos_service_save_custom_branding_v1(uuid,jsonb)
 to service_role;
