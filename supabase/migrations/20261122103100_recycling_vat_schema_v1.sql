-- Additive, fail-closed Recycling VAT schema.
-- No historical transaction is backfilled, reassessed or relabelled.
-- Apply to production only after separate PostgreSQL UAT and accountant approval.
begin;
-- Production branches has PK(id), not UNIQUE(tenant_id,id).
-- This unique composite key enables a tenant-scoped FK without changing rows.
create unique index if not exists branches_tenant_id_id_vat_idx
  on public.branches(tenant_id,id);
create table public.recycling_vat_issuers (
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  tax_id text not null check (tax_id ~ '^[0-9]{13}$'),
  legal_name text not null check(length(btrim(legal_name)) between 2 and 240),
  legal_address text not null check(length(btrim(legal_address)) between 5 and 1000),
  branch_no text not null check(branch_no ~ '^[0-9]{5}$'),
  evidence_reference text not null check(length(btrim(evidence_reference)) between 5 and 500),
  verified_by uuid not null references public.users_profiles(id),
  verified_at timestamptz not null,
  verified_from date not null,
  verified_until date,
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(tenant_id,branch_id),
  foreign key(tenant_id,branch_id) references public.branches(tenant_id,id),
  check(verified_until is null or verified_until >= verified_from)
);
alter table public.recycling_vat_issuers enable row level security;
revoke all on public.recycling_vat_issuers from public,anon,authenticated;
grant select,insert,update on public.recycling_vat_issuers to service_role;
-- A tenant tax toggle cannot activate VAT issuance. A verified registration
-- and evidence reference are required. No automatic issuer row is generated.

alter table public.recycling_transactions
  add column base_minor bigint,
  add column vat_minor bigint,
  add column tax_state text,
  add column tax_snapshot jsonb;
alter table public.recycling_transactions
  add constraint recycling_vat_immutable_shape check(
    (base_minor is null and vat_minor is null and tax_state is null and tax_snapshot is null)
    or (base_minor>0 and vat_minor>=0 and total_minor=base_minor+vat_minor
        and tax_state in ('no_vat','vat_recorded') and tax_snapshot is not null
        and (tax_state='vat_recorded' or vat_minor=0))
  );
alter table public.recycling_accounting_entries
  drop constraint recycling_accounting_entries_account_code_check;
alter table public.recycling_accounting_entries
  add constraint recycling_accounting_entries_account_code_check
  check(account_code in ('1100','1110','1200','1201','2100','2200','4100','5100'));
alter table public.finance_accounting_documents
  drop constraint finance_accounting_documents_tax_minor_check;
alter table public.finance_accounting_documents
  add constraint finance_accounting_documents_tax_minor_check
  check(tax_minor=0 or (
    tax_minor>0 and tax_minor<=amount_minor
    and request_snapshot->>'source'='recycling'
    and request_snapshot->>'tax_state'='vat_recorded'
  ));

create table public.recycling_tax_invoice_sequences (
  tenant_id uuid primary key references public.tenants(id),
  last_value bigint not null default 0 check(last_value>=0)
);
alter table public.recycling_tax_invoice_sequences enable row level security;
revoke all on public.recycling_tax_invoice_sequences from public,anon,authenticated;
grant select,insert,update on public.recycling_tax_invoice_sequences to service_role;

create table public.recycling_tax_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  transaction_id uuid not null unique references public.recycling_transactions(id),
  profile_id uuid not null references public.pos_tax_invoice_profiles(id),
  invoice_no text not null check(length(invoice_no) between 8 and 90),
  issued_by uuid not null references public.users_profiles(id),
  issued_at timestamptz not null default now(),
  seller_snapshot jsonb not null,
  buyer_snapshot jsonb not null,
  items_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  print_count integer not null default 0 check(print_count>=0),
  last_printed_at timestamptz,
  status text not null default 'issued' check(status='issued'),
  unique(tenant_id,invoice_no),
  foreign key(tenant_id,branch_id,transaction_id)
     references public.recycling_transactions(tenant_id,branch_id,id)
);
create index recycling_tax_invoices_branch_lookup
  on public.recycling_tax_invoices(tenant_id,branch_id,issued_at desc);
alter table public.recycling_tax_invoices enable row level security;
revoke all on public.recycling_tax_invoices from public,anon,authenticated;
grant select,insert,update on public.recycling_tax_invoices to service_role;

-- Posted tax basis cannot change on VOID, Finance approval or reprint.
-- Once a VAT invoice is issued, changing the sale requires a credit-note
-- workflow, not deleting or silently voiding the original document.
create or replace function public.recycling_guard_issued_tax_invoice_void()
returns trigger language plpgsql security invoker set search_path='' as $guard$
begin
  if new.status='voided' and old.status<>'voided'
    and exists(select 1 from public.recycling_tax_invoices
      where transaction_id=old.id and tenant_id=old.tenant_id and branch_id=old.branch_id) then
    raise exception 'recycling_tax_invoice_requires_credit_note_before_void';
  end if;
  if old.base_minor is distinct from new.base_minor
     or old.vat_minor is distinct from new.vat_minor
     or old.tax_state is distinct from new.tax_state
     or old.tax_snapshot is distinct from new.tax_snapshot then
    -- The v2 posting RPC creates a placeholder and finalizes its immutable
    -- tax snapshot within the SAME transaction. Historical documents cannot
    -- acquire a new VAT snapshot on a later date / transaction.
    if not (old.base_minor is null and old.vat_minor is null
       and old.tax_snapshot is null and old.tax_state is null
       and old.created_at=transaction_timestamp()
       and old.finance_document_id is null
       and old.status='posted' and new.status='posted'
       and new.base_minor is not null and new.vat_minor is not null) then
      raise exception 'recycling_tax_snapshot_immutable';
    end if;
  end if;
  return new;
end;
$guard$;
create trigger recycling_guard_tax_snapshot_and_invoice
before update on public.recycling_transactions
for each row execute function public.recycling_guard_issued_tax_invoice_void();
commit;
