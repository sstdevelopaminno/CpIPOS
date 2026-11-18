\set ON_ERROR_STOP on
-- Standalone, disposable PostgreSQL 17 CI staging bootstrap.
-- Synthetic fixture schema only; no production connection or customer data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $roles$;
CREATE SCHEMA IF NOT EXISTS public;
CREATE TYPE public.branch_role AS ENUM ('owner','manager','cashier','accountant');
CREATE TABLE public.tenants(id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.branches(id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id), is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.users_profiles(id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.user_branch_roles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 branch_id uuid NOT NULL REFERENCES public.branches(id),
 user_id uuid NOT NULL REFERENCES public.users_profiles(id),
 role public.branch_role NOT NULL
);
