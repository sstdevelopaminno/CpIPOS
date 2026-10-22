-- Immutable human-readable Optical bill and payment-receipt numbers.
-- Work-order/payment UUIDs remain internal foreign keys and barcode locators.
-- This migration never alters the posted financial ledger, cash, or stock.
create table if not exists public.optical_document_counters (
 tenant_id uuid not null,
 branch_id uuid not null,
 kind text not null check (kind in ('bill','receipt')),
 last_number bigint not null default 0 check (last_number>=0),
 primary key(tenant_id,branch_id,kind)
);
create table if not exists public.optical_document_numbers (
 tenant_id uuid not null,
 branch_id uuid not null,
 kind text not null check (kind in ('bill','receipt')),
 source_id uuid not null,
 document_number bigint not null check (document_number>0),
 created_at timestamptz not null default now(),
 primary key(kind,source_id),
 unique(tenant_id,branch_id,kind,document_number)
);
create index if not exists optical_document_numbers_scope
 on public.optical_document_numbers(tenant_id,branch_id,kind,source_id);
alter table public.optical_document_counters enable row level security;
alter table public.optical_document_numbers enable row level security;
revoke all on table public.optical_document_counters from anon,authenticated;
revoke all on table public.optical_document_numbers from anon,authenticated;
grant select on public.optical_document_numbers to service_role;
grant select,insert,update on public.optical_document_counters to service_role;
grant insert on public.optical_document_numbers to service_role;

create or replace function public.optical_allocate_document_number_v1(
 p_kind text,p_source_id uuid,p_tenant_id uuid,p_branch_id uuid
) returns bigint language plpgsql security definer
set search_path to pg_catalog,public,pg_temp
as $$
declare v_number bigint;
begin
 if p_kind not in('bill','receipt') or p_source_id is null or p_tenant_id is null or p_branch_id is null
 then raise exception 'invalid_optical_document_reference' using errcode='22023';end if;
 select document_number into v_number from public.optical_document_numbers
 where kind=p_kind and source_id=p_source_id and tenant_id=p_tenant_id and branch_id=p_branch_id;
 if v_number is not null then return v_number; end if;
 insert into public.optical_document_counters(tenant_id,branch_id,kind,last_number)
 values(p_tenant_id,p_branch_id,p_kind,1)
 on conflict(tenant_id,branch_id,kind)
 do update set last_number=public.optical_document_counters.last_number+1
 returning last_number into v_number;
 insert into public.optical_document_numbers(tenant_id,branch_id,kind,source_id,document_number)
 values(p_tenant_id,p_branch_id,p_kind,p_source_id,v_number)
 on conflict(kind,source_id) do nothing;
 select document_number into v_number from public.optical_document_numbers
 where kind=p_kind and source_id=p_source_id and tenant_id=p_tenant_id and branch_id=p_branch_id;
 if v_number is null then raise exception 'optical_doc_scope_mismatch'; end if;
 return v_number;
end;$$;
revoke all on function public.optical_allocate_document_number_v1(text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.optical_allocate_document_number_v1(text,uuid,uuid,uuid) to service_role;

create or replace function public.optical_assign_document_number_after_insert_v1()
returns trigger language plpgsql security definer
set search_path to pg_catalog,public,pg_temp as $$
begin
 perform public.optical_allocate_document_number_v1(
 case when TG_TABLE_NAME='optical_work_orders' then 'bill' else 'receipt' end,
 NEW.id,NEW.tenant_id,NEW.branch_id
 );
 return NEW;
end;$$;
drop trigger if exists optical_work_order_number_after_insert_v1 on public.optical_work_orders;
create trigger optical_work_order_number_after_insert_v1
 after insert on public.optical_work_orders
 for each row execute function public.optical_assign_document_number_after_insert_v1();
drop trigger if exists optical_payment_number_after_insert_v1 on public.optical_payment_ledger;
create trigger optical_payment_number_after_insert_v1
 after insert on public.optical_payment_ledger
 for each row execute function public.optical_assign_document_number_after_insert_v1();
do $$
declare r record;
begin
 for r in select id,tenant_id,branch_id from public.optical_work_orders
  order by tenant_id,branch_id,accepted_at,id loop
   perform public.optical_allocate_document_number_v1('bill',r.id,r.tenant_id,r.branch_id);
 end loop;
 for r in select id,tenant_id,branch_id from public.optical_payment_ledger
  order by tenant_id,branch_id,received_at,id loop
   perform public.optical_allocate_document_number_v1('receipt',r.id,r.tenant_id,r.branch_id);
 end loop;
end;$$;
