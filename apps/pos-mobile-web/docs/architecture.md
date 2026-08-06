# Architecture

Separate Next.js App Router project with mobile PWA shell. Reuses SSTiPOS Supabase schema and runtime concepts: tenants, branches, users, roles, POS sessions, shifts, orders, inventory, attendance, audit logs and package feature gates.

Primary routes: login, sales, orders, shifts, stock, attendance, settings. `/dashboard` is a compatibility redirect only.
