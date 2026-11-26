-- Disposable PostgreSQL only. Roll back synthetic rows and role changes.
begin;
do $test$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 s uuid:='99999999-9999-4999-8999-999999999997';
 p uuid:='55555555-5555-4555-8555-555555555555';
 tx uuid;
 result jsonb;
 prior_qty numeric;
 prior_cost bigint;
 prior_marker uuid;
 after_qty numeric;
 after_cost bigint;
 after_marker uuid;
 role_name text;
begin
 insert into public.shifts(id,tenant_id,branch_id,opening_cash,status)
 values(s,t,b,500,'open');
 select quantity_base,carrying_cost_minor,last_transaction_id
 into prior_qty,prior_cost,prior_marker from public.recycling_stock_balances
 where tenant_id=t and branch_id=b and product_id=p;
 foreach role_name in array array['owner','manager'] loop
   -- Change only the synthetic fixture's branch role.
   update public.user_branch_roles set role=role_name
   where tenant_id=t and branch_id=b and user_id=u;
   result:=public.recycling_post_transaction(t,b,s,u,gen_random_uuid(),
     'buy','credit','Synthetic supervisor purchase',
     jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1,'unit','kg','expected_price',8.25)));
   tx:=(result->>'id')::uuid;
   result:=public.recycling_void_unposted_transaction(t,b,tx,u,gen_random_uuid(),
     'Supervisor directly corrects own synthetic receipt',true,false);
   if result->>'status'<>'voided' then raise exception 'UAT_SUPERVISOR_SELF_VOID_FAILED'; end if;
   select quantity_base,carrying_cost_minor,last_transaction_id
   into after_qty,after_cost,after_marker from public.recycling_stock_balances
   where tenant_id=t and branch_id=b and product_id=p;
   if after_qty is distinct from prior_qty or after_cost is distinct from prior_cost
     or after_marker is distinct from prior_marker then raise exception 'UAT_SUPERVISOR_STOCK_NOT_RESTORED'; end if;
   if not exists(select 1 from public.recycling_transactions where id=tx and status='voided'
       and voided_by=u and length(void_reason)>=10) then raise exception 'UAT_SUPERVISOR_AUDIT_MISSING'; end if;
 end loop;
 update public.user_branch_roles set role='staff' where tenant_id=t and branch_id=b and user_id=u;
 result:=public.recycling_post_transaction(t,b,s,u,gen_random_uuid(),
   'buy','credit','Synthetic staff purchase',
   jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1,'unit','kg','expected_price',8.25)));
 tx:=(result->>'id')::uuid;
 begin
   perform public.recycling_void_unposted_transaction(t,b,tx,u,gen_random_uuid(),
     'Staff is not authorized to self void',true,false);
   raise exception 'UAT_STAFF_SELF_VOID_NOT_DENIED';
 exception when others then
   if position('recycling_void_self_approval_forbidden' in sqlerrm)=0 then raise; end if;
 end;
 raise notice 'RECYCLING_SUPERVISOR_VOID_CANDIDATE_OK';
end;
$test$;
rollback;
