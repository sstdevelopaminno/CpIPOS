-- Synthetic QA, use only isolated Postgres17 service in GitHub CI.
\set ON_ERROR_STOP on
alter table public.branches add column is_active boolean not null default true;
alter table public.products add column metadata jsonb not null default '{}'::jsonb;
alter table public.products add column sell_unit text not null default 'ชิ้น';
create table public.tenant_pos_menu_policies(
 tenant_id uuid not null,menu_key text not null,is_enabled boolean not null,
 primary key(tenant_id,menu_key));
create table public.tenant_feature_subscriptions(
 tenant_id uuid not null,branch_id uuid,feature_code text not null,is_enabled boolean not null);
create table public.orders(
 id uuid primary key,tenant_id uuid not null,branch_id uuid not null,status text not null);
alter table public.order_items add column order_id uuid;
create table public.audit_logs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,
 actor_user_id uuid not null,actor_role text not null,action text not null,
 target_table text not null,target_id uuid,metadata jsonb not null default '{}'::jsonb);
update public.products set metadata='{"business_mode":"optical_retail","optical_kind":"frame","currency_code":"LAK","optical_brand":"Synthetic","optical_model":"MODEL","optical_frame_size":"53"}'::jsonb
 where sku='OPT-FRAME-001';
insert into public.tenant_pos_menu_policies(tenant_id,menu_key,is_enabled) values
('00000000-0000-4000-8000-000000000001','more.stock',true);
-- Run the new migration ONLY against the local scratch database.
\ir ../../supabase/migrations/20261019211500_optical_stock_adjustment_audit_v1.sql

-- Exercise the exact RPC with the authenticated owner. No production tokens.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',false);
select set_config('request.jwt.claim.role','authenticated',false);
do $$
declare v_before integer;v_after integer;v_available integer;v_duplicate boolean;
begin
 select r.before_quantity,r.after_quantity,r.available_quantity,r.duplicate_request
 into v_before,v_after,v_available,v_duplicate
 from public.optical_adjust_stock_tx(
 '00000000-0000-4000-8000-000000000001'::uuid,
 '00000000-0000-4000-8000-000000000011'::uuid,
 '00000000-0000-4000-8000-000000000101'::uuid,
 'OPT-FRAME-001',5,'synthetic supplier receipt',
 '00000000-0000-4000-8000-000000009001'::uuid,'crm') r;
 if (v_before,v_after,v_available,v_duplicate) is distinct from (0,5,5,false)
 then raise exception 'receipt count invalid: % % % %',v_before,v_after,v_available,v_duplicate;end if;
 -- A network retry must return the prior result, without another stock movement.
 select r.after_quantity,r.duplicate_request into v_after,v_duplicate
 from public.optical_adjust_stock_tx(
 '00000000-0000-4000-8000-000000000001'::uuid,
 '00000000-0000-4000-8000-000000000011'::uuid,
 '00000000-0000-4000-8000-000000000101'::uuid,
 'OPT-FRAME-001',5,'synthetic supplier receipt',
 '00000000-0000-4000-8000-000000009001'::uuid,'crm') r;
 if v_after<>5 or v_duplicate is distinct from true then raise exception 'replayed request changed stock';end if;
 begin
  perform * from public.optical_adjust_stock_tx(
   '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000011'::uuid,
   '00000000-0000-4000-8000-000000000101'::uuid,
   'OPT-FRAME-001',-1,'synthetic supplier receipt',
   '00000000-0000-4000-8000-000000009001'::uuid,'crm');
  raise exception 'idempotency conflict was permitted';
 exception when others then
  if sqlerrm='idempotency conflict was permitted' then raise;end if;
  if position('OPTICAL_STOCK_IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise;end if;
 end;
 select r.after_quantity into v_after
 from public.optical_adjust_stock_tx(
 '00000000-0000-4000-8000-000000000001'::uuid,
 '00000000-0000-4000-8000-000000000011'::uuid,
 '00000000-0000-4000-8000-000000000101'::uuid,
 'OPT-FRAME-001',-2,'synthetic physical issue',
 '00000000-0000-4000-8000-000000009002'::uuid,'crm') r;
 if v_after<>3 then raise exception 'manual issue not decremented correctly';end if;
 update public.optical_stock_bins set reserved=2 where tenant_id='00000000-0000-4000-8000-000000000001';
 begin
  perform * from public.optical_adjust_stock_tx(
   '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000011'::uuid,
   '00000000-0000-4000-8000-000000000101'::uuid,
   'OPT-FRAME-001',-2,'synthetic unsafe issue',
   '00000000-0000-4000-8000-000000009003'::uuid,'crm');
  raise exception 'reserved stock was issued';
 exception when others then
  if sqlerrm='reserved stock was issued' then raise;end if;
  if position('OPTICAL_STOCK_INSUFFICIENT_UNRESERVED' in sqlerrm)=0 then raise;end if;
 end;
 if (select on_hand from public.optical_stock_bins limit 1)<>3 then raise exception 'balance drift'; end if;
 if (select count(*) from public.optical_stock_adjustments)<>2 then raise exception 'ledger not idempotent';end if;
 if (select count(*) from public.audit_logs where action='optical_stock_manual_adjustment')<>2
 then raise exception 'audited events are missing';end if;
 begin
  perform * from public.optical_adjust_stock_tx(
   '00000000-0000-4000-8000-000000000002'::uuid,
   '00000000-0000-4000-8000-000000000022'::uuid,
   '00000000-0000-4000-8000-000000000101'::uuid,
   'FOOD-001',1,'unsafe cross tenant',
   '00000000-0000-4000-8000-000000009004'::uuid,'crm');
  raise exception 'cross tenant grant permitted';
 exception when others then
  if sqlerrm='cross tenant grant permitted' then raise;end if;
  if position('OPTICAL_STOCK_SCOPE_FORBIDDEN' in sqlerrm)=0 then raise;end if;
 end;
end $$;
select 'optical_receive_issue_scratch_passed' as result;
