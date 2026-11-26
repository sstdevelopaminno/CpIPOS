-- Disposable UAT only: one correction of a single-line CREDIT receipt and
-- its subsequent stock chain. No cash/bank or production RPC grant.
begin;
alter table public.finance_accounting_journals drop constraint recycling_journal_event_check;
alter table public.finance_accounting_journals add constraint recycling_journal_event_check check(event_type in ('document_issued','recycling_reversal','recycling_corrected','recycling_cogs_adjustment'));
create table public.recycling_historical_corrections(
 request_id uuid primary key,tenant_id uuid not null,branch_id uuid not null,transaction_id uuid not null,
 product_id uuid not null,actor_id uuid not null,payload jsonb not null,result jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,branch_id,product_id),
 foreign key(tenant_id,branch_id,transaction_id) references public.recycling_transactions(tenant_id,branch_id,id)
);
create table public.recycling_tax_adjustment_notes(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,branch_id uuid not null,
 invoice_id uuid not null references public.recycling_tax_invoices(id),
 request_id uuid not null unique,note_no text not null,kind text not null check(kind in ('credit_note','debit_note')),
 issued_at timestamptz not null default clock_timestamp(),issued_by uuid not null,reason text not null,evidence_reference text not null,
 original_invoice_no text not null,seller_snapshot jsonb not null,buyer_snapshot jsonb not null,amount_snapshot jsonb not null,
 unique(tenant_id,note_no)
);
create table public.recycling_tax_note_sequences(tenant_id uuid primary key,last_value bigint not null check(last_value>0));
alter table public.recycling_historical_corrections enable row level security;
alter table public.recycling_tax_adjustment_notes enable row level security;
alter table public.recycling_tax_note_sequences enable row level security;
revoke all on public.recycling_historical_corrections,public.recycling_tax_adjustment_notes,public.recycling_tax_note_sequences from public,anon,authenticated,service_role;
-- Append signed account deltas as a balanced immutable journal, never overwrite GL.
create function public.recycling_append_adjustment_journal(p_tenant uuid,p_branch uuid,p_doc uuid,p_actor uuid,p_day date,p_key text,p_event text,p_entries jsonb)
returns uuid language plpgsql security invoker set search_path='' as $fn$
declare j uuid; d bigint; c bigint; e record; account uuid; n int:=0;
begin
 select coalesce(sum(greatest(v,0)),0),coalesce(sum(greatest(-v,0)),0) into d,c
 from (select sum((x->>'net')::bigint) v from jsonb_array_elements(p_entries) x group by x->>'code') s;
 if d<>c or d<=0 then raise exception 'recycling_adjustment_unbalanced'; end if;
 insert into public.finance_accounting_journals(tenant_id,branch_id,document_id,posting_key,event_type,currency,accounting_date,debit_total_minor,credit_total_minor,posted_by)
 values(p_tenant,p_branch,p_doc,p_key,p_event,'THB',p_day,d,c,p_actor) returning id into j;
 for e in select x->>'code' code,sum((x->>'net')::bigint) net from jsonb_array_elements(p_entries) x group by x->>'code' having sum((x->>'net')::bigint)<>0 order by 1 loop
  select id into account from public.finance_accounting_chart where tenant_id=p_tenant and account_code=e.code;
  if not found then raise exception 'recycling_adjustment_account_missing'; end if;
  n:=n+1;
  insert into public.finance_accounting_journal_lines(tenant_id,branch_id,journal_id,line_no,account_id,currency,debit_minor,credit_minor)
  values(p_tenant,p_branch,j,n,account,'THB',greatest(e.net,0),greatest(-e.net,0));
 end loop;
 return j;
end;
$fn$;
revoke all on function public.recycling_append_adjustment_journal(uuid,uuid,uuid,uuid,date,text,text,jsonb) from public,anon,authenticated,service_role;
create function public.recycling_apply_historical_credit_correction(
 p_tenant uuid,p_branch uuid,p_tx uuid,p_actor uuid,p_request uuid,p_expected_total bigint,
 p_new_qty numeric,p_new_price numeric,p_reason text,p_evidence text,p_stock_verified boolean
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare tx public.recycling_transactions%rowtype; l public.recycling_transaction_lines%rowtype;
 prior public.recycling_historical_corrections%rowtype; inv public.recycling_tax_invoices%rowtype;
 doc public.finance_accounting_documents%rowtype; issuer public.recycling_vat_issuers%rowtype;
 payload jsonb; replay jsonb; vat jsonb; reversal jsonb; outcome jsonb; entries jsonb; adjustments jsonb:='[]';
 day date:=(clock_timestamp() at time zone 'Asia/Bangkok')::date; base bigint; tax bigint:=0; gross bigint; cogs bigint:=0;
 note uuid; seq bigint; j uuid; item record; other public.recycling_transactions%rowtype; delta bigint;
begin
 if p_request is null or p_expected_total is null or p_new_qty is null or p_new_price is null or p_new_qty<=0 or p_new_qty>100000000 or p_new_price<=0 or p_new_price>99999999 or p_new_price<>round(p_new_price,2)
 or p_stock_verified is distinct from true or length(btrim(coalesce(p_reason,''))) not between 10 and 500 or length(btrim(coalesce(p_evidence,''))) not between 5 and 500 then raise exception 'recycling_historical_invalid'; end if;
 if not exists(select 1 from public.user_branch_roles r join public.users_profiles u on u.id=r.user_id join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id join public.tenants t on t.id=r.tenant_id where r.tenant_id=p_tenant and r.branch_id=p_branch and r.user_id=p_actor and r.role::text in ('owner','manager','accountant') and u.is_active and b.is_active and t.is_active) then raise exception 'recycling_historical_forbidden'; end if;
 payload:=jsonb_build_object('expected_total',p_expected_total,'qty',p_new_qty,'price',p_new_price,'reason',btrim(p_reason),'evidence',btrim(p_evidence),'stock_verified',true);
 perform pg_advisory_xact_lock(hashtext('recycling-historical:'||p_request::text));
 select * into prior from public.recycling_historical_corrections where request_id=p_request;
 if found then
  if prior.tenant_id is distinct from p_tenant or prior.branch_id is distinct from p_branch or prior.transaction_id is distinct from p_tx or prior.actor_id is distinct from p_actor or prior.payload is distinct from payload then raise exception 'recycling_historical_conflict'; end if;
  return prior.result||jsonb_build_object('idempotent',true);
 end if;
 select * into tx from public.recycling_transactions where tenant_id=p_tenant and branch_id=p_branch and id=p_tx for update;
 if not found or tx.status<>'posted' or tx.settlement<>'credit' or tx.finance_document_id is null or tx.total_minor is distinct from p_expected_total or tx.tax_state is null then raise exception 'recycling_historical_unsupported'; end if;
 if (select count(*) from public.recycling_transaction_lines where tenant_id=p_tenant and branch_id=p_branch and transaction_id=p_tx)<>1 then raise exception 'recycling_historical_single_line_required'; end if;
 select * into strict l from public.recycling_transaction_lines where tenant_id=p_tenant and branch_id=p_branch and transaction_id=p_tx;
 -- Lock current stock before replay; regular postings also lock this balance.
 perform 1 from public.recycling_stock_balances where tenant_id=p_tenant and branch_id=p_branch and product_id=l.product_id for update;
 if not found then raise exception 'recycling_historical_stock_missing'; end if;
 if exists(select 1 from public.recycling_historical_corrections where tenant_id=p_tenant and branch_id=p_branch and product_id=l.product_id) then raise exception 'recycling_historical_repeat_requires_effective_chain'; end if;
 select * into strict doc from public.finance_accounting_documents where tenant_id=p_tenant and branch_id=p_branch and id=tx.finance_document_id for update;
 if doc.currency<>'THB' or doc.status<>'issued' or doc.posted_journal_id is null then raise exception 'recycling_historical_document_invalid'; end if;
 -- An allocated credit document needs a separate AR/AP settlement workflow.
 if to_regclass('public.finance_accounting_allocations') is not null then
  execute 'select count(*) from public.finance_accounting_allocations where tenant_id=$1 and branch_id=$2 and source_document_id=$3' into delta using p_tenant,p_branch,doc.id;
  if delta<>0 then raise exception 'recycling_historical_allocated_credit'; end if;
 end if;
 base:=round(p_new_qty*p_new_price*100)::bigint;
 if base<=0 or base>99999999999999 then raise exception 'recycling_historical_invalid'; end if;
 replay:=public.recycling_preview_stock_replay(p_tenant,p_branch,p_actor,l.product_id,l.id,p_new_qty,base);
 if tx.direction='sell' then
  select (x->>'new_cogs_minor')::bigint into strict cogs from jsonb_array_elements(replay->'affected_sales') x where x->>'line_id'=l.id::text;
 end if;
 select * into inv from public.recycling_tax_invoices where tenant_id=p_tenant and branch_id=p_branch and transaction_id=p_tx;
 if tx.tax_state='vat_recorded' then
  if tx.direction<>'sell' or inv.id is null then raise exception 'recycling_historical_invoice_required'; end if;
  select * into issuer from public.recycling_vat_issuers where tenant_id=p_tenant and branch_id=p_branch and active and verified_at is not null and verified_from<=day and (verified_until is null or verified_until>=day) for share;
  if not found or issuer.tax_id is distinct from inv.seller_snapshot->>'tax_id' or issuer.branch_no is distinct from inv.seller_snapshot->>'branch_no' then raise exception 'recycling_historical_issuer_invalid'; end if;
  vat:=public.recycling_preview_issued_vat_adjustment(p_tenant,p_branch,inv.id,p_actor,base);
  tax:=(vat->>'new_vat_minor')::bigint;
 elsif inv.id is not null then raise exception 'recycling_historical_invoice_invalid'; end if;
 gross:=base+tax;
 if gross=tx.total_minor and p_new_qty=l.base_quantity then raise exception 'recycling_historical_no_change'; end if;
 -- The posting date is the actual correction date, not the old invoice date.
 reversal:=public.recycling_stage_gl_reversal(p_tenant,p_branch,p_tx,p_actor,p_request,day,p_reason);
 if tx.direction='buy' then
  entries:=jsonb_build_array(jsonb_build_object('code','1200','net',gross),jsonb_build_object('code','2100','net',-gross));
 else
  entries:=jsonb_build_array(jsonb_build_object('code','1201','net',gross),jsonb_build_object('code','4100','net',-base),jsonb_build_object('code','2200','net',-tax),jsonb_build_object('code','5100','net',cogs),jsonb_build_object('code','1200','net',-cogs));
 end if;
 j:=public.recycling_append_adjustment_journal(p_tenant,p_branch,doc.id,p_actor,day,'recycling/corrected/'||p_request::text,'recycling_corrected',entries);
 -- Subsequent sale COGS differences are separately balanced, with original journals retained.
 for item in select x->>'transaction_id' txid,sum((x->>'cogs_delta_minor')::bigint) delta from jsonb_array_elements(replay->'affected_sales') x where x->>'transaction_id'<>p_tx::text group by 1 having sum((x->>'cogs_delta_minor')::bigint)<>0 order by 1 loop
  select * into strict other from public.recycling_transactions where tenant_id=p_tenant and branch_id=p_branch and id=item.txid::uuid for update;
  if other.finance_document_id is null then raise exception 'recycling_historical_later_gl_required'; end if;
  adjustments:=adjustments||jsonb_build_array(jsonb_build_object('transaction_id',other.id,'delta_minor',item.delta,'journal_id',public.recycling_append_adjustment_journal(p_tenant,p_branch,other.finance_document_id,p_actor,day,'recycling/cogs/'||p_request::text||'/'||other.id::text,'recycling_cogs_adjustment',jsonb_build_array(jsonb_build_object('code','5100','net',item.delta),jsonb_build_object('code','1200','net',-item.delta)))));
 end loop;
 if vat is not null and vat->>'type'<>'none' then
  insert into public.recycling_tax_note_sequences(tenant_id,last_value) values(p_tenant,1) on conflict(tenant_id) do update set last_value=public.recycling_tax_note_sequences.last_value+1 returning last_value into seq;
  insert into public.recycling_tax_adjustment_notes(tenant_id,branch_id,invoice_id,request_id,note_no,kind,issued_by,reason,evidence_reference,original_invoice_no,seller_snapshot,buyer_snapshot,amount_snapshot)
  values(p_tenant,p_branch,inv.id,p_request,(case when vat->>'type'='credit_note' then 'RCN-' else 'RDN-' end)||lpad(seq::text,8,'0'),vat->>'type',p_actor,btrim(p_reason),btrim(p_evidence),inv.invoice_no,inv.seller_snapshot,inv.buyer_snapshot,vat-'draft_only') returning id into note;
 end if;
 update public.recycling_stock_balances set quantity_base=(replay->>'new_qty')::numeric,carrying_cost_minor=(replay->>'new_cost_minor')::bigint,updated_at=clock_timestamp()
 where tenant_id=p_tenant and branch_id=p_branch and product_id=l.product_id;
 outcome:=jsonb_build_object('applied',true,'idempotent',false,'original_id',p_tx,'new_total_minor',gross,'new_base_minor',base,'new_vat_minor',tax,'new_cogs_minor',cogs,'stock_replay',replay,'reversal_journal_id',reversal->>'journal_id','corrected_journal_id',j,'later_journals',adjustments,'tax_note_id',note);
 insert into public.recycling_historical_corrections(request_id,tenant_id,branch_id,transaction_id,product_id,actor_id,payload,result) values(p_request,p_tenant,p_branch,p_tx,l.product_id,p_actor,payload,outcome);
 return outcome;
end;
$fn$;
-- No externally callable write path until effective readers, replay chain and settlement integration are complete.
revoke all on function public.recycling_apply_historical_credit_correction(uuid,uuid,uuid,uuid,uuid,bigint,numeric,numeric,text,text,boolean) from public,anon,authenticated,service_role;
commit;
