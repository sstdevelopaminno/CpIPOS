-- Candidate only; isolated UAT. Internal inventory reclassification, no sales or VAT.
begin;
alter table public.finance_accounting_documents drop constraint finance_accounting_documents_document_kind_check;
alter table public.finance_accounting_documents add constraint finance_accounting_documents_document_kind_check check(document_kind in (
 'sales_quote','sales_order','delivery_note','sales_invoice','purchase_request','purchase_order','goods_receipt','supplier_bill',
 'expense_voucher','receipt_voucher','payment_voucher','other_income','bank_transfer','inventory_transfer'));
-- Explicitly configured accounts, never guessed. Same warehouse/transit accounts must be used throughout a transfer.
create table public.rw_finance_account_mapping (
 tenant_id uuid not null, warehouse_id uuid not null, branch_id uuid not null references public.branches(id),
 warehouse_account_id uuid not null, transit_account_id uuid not null, branch_account_id uuid not null,
 primary key(tenant_id,warehouse_id,branch_id),
 foreign key(tenant_id,warehouse_id) references public.rw_warehouses(tenant_id,id),
 foreign key(tenant_id,warehouse_account_id) references public.finance_accounting_chart(tenant_id,id),
 foreign key(tenant_id,transit_account_id) references public.finance_accounting_chart(tenant_id,id),
 foreign key(tenant_id,branch_account_id) references public.finance_accounting_chart(tenant_id,id),
 check(warehouse_account_id<>transit_account_id and transit_account_id<>branch_account_id and warehouse_account_id<>branch_account_id)
);
alter table public.rw_finance_account_mapping enable row level security;
revoke all on public.rw_finance_account_mapping from public,anon,authenticated,service_role;
grant select on public.rw_finance_account_mapping to service_role;
create function public.rw_post_transfer_gl_candidate(p_tenant uuid,p_branch uuid,p_actor uuid,p_ledger uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 l public.rw_warehouse_ledger%rowtype;
 h public.rw_warehouse_transfers%rowtype;
 m public.rw_finance_account_mapping%rowtype;
 old_doc public.finance_accounting_documents%rowtype;
 preparer uuid;
 debit_id uuid;
 credit_id uuid;
 journal_id_value uuid;
 doc_id uuid;
 amount bigint;
 accounting_day date;
 posting_key_value text;
begin
 if p_tenant is null or p_branch is null or p_actor is null or p_ledger is null then raise exception 'finance_accounting_invalid_command'; end if;
 perform public.finance_accounting_check_actor(p_tenant,p_branch,p_actor);
 if (select count(*) from public.tenant_subscription_contracts c where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now()))<>1
 or not exists(select 1 from public.tenant_subscription_contracts c join public.subscription_packages p on p.id=c.package_id
 where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now())
 and c.currency='THB' and lower(trim(p.code))='custom' and c.metadata->'sales_modes'->'retail_wholesale'='true'::jsonb
 and not exists(select 1 from unnest(array['takeaway','home','dine_in','buffet_table','delivery','optical_retail','recycling']) k where c.metadata->'sales_modes'->k='true'::jsonb))
 then raise exception 'finance_accounting_warehouse_entitlement_or_currency'; end if;
 select * into l from public.rw_warehouse_ledger where tenant_id=p_tenant and id=p_ledger;
 if not found or l.event not in ('dispatch','branch_receipt') then raise exception 'finance_accounting_warehouse_event_invalid'; end if;
 select * into h from public.rw_warehouse_transfers where tenant_id=p_tenant and id=l.transfer_id and destination_branch_id=p_branch for update;
 if not found then raise exception 'finance_accounting_warehouse_branch_invalid'; end if;
 select * into old_doc from public.finance_accounting_documents where tenant_id=p_tenant and branch_id=p_branch and request_key=p_ledger;
 if found then
  if old_doc.document_kind<>'inventory_transfer' or old_doc.request_snapshot->>'ledger_id' is distinct from p_ledger::text or old_doc.posted_journal_id is null
   then raise exception 'finance_accounting_warehouse_request_conflict'; end if;
  return jsonb_build_object('id',old_doc.posted_journal_id,'posted',false,'idempotent',true);
 end if;
 select actor_id into preparer from public.rw_warehouse_commands where tenant_id=p_tenant and request_id=l.request_id;
 if preparer is null or preparer=p_actor then raise exception 'finance_accounting_warehouse_separation_required'; end if;
 select * into m from public.rw_finance_account_mapping where tenant_id=p_tenant and warehouse_id=l.warehouse_id and branch_id=p_branch for share;
 if not found or (select count(*) from public.finance_accounting_chart where tenant_id=p_tenant and account_type='asset' and id in(m.warehouse_account_id,m.transit_account_id,m.branch_account_id))<>3
 then raise exception 'finance_accounting_warehouse_account_mapping_required'; end if;
 amount:=case l.event when 'dispatch' then l.transit_value_delta else l.branch_value_delta end;
 if amount<=0 or amount>99999999999999 then raise exception 'finance_accounting_warehouse_amount_invalid'; end if;
 if l.event='branch_receipt' and not exists(
   select 1 from public.rw_warehouse_ledger d join public.finance_accounting_documents f on f.tenant_id=d.tenant_id and f.request_key=d.id and f.branch_id=p_branch
   join public.finance_accounting_journal_lines j on j.tenant_id=f.tenant_id and j.branch_id=f.branch_id and j.journal_id=f.posted_journal_id and j.line_no=1
   where d.tenant_id=p_tenant and d.transfer_id=l.transfer_id and d.sku=l.sku and d.event='dispatch' and d.transit_value_delta>0
   and f.document_kind='inventory_transfer' and j.account_id=m.transit_account_id)
 then raise exception 'finance_accounting_warehouse_dispatch_gl_required'; end if;
 debit_id:=case l.event when 'dispatch' then m.transit_account_id else m.branch_account_id end;
 credit_id:=case l.event when 'dispatch' then m.warehouse_account_id else m.transit_account_id end;
 accounting_day:=(l.created_at at time zone 'Asia/Bangkok')::date;
 if exists(select 1 from public.finance_accounting_periods where tenant_id=p_tenant and branch_id=p_branch
  and period_month=date_trunc('month',accounting_day)::date and locked_at is not null) then raise exception 'finance_accounting_period_locked'; end if;
 posting_key_value:='rw-ledger/'||p_ledger::text;
 insert into public.finance_accounting_documents(tenant_id,branch_id,document_kind,document_no,counterparty_name,document_date,currency,amount_minor,
  tax_minor,status,request_key,request_snapshot,prepared_by,approved_by,approved_at,issued_at)
 values(p_tenant,p_branch,'inventory_transfer','RW-'||p_ledger::text,'Internal warehouse transfer',accounting_day,'THB',amount,0,'issued',p_ledger,
  jsonb_build_object('source','rw_warehouse','ledger_id',p_ledger,'transfer_id',l.transfer_id,'sku',l.sku,'event',l.event),
  preparer,p_actor,now(),now()) returning id into doc_id;
 insert into public.finance_accounting_document_lines(tenant_id,branch_id,document_id,line_no,description,quantity,unit_minor,line_minor)
 values(p_tenant,p_branch,doc_id,1,'Inventory carrying value: '||l.sku,1,amount,amount);
 insert into public.finance_accounting_journals(tenant_id,branch_id,document_id,posting_key,event_type,currency,accounting_date,debit_total_minor,credit_total_minor,posted_by)
 values(p_tenant,p_branch,doc_id,posting_key_value,'document_issued','THB',accounting_day,amount,amount,p_actor) returning id into journal_id_value;
 insert into public.finance_accounting_journal_lines(tenant_id,branch_id,journal_id,line_no,account_id,currency,debit_minor,credit_minor) values
 (p_tenant,p_branch,journal_id_value,1,debit_id,'THB',amount,0),(p_tenant,p_branch,journal_id_value,2,credit_id,'THB',0,amount);
 update public.finance_accounting_documents set posted_journal_id=journal_id_value,version=version+1,updated_at=now() where id=doc_id;
 insert into public.finance_accounting_document_events(tenant_id,branch_id,document_id,action,old_status,new_status,actor_user_id,event_payload)
 values(p_tenant,p_branch,doc_id,'posted','issued','issued',p_actor,jsonb_build_object('journalId',journal_id_value,'warehouseLedgerId',p_ledger));
 return jsonb_build_object('id',journal_id_value,'posted',true,'idempotent',false);
end $fn$;
revoke all on function public.rw_post_transfer_gl_candidate(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.rw_post_transfer_gl_candidate(uuid,uuid,uuid,uuid) to service_role;
commit;
