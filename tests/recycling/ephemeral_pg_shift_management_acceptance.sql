begin;
insert into public.branches(id,tenant_id,name) values('f1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Synthetic history branch');
insert into public.user_branch_roles(user_id,tenant_id,branch_id,role) values('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','f1000000-0000-4000-8000-000000000001','manager');
insert into public.pos_sessions(id,tenant_id,branch_id,user_id,role,status,expires_at) values('f1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','f1000000-0000-4000-8000-000000000001','99999999-9999-4999-8999-999999999999','manager','active',now()+interval '1 hour');
insert into public.shifts(id,tenant_id,branch_id,status,opening_cash,opened_at,closed_at,metadata)
values('f1000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','f1000000-0000-4000-8000-000000000001','closed',1000,date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'-interval '2 days',date_trunc('day',now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'-interval '1 day','{"business_shift_mode":"recycling_daily"}');
do $test$
declare s uuid:='f1000000-0000-4000-8000-000000000003'; a uuid:='f1000000-0000-4000-8000-000000000002'; v timestamptz; op timestamptz; cl timestamptz;
begin
 select updated_at,opened_at,closed_at into v,op,cl from public.shifts where id=s;
 if has_function_privilege('authenticated','public.recycling_manage_closed_shift_v1(uuid,uuid,text,timestamptz,text,timestamptz,timestamptz,numeric,numeric)','execute') then raise exception 'PUBLIC_EXECUTE'; end if;
 begin
  perform public.recycling_manage_closed_shift_v1(a,s,'edit',v-interval '1 second','Synthetic stale test',op,cl,1200,1200);
  raise exception 'STALE_ACCEPTED';
 exception when others then if sqlerrm not like '%shift_history_conflict%' then raise; end if; end;
 perform public.recycling_manage_closed_shift_v1(a,s,'edit',v,'Synthetic recount',op,cl,1200.25,1200.25);
 if not exists(select 1 from public.shifts where id=s and opening_cash=1200.25 and expected_cash=1200.25 and actual_cash=1200.25) then raise exception 'EDIT_FAILED'; end if;
 if not exists(select 1 from public.audit_logs where target_id=s and action='recycling_shift_history_edit' and before_data->>'opening_cash'='1000') then raise exception 'AUDIT_MISSING'; end if;
 select updated_at into v from public.shifts where id=s;
 insert into public.orders(id,tenant_id,branch_id,shift_id) values('f1000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','f1000000-0000-4000-8000-000000000001',s);
 begin
  perform public.recycling_manage_closed_shift_v1(a,s,'delete',v,'Synthetic blocked removal',null,null,null,null);
  raise exception 'LINKED_DELETE_ACCEPTED';
 exception when others then if sqlerrm not like '%shift_history_dependencies%' then raise; end if; end;
 delete from public.orders where id='f1000000-0000-4000-8000-000000000004';
 perform public.recycling_manage_closed_shift_v1(a,s,'delete',v,'Synthetic empty test shift',null,null,null,null);
 if exists(select 1 from public.shifts where id=s) or not exists(select 1 from public.audit_logs where target_id=s and action='recycling_shift_history_delete') then raise exception 'DELETE_OR_AUDIT_FAILED'; end if;
 raise notice 'PASS: closed shift correction, stale conflict, dependency protection, audit and empty deletion';
end;
$test$;
rollback;
