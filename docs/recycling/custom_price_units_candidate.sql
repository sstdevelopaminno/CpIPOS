-- Candidate: branch-scoped custom count unit registry, tested before release.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.recycling_is_custom_unit(p_code text) returns boolean
language sql immutable set search_path to '' as $u$
 select coalesce(p_code collate "C" ~ '^custom:[A-Za-z0-9ก-๙][A-Za-z0-9ก-๙ ]{0,23}$' and p_code=btrim(p_code),false);
$u$;
revoke all on function public.recycling_is_custom_unit(text) from public,anon,authenticated;
grant execute on function public.recycling_is_custom_unit(text) to service_role;
create table public.recycling_price_unit_registry(
 tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null,
 unit_code text not null check(unit_code in ('kg','khid','g','piece','carton','vehicle','set','unit','machine','cabinet') or public.recycling_is_custom_unit(unit_code)),
 active boolean not null default true,
 updated_by uuid not null references public.users_profiles(id),
 updated_at timestamptz not null default now(),
 primary key(tenant_id,branch_id,unit_code),
 foreign key(tenant_id,branch_id) references public.branches(tenant_id,id)
);
create unique index recycling_price_unit_registry_casefold on public.recycling_price_unit_registry(tenant_id,branch_id,lower(unit_code));
alter table public.recycling_price_unit_registry enable row level security;
revoke all on public.recycling_price_unit_registry from public,anon,authenticated;
grant select,insert,update on public.recycling_price_unit_registry to service_role;
create function public.recycling_set_price_unit_visibility(p_tenant_id uuid,p_branch_id uuid,p_user_id uuid,p_unit_code text,p_active boolean)
returns void language plpgsql set search_path to '' as $u$
begin
 if p_active is null or p_unit_code is null or not (p_unit_code in ('kg','khid','g','piece','carton','vehicle','set','unit','machine','cabinet') or public.recycling_is_custom_unit(p_unit_code)) then raise exception 'recycling_invalid_unit'; end if;
 if not exists(select 1 from public.branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id) then raise exception 'recycling_branch_not_found'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text||':'||p_branch_id::text,0));
 if not exists(select 1 from public.recycling_price_unit_registry where tenant_id=p_tenant_id and branch_id=p_branch_id and unit_code=p_unit_code)
 and (select count(*) from public.recycling_price_unit_registry where tenant_id=p_tenant_id and branch_id=p_branch_id)>=500 then raise exception 'recycling_unit_limit'; end if;
 insert into public.recycling_price_unit_registry(tenant_id,branch_id,unit_code,active,updated_by)
 values(p_tenant_id,p_branch_id,p_unit_code,p_active,p_user_id)
 on conflict(tenant_id,branch_id,unit_code) do update set active=excluded.active,updated_by=excluded.updated_by,updated_at=now();
end;
$u$;
revoke all on function public.recycling_set_price_unit_visibility(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.recycling_set_price_unit_visibility(uuid,uuid,uuid,text,boolean) to service_role;
alter table public.recycling_transaction_lines drop constraint recycling_transaction_lines_original_unit_check;
alter table public.recycling_transaction_lines add constraint recycling_transaction_lines_original_unit_check check(original_unit in ('kg','khid','g','ton','piece','stem','carton','vehicle','set','unit','machine','cabinet') or public.recycling_is_custom_unit(original_unit));
-- Fail closed if the installed canonical posting function differs at any patch point.
do $patch$
declare src text; before_text text;
begin
 src:=pg_get_functiondef('public.recycling_post_transaction_vat(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure);
 before_text:=$old$if coalesce(v_unit,'') not in ('kg','khid','g','ton','piece','stem','carton','vehicle','set','unit','machine','cabinet') then$old$;
 if (length(src)-length(replace(src,before_text,'')))/length(before_text)<>1 then raise exception 'custom unit patch mismatch'; end if;
 src:=replace(src,before_text,$new$if coalesce(v_unit,'') not in ('kg','khid','g','ton','piece','stem','carton','vehicle','set','unit','machine','cabinet') and not public.recycling_is_custom_unit(v_unit) then$new$);
 before_text:=$old$if (v_unit in ('carton','vehicle','set','unit','machine','cabinet') or coalesce(v_p.metadata->>'recycling_price_unit','') in ('carton','vehicle','set','unit','machine','cabinet'))$old$;
 if (length(src)-length(replace(src,before_text,'')))/length(before_text)<>1 then raise exception 'custom unit patch mismatch'; end if;
 src:=replace(src,before_text,$new$if (v_unit in ('carton','vehicle','set','unit','machine','cabinet') or public.recycling_is_custom_unit(v_unit) or coalesce(v_p.metadata->>'recycling_price_unit','') in ('carton','vehicle','set','unit','machine','cabinet') or public.recycling_is_custom_unit(v_p.metadata->>'recycling_price_unit'))$new$);
 before_text:=$old$if (v_unit in ('piece','stem','carton','vehicle','set','unit','machine','cabinet')) <>$old$;
 if (length(src)-length(replace(src,before_text,'')))/length(before_text)<>1 then raise exception 'custom unit patch mismatch'; end if;
 src:=replace(src,before_text,$new$if public.recycling_is_custom_unit(v_unit) and not exists(select 1 from public.recycling_price_unit_registry where tenant_id=p_tenant_id and branch_id=p_branch_id and unit_code=v_unit) then raise exception 'recycling_invalid_unit'; end if;
    if (v_unit in ('piece','stem','carton','vehicle','set','unit','machine','cabinet') or public.recycling_is_custom_unit(v_unit)) <>$new$);
 before_text:=$old$if v_unit in ('piece','stem','carton','vehicle','set','unit','machine','cabinet') and$old$;
 if (length(src)-length(replace(src,before_text,'')))/length(before_text)<>1 then raise exception 'custom unit patch mismatch'; end if;
 src:=replace(src,before_text,$new$if (v_unit in ('piece','stem','carton','vehicle','set','unit','machine','cabinet') or public.recycling_is_custom_unit(v_unit)) and$new$);
 before_text:=$old$and v_unit not in ('piece','stem','carton','vehicle','set','unit','machine','cabinet') then$old$;
 if (length(src)-length(replace(src,before_text,'')))/length(before_text)<>1 then raise exception 'custom unit patch mismatch'; end if;
 src:=replace(src,before_text,$new$and v_unit not in ('piece','stem','carton','vehicle','set','unit','machine','cabinet') and not public.recycling_is_custom_unit(v_unit) then$new$);
 execute src;
end;
$patch$;
commit;
