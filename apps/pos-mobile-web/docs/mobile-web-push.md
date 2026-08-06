# Mobile Web Push

ระบบ Web Push ใช้สำหรับแจ้งเตือนมือถือแม้ผู้ใช้ปิดหน้าแอปอยู่ โดยมีส่วนประกอบหลักดังนี้:

1. Vercel env
   - `WEB_PUSH_PUBLIC_KEY`
   - `WEB_PUSH_PRIVATE_KEY`
   - `WEB_PUSH_SUBJECT`
   - `DEPLOY_NOTIFY_SECRET`

2. Supabase table

```sql
create table if not exists public.mobile_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  user_id uuid not null,
  device_id uuid,
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text,
  status text not null default 'active',
  last_seen_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mobile_push_subscriptions_scope_idx
  on public.mobile_push_subscriptions (tenant_id, branch_id, status);
```

3. การแจ้งเตือนหลัง deploy
   - GitHub Actions เรียก `/api/system/notifications/deploy` หลัง push เข้า `main`
   - endpoint นี้ต้องมี header `x-deploy-notify-secret`
   - ระบบจะส่ง push ไปยัง subscription ที่ยัง active ทั้งหมด

หมายเหตุ:
- Chrome บน Android รองรับ Web Push ดีที่สุด
- iOS ต้องติดตั้งเป็น PWA ก่อนจึงจะรับ notification ได้
- ผู้ใช้ต้องกดเปิดสิทธิ์แจ้งเตือนอย่างน้อยหนึ่งครั้งบนเครื่องนั้น
