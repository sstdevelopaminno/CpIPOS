-- Ephemeral GitHub Actions PostgreSQL 16 fixture, NOT copied production data.
-- Table shapes/constraints below mirror the subset verified in CpiPOS-001.
-- This tests SQL execution without ever connecting to a real Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create table public.tenants (
  id uuid primary key, name text not null, is_active boolean not null default true
);
create table public.branches (
  id uuid primary key, tenant_id uuid not null references public.tenants(id),
  name text not null, is_active boolean not null default true
);
create table public.users_profiles (
  id uuid primary key, is_active boolean not null default true
);
create table public.user_branch_roles (
  user_id uuid not null references public.users_profiles(id),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  role text not null,
  unique(user_id,tenant_id,branch_id)
);
create table public.subscription_packages (
  id uuid primary key, code text not null unique
);
create table public.tenant_subscription_contracts (
  id uuid primary key, tenant_id uuid not null references public.tenants(id),
  package_id uuid not null references public.subscription_packages(id),
  status text not null, metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz default now(), ended_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.tenant_data_lifecycle (
  tenant_id uuid primary key references public.tenants(id),
  lifecycle_status text not null,
  access_locked boolean not null default false,
  trial_expires_at timestamptz, subscription_expires_at timestamptz
);
create table public.shifts (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  opening_cash numeric,
  expected_cash numeric,
  actual_cash numeric,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  closing_cash numeric,
  metadata jsonb not null default '{}'::jsonb,
  status text not null check(status in ('open','closed'))
);
create table public.orders (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  shift_id uuid references public.shifts(id)
);
create table public.products (
  id uuid primary key, tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  sku text not null, name text not null, category text not null,
  price numeric not null, sell_unit text not null default 'unit',
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,deleted_at timestamptz,
  unique(tenant_id,branch_id,sku)
);
create table public.finance_accounting_chart (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  account_code text not null, account_name text not null,
  account_type text not null check(account_type in ('asset','liability','equity','income','expense')),
  created_by uuid not null references public.users_profiles(id),
  unique(tenant_id,account_code),unique(tenant_id,id)
);
create table public.finance_accounting_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  document_kind text not null check(document_kind in ('supplier_bill','sales_invoice')),
  document_no text not null, payment_method text,
  remarks text,
  counterparty_name text not null,
  document_date date not null, due_date date,
  currency text not null check(currency in ('THB','LAK','USD')),
  amount_minor bigint not null check(amount_minor>0),
  tax_minor bigint not null default 0 check(tax_minor=0),
  status text not null check(status in ('draft','submitted','approved','rejected','issued','voided')),
  source_document_id uuid,
  request_key uuid not null,
  request_snapshot jsonb not null,
  prepared_by uuid not null references public.users_profiles(id),
  approved_by uuid references public.users_profiles(id),
  approved_at timestamptz,
  issued_at timestamptz,
  posted_journal_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_pair check((approved_by is null and approved_at is null) or
    (approved_by is not null and approved_at is not null)),
  constraint finance_no_self_approve check(approved_by is null or approved_by<>prepared_by),
  unique(tenant_id,branch_id,document_kind,document_no),
  unique(tenant_id,branch_id,request_key),
  unique(tenant_id,branch_id,id)
);
create table public.finance_accounting_periods (
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  period_month date not null check(extract(day from period_month)=1),
  locked_at timestamptz, locked_by uuid references public.users_profiles(id),
  primary key (tenant_id,branch_id,period_month)
);
create table public.finance_accounting_document_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, branch_id uuid not null, document_id uuid not null,
  line_no int not null check(line_no between 1 and 100),
  description text not null check(length(btrim(description)) between 1 and 500),
  quantity numeric not null check(quantity>0),
  unit_minor bigint not null check(unit_minor>=0),
  line_minor bigint not null check(line_minor>0),
  foreign key(tenant_id,branch_id,document_id)
    references public.finance_accounting_documents(tenant_id,branch_id,id),
  unique(document_id,line_no)
);
create table public.finance_accounting_document_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, branch_id uuid not null, document_id uuid not null,
  action text not null check(action in ('created','submitted','approved','rejected','issued','voided','posted')),
  old_status text, new_status text not null,
  actor_user_id uuid not null references public.users_profiles(id),
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(tenant_id,branch_id,document_id)
    references public.finance_accounting_documents(tenant_id,branch_id,id)
);
create table public.finance_accounting_journals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  document_id uuid not null,
  posting_key text not null,
  event_type text not null check(event_type='document_issued'),
  currency text not null,
  accounting_date date not null,
  debit_total_minor bigint not null check(debit_total_minor>0),
  credit_total_minor bigint not null check(credit_total_minor>0),
  posted_by uuid not null references public.users_profiles(id),
  posted_at timestamptz not null default now(),
  check(debit_total_minor=credit_total_minor),
  foreign key(tenant_id,branch_id,document_id)
    references public.finance_accounting_documents(tenant_id,branch_id,id),
  unique(tenant_id,branch_id,document_id),
  unique(tenant_id,branch_id,posting_key),
  unique(tenant_id,branch_id,id)
);
alter table public.finance_accounting_documents
  add constraint finance_accounting_posted_journal_fk
  foreign key(tenant_id,branch_id,posted_journal_id)
    references public.finance_accounting_journals(tenant_id,branch_id,id);
create table public.finance_accounting_journal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, branch_id uuid not null, journal_id uuid not null,
  line_no integer not null check(line_no between 1 and 100),
  account_id uuid not null,
  currency text not null,
  debit_minor bigint not null default 0 check(debit_minor>=0),
  credit_minor bigint not null default 0 check(credit_minor>=0),
  check((debit_minor>0 and credit_minor=0) or (debit_minor=0 and credit_minor>0)),
  foreign key(tenant_id,branch_id,journal_id)
    references public.finance_accounting_journals(tenant_id,branch_id,id),
  foreign key(tenant_id,account_id)
    references public.finance_accounting_chart(tenant_id,id),
  unique(journal_id,line_no)
);

-- Keep the same actor policy as the current Finance production function.
create or replace function public.finance_accounting_check_actor(
  p_tenant uuid, p_branch uuid, p_actor uuid
) returns void language plpgsql security definer
set search_path to '' as $$
begin
  if not exists(
    select 1 from public.user_branch_roles r
      join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id
      join public.tenants t on t.id=r.tenant_id
      join public.users_profiles u on u.id=r.user_id
    where r.tenant_id=p_tenant and r.branch_id=p_branch and r.user_id=p_actor
      and r.role='accountant' and b.is_active and t.is_active and u.is_active
  ) then raise exception 'finance_accounting_actor_forbidden' using errcode='42501'; end if;
end;
$$;

insert into public.tenants(id,name) values
  ('11111111-1111-4111-8111-111111111111','Synthetic recycling test tenant');
insert into public.branches(id,tenant_id,name) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Staging');
insert into public.users_profiles(id,is_active) values
  ('33333333-3333-4333-8333-333333333333',true),
  ('44444444-4444-4444-8444-444444444444',true);
insert into public.user_branch_roles(user_id,tenant_id,branch_id,role) values
  ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222','staff'),
  ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222','accountant');
insert into public.subscription_packages(id,code) values
  ('77777777-7777-4777-8777-777777777777','custom');
insert into public.tenant_subscription_contracts
  (id,tenant_id,package_id,status,metadata,ended_at)
values
  ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
   '77777777-7777-4777-8777-777777777777','trial',
   '{"sales_modes":{"general_sale":true,"recycling":true}}'::jsonb,now()+interval '7 days');
insert into public.tenant_data_lifecycle
  (tenant_id,lifecycle_status,trial_expires_at)
values
  ('11111111-1111-4111-8111-111111111111','trial',now()+interval '7 days');
insert into public.shifts(id,tenant_id,branch_id,opening_cash,status) values
  ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222',100.00,'open');
insert into public.products
  (id,tenant_id,branch_id,sku,name,category,price,sell_unit,metadata)
values
  ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222','IRON001','เศษเหล็ก','โลหะ',10.00,'kg',
   '{"business_mode":"recycling","recycling_price_basis":"kg","recycling_buy_price":8.25}'::jsonb);
insert into public.finance_accounting_chart(tenant_id,account_code,account_name,account_type,created_by)
values
  ('11111111-1111-4111-8111-111111111111','1100','เงินสด','asset','44444444-4444-4444-8444-444444444444'),
  ('11111111-1111-4111-8111-111111111111','1110','ธนาคาร','asset','44444444-4444-4444-8444-444444444444'),
  ('11111111-1111-4111-8111-111111111111','1200','สินค้าคงเหลือ','asset','44444444-4444-4444-8444-444444444444'),
  ('11111111-1111-4111-8111-111111111111','1201','ลูกหนี้','asset','44444444-4444-4444-8444-444444444444'),
  ('11111111-1111-4111-8111-111111111111','2100','เจ้าหนี้','liability','44444444-4444-4444-8444-444444444444'),
  ('11111111-1111-4111-8111-111111111111','4100','รายได้ขาย','income','44444444-4444-4444-8444-444444444444'),
  ('11111111-1111-4111-8111-111111111111','5100','ต้นทุนขาย','expense','44444444-4444-4444-8444-444444444444');

-- A deliberately unrelated, non-Recycling shift. In production several
-- authenticated clients may have shift permissions but no access to the
-- private Recycling tables. The close trigger may not break these tenants.
insert into public.tenants(id,name) values
  ('aaaaaaaa-0000-4000-8000-000000000000','Synthetic unrelated POS tenant');
insert into public.branches(id,tenant_id,name) values
  ('bbbbbbbb-0000-4000-8000-000000000000',
   'aaaaaaaa-0000-4000-8000-000000000000','Standard POS branch');
insert into public.shifts(id,tenant_id,branch_id,opening_cash,status) values
  ('cccccccc-0000-4000-8000-000000000000',
   'aaaaaaaa-0000-4000-8000-000000000000',
   'bbbbbbbb-0000-4000-8000-000000000000',100,'open');
grant select,update on public.shifts to authenticated;

-- Stub only cron.job and scheduling to validate migration on disposable PG.
-- Real Supabase pg_cron is tested separately by production read-only verification.
create schema if not exists cron;
create table cron.job(jobid bigint generated always as identity primary key,
 jobname text not null unique,schedule text not null, command text not null);
create or replace function cron.schedule(p_name text,p_schedule text,p_command text)
returns bigint language sql as $$
 insert into cron.job(jobname,schedule,command) values (p_name,p_schedule,p_command)
 returning jobid;
$$;
create table public.pos_sessions(
 id uuid primary key,tenant_id uuid not null,branch_id uuid not null,
 shift_id uuid references public.shifts(id),status text not null default 'active'
);
create table public.table_bill_sessions(
 id uuid primary key,tenant_id uuid not null,branch_id uuid not null,
 status text not null
);
