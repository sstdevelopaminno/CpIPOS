-- Disposable PostgreSQL candidate. No production migration.
-- Reversal is a separate immutable journal linked to the original document.
begin;
do $ddl$
declare c record;
begin
 for c in select conname from pg_constraint where conrelid='public.finance_accounting_journals'::regclass
   and contype='u' and pg_get_constraintdef(oid)='UNIQUE (tenant_id, branch_id, document_id)'
 loop execute format('alter table public.finance_accounting_journals drop constraint %I',c.conname); end loop;
 for c in select conname from pg_constraint where conrelid='public.finance_accounting_journals'::regclass
   and contype='c' and pg_get_constraintdef(oid) like '%event_type%document_issued%'
 loop execute format('alter table public.finance_accounting_journals drop constraint %I',c.conname); end loop;
end;
$ddl$;
alter table public.finance_accounting_journals add constraint recycling_journal_event_check check(event_type in ('document_issued','recycling_reversal'));
create unique index recycling_journal_one_original on public.finance_accounting_journals(tenant_id,branch_id,document_id) where event_type='document_issued';
create table public.recycling_gl_reversals(
 request_id uuid primary key, tenant_id uuid not null, branch_id uuid not null,
 transaction_id uuid not null, original_journal_id uuid not null unique, reversal_journal_id uuid not null unique,
 actor_id uuid not null, accounting_date date not null, reason text not null check(length(reason) between 10 and 500),
 recorded_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,branch_id,transaction_id) references public.recycling_transactions(tenant_id,branch_id,id),
 foreign key(tenant_id,branch_id,original_journal_id) references public.finance_accounting_journals(tenant_id,branch_id,id),
 foreign key(tenant_id,branch_id,reversal_journal_id) references public.finance_accounting_journals(tenant_id,branch_id,id)
);
alter table public.recycling_gl_reversals enable row level security;
revoke all on public.recycling_gl_reversals from public,anon,authenticated;
grant select,insert on public.recycling_gl_reversals to service_role;
create function public.recycling_stage_gl_reversal(
 p_tenant uuid,p_branch uuid,p_tx uuid,p_actor uuid,p_request uuid,p_day date,p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare tx public.recycling_transactions%rowtype; j public.finance_accounting_journals%rowtype;
 prev public.recycling_gl_reversals%rowtype; reversal uuid; deb bigint; cre bigint;
begin
 if p_request is null or p_day is null or p_day>(now() at time zone 'Asia/Bangkok')::date
 or length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'recycling_gl_reversal_invalid'; end if;
 if not exists(select 1 from public.user_branch_roles r join public.users_profiles u on u.id=r.user_id
 join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id join public.tenants t on t.id=r.tenant_id
 where r.tenant_id=p_tenant and r.branch_id=p_branch and r.user_id=p_actor and r.role::text in ('owner','manager','accountant')
 and u.is_active and b.is_active and t.is_active) then raise exception 'recycling_gl_reversal_forbidden'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('recycling-gl-reversal:'||p_request::text));
 select * into prev from public.recycling_gl_reversals where request_id=p_request;
 if found then
 if prev.tenant_id is distinct from p_tenant or prev.branch_id is distinct from p_branch or prev.transaction_id is distinct from p_tx or prev.actor_id is distinct from p_actor or prev.accounting_date is distinct from p_day or prev.reason is distinct from btrim(p_reason) then raise exception 'recycling_gl_reversal_conflict'; end if;
 return jsonb_build_object('journal_id',prev.reversal_journal_id,'idempotent',true);
 end if;
 select * into tx from public.recycling_transactions where id=p_tx and tenant_id=p_tenant and branch_id=p_branch for update;
 if not found or tx.finance_document_id is null or tx.status<>'posted' then raise exception 'recycling_gl_reversal_unavailable'; end if;
 select jj.* into j from public.finance_accounting_documents d join public.finance_accounting_journals jj
 on jj.id=d.posted_journal_id and jj.tenant_id=d.tenant_id and jj.branch_id=d.branch_id
 where d.id=tx.finance_document_id and d.tenant_id=p_tenant and d.branch_id=p_branch and d.request_snapshot->>'source'='recycling'
 and d.request_snapshot->>'recycling_transaction_id'=tx.id::text and jj.event_type='document_issued' for update of d;
 if not found then raise exception 'recycling_gl_reversal_original_missing'; end if;
 if p_day<j.accounting_date then raise exception 'recycling_gl_reversal_before_original'; end if;
 -- Explicit open period required; do not reopen a historical locked period.
 perform 1 from public.finance_accounting_periods where tenant_id=p_tenant and branch_id=p_branch and period_month=date_trunc('month',p_day)::date and locked_at is null for update;
 if not found then raise exception 'recycling_gl_reversal_period_unavailable'; end if;
 if exists(select 1 from public.recycling_gl_reversals where original_journal_id=j.id) then raise exception 'recycling_gl_reversal_already_done'; end if;
 select sum(debit_minor),sum(credit_minor) into deb,cre from public.finance_accounting_journal_lines where tenant_id=p_tenant and branch_id=p_branch and journal_id=j.id;
 if deb is distinct from j.debit_total_minor or cre is distinct from j.credit_total_minor or deb<>cre then raise exception 'recycling_gl_reversal_unbalanced'; end if;
 insert into public.finance_accounting_journals(tenant_id,branch_id,document_id,posting_key,event_type,currency,accounting_date,debit_total_minor,credit_total_minor,posted_by)
 values(p_tenant,p_branch,j.document_id,'recycling/reversal/'||p_request::text,'recycling_reversal',j.currency,p_day,cre,deb,p_actor) returning id into reversal;
 insert into public.finance_accounting_journal_lines(tenant_id,branch_id,journal_id,line_no,account_id,currency,debit_minor,credit_minor)
 select tenant_id,branch_id,reversal,line_no,account_id,currency,credit_minor,debit_minor from public.finance_accounting_journal_lines where tenant_id=p_tenant and branch_id=p_branch and journal_id=j.id;
 insert into public.recycling_gl_reversals(request_id,tenant_id,branch_id,transaction_id,original_journal_id,reversal_journal_id,actor_id,accounting_date,reason)
 values(p_request,p_tenant,p_branch,p_tx,j.id,reversal,p_actor,p_day,btrim(p_reason));
 return jsonb_build_object('journal_id',reversal,'original_journal_id',j.id,'idempotent',false);
end;
$fn$;
-- No service-role execution grant: this low-level candidate must later be called only inside the complete atomic correction workflow.
revoke all on function public.recycling_stage_gl_reversal(uuid,uuid,uuid,uuid,uuid,date,text) from public,anon,authenticated,service_role;
commit;
