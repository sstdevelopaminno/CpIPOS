create table if not exists public.pos_tax_recipients (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), branch_id uuid not null references public.branches(id), entity_type text not null check (entity_type in ('company','partnership','store','individual')), display_name text not null, tax_id text not null, address_line text not null, subdistrict text not null, district text not null, province text not null, postal_code text not null, is_active boolean not null default true, created_by uuid null, updated_by uuid null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists pos_tax_recipients_scope_idx on public.pos_tax_recipients(tenant_id,branch_id,is_active,updated_at desc);
create index if not exists pos_tax_recipients_tax_id_idx on public.pos_tax_recipients(tenant_id,branch_id,tax_id);
alter table public.pos_tax_recipients enable row level security;

create table if not exists public.pos_tax_invoices (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), branch_id uuid not null references public.branches(id), recipient_id uuid not null references public.pos_tax_recipients(id), order_id uuid not null references public.orders(id), invoice_no text not null, paper_width_mm integer not null default 80 check (paper_width_mm in (58,80)), status text not null default 'issued' check (status in ('issued','voided')), subtotal_before_vat numeric not null default 0, vat_rate_pct numeric not null default 0, vat_amount numeric not null default 0, total_amount numeric not null default 0, recipient_snapshot jsonb not null default '{}'::jsonb, receipt_snapshot jsonb not null default '{}'::jsonb, issued_by uuid null, issued_at timestamptz not null default now(), voided_by uuid null, voided_at timestamptz null, void_reason text null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists pos_tax_invoices_scope_no_uniq on public.pos_tax_invoices(tenant_id,branch_id,invoice_no);
create unique index if not exists pos_tax_invoices_scope_order_uniq on public.pos_tax_invoices(tenant_id,branch_id,order_id);
create index if not exists pos_tax_invoices_order_idx on public.pos_tax_invoices(tenant_id,branch_id,order_id);
create index if not exists pos_tax_invoices_recipient_idx on public.pos_tax_invoices(tenant_id,branch_id,recipient_id,issued_at desc);
alter table public.pos_tax_invoices enable row level security;
