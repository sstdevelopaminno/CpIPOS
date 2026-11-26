-- Extra synthetic fixture columns; never use in Production.
alter table public.shifts add column if not exists updated_at timestamptz not null default now();
alter table public.shifts add column if not exists close_override_approval_id uuid;
alter table public.audit_logs add column if not exists before_data jsonb;
alter table public.audit_logs add column if not exists after_data jsonb;
alter table public.cash_drawer_events add column if not exists print_job_id uuid;
create table if not exists public.print_jobs(id uuid primary key,tenant_id uuid,branch_id uuid,status text,metadata jsonb,payload_json jsonb,claimed_at timestamptz,printed_at timestamptz);
create table if not exists public.print_job_attempts(id uuid primary key,print_job_id uuid);
