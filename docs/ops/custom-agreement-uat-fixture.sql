-- Isolated synthetic schema for GitHub Actions PostgreSQL only.
-- Never run this file on CpiPOS-001 or on any database with customer data.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema app;
create table public.tenants(id uuid primary key,name text,display_name text,company_address text,is_active boolean,primary_owner_user_id uuid);
create table public.subscription_packages(id uuid primary key,code text);
create table public.tenant_subscription_payment_requests(
 id uuid primary key,tenant_id uuid not null,requested_package_id uuid,status text,evidence_url text,amount_reported numeric,currency text,metadata jsonb
);
create table public.tenant_subscription_settlements(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,payment_request_id uuid not null,package_id uuid,billing_interval text,
 amount_received numeric,currency text,bank_received_at timestamptz
);
create table public.tenant_data_lifecycle(tenant_id uuid,lifecycle_status text,metadata jsonb);
create table public.it_communication_settings(id text primary key,billing_legal_name_th text,billing_registration_no text,billing_registered_address text);
create table public.line_support_bindings(id uuid primary key,tenant_id uuid,is_active boolean,verified_owner_user_id uuid);
grant usage on schema public,app to service_role;
grant select,insert,update on all tables in schema public to service_role;
