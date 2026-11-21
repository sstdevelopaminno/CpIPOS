-- PostgreSQL 16 disposable test; no production identities or credentials.
-- Extend the minimal synthetic UAT schema to mirror the required recovery columns.
alter table public.shifts add column device_code text;
alter table public.shifts add column opened_by uuid;
alter table public.pos_sessions add column device_code text;
alter table public.pos_sessions add column user_id uuid;
alter table public.pos_sessions add column role text;
alter table public.pos_sessions add column expires_at timestamptz default (now()+interval '1 day');

create table public.payments(
 id uuid primary key,tenant_id uuid,branch_id uuid,shift_id uuid
);
create table public.cash_drawer_events(
 id uuid primary key,tenant_id uuid,branch_id uuid,shift_id uuid
);
create table public.audit_logs(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid,branch_id uuid,actor_user_id uuid not null,actor_role text not null,
 action text not null,target_table text not null,target_id uuid,metadata jsonb not null default '{}'::jsonb,
 user_id uuid,role text,module text,entity_type text,entity_id text,pos_session_id uuid
);
-- We intentionally do NOT create a 13:00/18:00 shift guard, only its orphaned rows.
insert into public.users_profiles(id,is_active)
 values ('99999999-9999-4999-8999-999999999999',true);
insert into public.user_branch_roles(user_id,tenant_id,branch_id,role)
 values ('99999999-9999-4999-8999-999999999999',
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222','manager');

-- A spuriously closed Recycling daily shift, with fake zero actual from
-- the former 18:00 generic POS close and an overlapping empty POS gate shift.
insert into public.shifts(id,tenant_id,branch_id,device_code,opened_by,status,
 opened_at,closed_at,opening_cash,closing_cash,actual_cash,metadata)
values(
 '10101010-1010-4010-8010-101010101010',
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222',
 'POS-000001','99999999-9999-4999-8999-999999999999','closed',
 now()-interval '2 hours',now()-interval '1 hour',
 null,null,0,
 '{"business_shift_mode":"recycling_daily","opened_via":"recycling_auto_on_cashier_entry","close_reason":"self_close"}'
);
insert into public.shifts(id,tenant_id,branch_id,device_code,opened_by,status,
 opened_at,opening_cash,metadata)
values(
 '20202020-2020-4020-8020-202020202020',
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222',
 'POS-000001','99999999-9999-4999-8999-999999999999','open',
 now()-interval '1 hour'+interval '1 second',0,
 '{"opened_via":"pos_session_gate"}'
);
insert into public.pos_sessions(id,tenant_id,branch_id,user_id,role,device_code,expires_at,shift_id)
values(
 '30303030-3030-4030-8030-303030303030',
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222',
 '99999999-9999-4999-8999-999999999999','manager','POS-000001',
 now()+interval '4 hours','20202020-2020-4020-8020-202020202020'
);

do $assert$
declare v_result jsonb;v_new uuid;v_rows bigint;
begin
 if has_function_privilege('anon',
  'public.recycling_recover_legacy_shift_v1(uuid,boolean)','EXECUTE')
  or has_function_privilege('authenticated',
  'public.recycling_recover_legacy_shift_v1(uuid,boolean)','EXECUTE') then
   raise exception 'RPC is exposed to client roles';
 end if;
 begin
   perform public.recycling_recover_legacy_shift_v1(
     '30303030-3030-4030-8030-303030303030',false);
   raise exception 'Should reject unconfirmed cash';
 exception when others then
   if sqlerrm='Should reject unconfirmed cash' then raise; end if;
   if sqlerrm not like '%recycling_recovery_confirmation_required%' then raise; end if;
 end;
 v_result:=public.recycling_recover_legacy_shift_v1(
   '30303030-3030-4030-8030-303030303030',true);
 v_new:=(v_result->>'shift_id')::uuid;
 if v_new is null or (select status from public.shifts where id=v_new)<>'open' then
   raise exception 'Expected new Recycling shift open after recovery';
 end if;
 if (select metadata->>'business_shift_mode' from public.shifts where id=v_new)<>'recycling_daily' then
   raise exception 'New shift must be tagged Recycling';
 end if;
 if (select status from public.shifts
    where id='20202020-2020-4020-8020-202020202020')<>'closed' then
   raise exception 'Legacy ghost shift not closed';
 end if;
 if (select status from public.shifts
    where id='10101010-1010-4010-8010-101010101010')<>'closed' then
   raise exception 'History changed: previous Recycling shift was reopened';
 end if;
 if (select shift_id from public.pos_sessions
    where id='30303030-3030-4030-8030-303030303030')<>v_new then
   raise exception 'Manager session binding not restored';
 end if;
 select count(*) into v_rows from public.audit_logs
    where action='recycling_legacy_shift_zero_cash_recovered'
      and target_id=v_new;
 if v_rows<>1 then raise exception 'Required atomic audit missing'; end if;
 if (select status from public.shifts where id='cccccccc-0000-4000-8000-000000000000')<>'closed' then
   raise exception 'Normal POS shift was modified';
 end if;
 begin
  perform public.recycling_recover_legacy_shift_v1(
    '30303030-3030-4030-8030-303030303030',true);
  raise exception 'Recovery must not run twice';
 exception when others then
  if sqlerrm='Recovery must not run twice' then raise; end if;
  if sqlerrm not like '%recycling_recovery_not_a_zero_float_legacy_shift%' then raise; end if;
 end;
end;
$assert$;

-- Nonzero POS opening cash is a hard stop even if the cashier confirms zero.
insert into public.shifts(id,tenant_id,branch_id,device_code,opened_by,status,
 opened_at,closed_at,opening_cash,closing_cash,actual_cash,metadata)
values('40404040-4040-4040-8040-404040404040',
 '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 'POS-000002','99999999-9999-4999-8999-999999999999','closed',
 now()-interval '3 hours',now()-interval '2 hours',null,null,0,
 '{"business_shift_mode":"recycling_daily","opened_via":"recycling_auto_on_cashier_entry","close_reason":"self_close"}');
insert into public.shifts(id,tenant_id,branch_id,device_code,opened_by,status,
 opened_at,opening_cash,metadata)
values('50505050-5050-4050-8050-505050505050',
 '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 'POS-000002','99999999-9999-4999-8999-999999999999','open',
 now()-interval '2 hours'+interval '1 second',500,
 '{"opened_via":"pos_session_gate"}');
insert into public.pos_sessions(id,tenant_id,branch_id,user_id,role,device_code,expires_at,shift_id)
values('60606060-6060-4060-8060-606060606060',
 '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 '99999999-9999-4999-8999-999999999999','manager','POS-000002',
 now()+interval '4 hours','50505050-5050-4050-8050-505050505050');
do $assert$
begin
 begin
  perform public.recycling_recover_legacy_shift_v1(
    '60606060-6060-4060-8060-606060606060',true);
  raise exception 'Nonzero cash recovery must be forbidden';
 exception when others then
  if sqlerrm='Nonzero cash recovery must be forbidden' then raise; end if;
  if sqlerrm not like '%recycling_recovery_not_a_zero_float_legacy_shift%' then raise; end if;
 end;
 if (select status from public.shifts
   where id='50505050-5050-4050-8050-505050505050')<>'open' then
  raise exception 'Refused recovery modified the legacy shift';
 end if;
end;
$assert$;

-- A zero-float legacy shift with any attached order is also a hard stop.
update public.shifts set opening_cash=0
 where id='50505050-5050-4050-8050-505050505050';
insert into public.orders(id,tenant_id,branch_id,shift_id)
values('70707070-7070-4070-8070-707070707070',
 '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 '50505050-5050-4050-8050-505050505050');
do $assert$
begin
 begin
  perform public.recycling_recover_legacy_shift_v1(
    '60606060-6060-4060-8060-606060606060',true);
  raise exception 'Recovery must reject a shift with orders';
 exception when others then
  if sqlerrm='Recovery must reject a shift with orders' then raise; end if;
  if sqlerrm not like '%recycling_recovery_orders_present%' then raise; end if;
 end;
 if (select status from public.shifts
  where id='50505050-5050-4050-8050-505050505050')<>'open' then
    raise exception 'Refused activity recovery modified the legacy shift';
 end if;
end;
$assert$;
