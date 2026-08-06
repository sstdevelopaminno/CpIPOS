# Shared Schema Consolidation Plan

วันที่ตรวจ: 2026-07-18

เอกสารนี้เป็นแผนรวมตารางที่มีหน้าที่ซ้ำหรือทับซ้อนกันระหว่าง `SSTiPOS` และ `SSTiPOSMobile` โดยตั้งใจย้ายทีละคู่แบบปลอดภัย ไม่ drop ตารางทันที และต้องตรวจ FK, API, component usage ก่อนทุกครั้ง

## หลักการย้าย

1. เลือก canonical table ให้ชัดเจนก่อนแก้โค้ด
2. เพิ่ม compatibility view/RPC หรือคอลัมน์ mapping ก่อน เพื่อให้ระบบเก่าอ่านได้ต่อ
3. ทำ dual read ก่อน dual write: อ่านจาก canonical ก่อน แล้ว fallback ตารางเก่า
4. backfill ข้อมูลและตรวจ row count/checksum
5. deprecate ด้วย comment, doc, และ warning ใน service layer
6. drop เฉพาะหลังผ่าน production observation อย่างน้อย 1 รอบ release และไม่มี FK/API/component usage เหลือ

## Snapshot จากฐานข้อมูล

| กลุ่ม | ตาราง | rows โดยประมาณ | FK ออก | FK เข้า | สถานะ |
| --- | ---: | ---: | ---: | ---: | --- |
| โต๊ะ | `dine_in_tables` | 0 | 2 | 0 | candidate deprecate |
| โต๊ะ | `dining_tables` | 4 | 3 | 4 | canonical |
| ผู้ใช้ | `pos_user_profiles` | 6 | 2 | 0 | extension profile |
| ผู้ใช้ | `users_profiles` | 8 | 1 | 53 | canonical identity |
| แพ็กเกจ | `plans` | 0 | 0 | 0 | legacy/unused candidate |
| แพ็กเกจ | `plan_features` | 0 | 0 | 0 | legacy/unused candidate |
| แพ็กเกจ | `tenant_contracts` | 0 | 0 | 0 | legacy/unused candidate |
| แพ็กเกจ | `subscription_packages` | 8 | 0 | 4 | canonical |
| แพ็กเกจ | `subscription_package_features` | 98 | 2 | 0 | canonical child |
| แพ็กเกจ | `tenant_subscription_contracts` | 6 | 2 | 0 | canonical contract |
| แพ็กเกจ | `tenant_billing_cycles` | 0 | 3 | 0 | keep for future billing |
| Session | `branch_device_shift_sessions` | 0 | 4 | 0 | candidate merge |
| Session | `mobile_device_sessions` | 0 | 4 | 0 | candidate merge/keep auth token lifecycle |
| Device | `device_enrollments` | 0 | 5 | 1 | canonical device enrollment |
| POS Session | `pos_sessions` | 0 | 6 | 4 | canonical runtime session |

## Pair 1: `dine_in_tables` -> `dining_tables`

Canonical: `dining_tables`

เหตุผล:
- `dining_tables` มี FK เข้าโดย `orders`, `table_bill_sessions`, `table_qr_orders`, `table_qr_sessions`
- มีข้อมูลจริงและรองรับ floor plan/status/zone มากกว่า
- ทั้ง Backoffice API และ Mobile table page ใช้ฝั่ง `dining_tables` แล้ว

Plan:
1. เพิ่ม view `public.dine_in_tables_compat` ที่ map จาก `dining_tables` เป็น shape เดิม เช่น `table_code`, `seats`, `is_active`
2. แก้ code/migration ใหม่ทั้งหมดไม่ให้อ้าง `dine_in_tables`
3. ถ้ามีระบบเก่ายังต้องอ่านชื่อเดิม ให้ใช้ view ชั่วคราวชื่อ `dine_in_tables` เฉพาะกรณีไม่มีตารางจริง หรือทำ API fallback แทน
4. รัน query ยืนยัน `dine_in_tables` เป็น 0 rows และไม่มี usage runtime
5. mark deprecated ด้วย comment ใน DB
6. drop หลังไม่มี usage 1 release

ห้ามทำทันที:
- ห้าม drop `dining_tables`
- ห้ามแก้ FK ของ `orders.table_id` ไปที่ table อื่น

## Pair 2: `pos_user_profiles` + `users_profiles`

Canonical identity: `users_profiles`

Extension: `pos_user_profiles`

เหตุผล:
- `users_profiles` มี FK เข้า 53 จุด เป็นตารางผู้ใช้หลักของระบบ
- `pos_user_profiles` มีข้อมูล 6 rows และเป็นข้อมูลเฉพาะ POS เช่น `employee_code`, `position_title`, `permission_role`
- ไม่ควรรวมคอลัมน์ POS เข้า `users_profiles` ทันที เพราะจะทำให้ identity table โตและผูก logic เฉพาะ POS มากเกินไป

Plan:
1. คง `users_profiles` เป็น source of truth ของผู้ใช้
2. คง `pos_user_profiles` เป็น one-to-one extension ด้วย unique `(tenant_id, user_id)`
3. เพิ่ม view `public.pos_users_v` สำหรับ API ที่ต้องใช้ข้อมูลรวม เช่น email/full_name + employee_code/role
4. ปรับ API/component ให้ query ผ่าน service เดียว ไม่ query สองตารางกระจาย
5. ตรวจ orphan:
   - `pos_user_profiles.user_id` ต้องมีใน `users_profiles.id`
   - `pos_user_profiles.tenant_id` ต้องมีใน `tenants.id`
6. ถ้าภายหลังต้องรวมจริง ให้ migrate เฉพาะคอลัมน์ที่ใช้บ่อยเข้า `users_profiles.metadata.pos` แทนเพิ่มคอลัมน์ตรง

ห้ามทำทันที:
- ห้าม drop `pos_user_profiles` เพราะมีข้อมูลจริงและ API POS users ใช้อยู่
- ห้ามเปลี่ยน FK ทั้งระบบออกจาก `users_profiles`

## Pair 3: legacy plan tables -> subscription package tables

Canonical:
- `subscription_packages`
- `subscription_package_features`
- `tenant_subscription_contracts`
- `tenant_billing_cycles`

Deprecate candidates:
- `plans`
- `plan_features`
- `tenant_contracts`

เหตุผล:
- legacy plan tables ไม่มีข้อมูลและไม่มี FK จาก metadata snapshot
- package tables มีข้อมูลจริงและถูกใช้โดย feature gate, IT admin contract, quote API
- `tenant_billing_cycles` ยังไม่มีข้อมูล แต่ควรเก็บเพราะเป็น future billing/audit ledger ไม่ใช่ duplicate ตรง ๆ

Plan:
1. สร้าง compatibility views:
   - `plans_compat` จาก `subscription_packages`
   - `plan_features_compat` จาก `subscription_package_features`
   - `tenant_contracts_compat` จาก `tenant_subscription_contracts`
2. แก้ service/API ที่ยังเรียก legacy ให้เปลี่ยนไป canonical
3. เพิ่ม DB comment ว่า legacy tables เป็น deprecated
4. ตรวจ `pg_stat_user_tables` และ code search ว่าไม่มี runtime write เข้า legacy
5. drop legacy หลังผ่าน release observation

Mapping:
- `plans.code/name/monthly_price/max_branches/max_devices/max_users/status` -> `subscription_packages`
- `plan_features.feature_key/enabled` -> `subscription_package_features.feature_code/included`
- `tenant_contracts.plan_id/start_date/end_date/status` -> `tenant_subscription_contracts.package_id/started_at/ended_at/status`

## Pair 4: `branch_device_shift_sessions` -> `pos_sessions`

Canonical: `pos_sessions`

เหตุผล:
- `pos_sessions` ถูกอ้างโดย `orders`, `payments`, `audit_logs`, `staff_attendance_events`
- `branch_device_shift_sessions` ยังไม่มีข้อมูลจริง แต่มี FK ออกไป `tenants`, `branches`, `device`, `users_profiles`
- Mobile shift API และ Backoffice shift/session APIs ใช้ concept เดียวกัน ควรรวม runtime session ให้จบที่ `pos_sessions`

Plan:
1. เพิ่มคอลัมน์ที่ขาดใน `pos_sessions` ถ้าจำเป็น เช่น `session_mode`, `metadata.mobile`
2. แก้ Mobile `/api/mobile/shifts` ให้อ่าน/เขียน `pos_sessions`
3. สร้าง view `branch_device_shift_sessions_compat` จาก `pos_sessions` สำหรับหน้าหรือ report เก่า
4. ยืนยันไม่มี row ใน `branch_device_shift_sessions`
5. deprecate table หลัง API ทั้งสองฝั่งเปลี่ยนแล้ว
6. drop หลังไม่มี usage/runtime write

## Pair 5: `mobile_device_sessions` + `device_enrollments` + `pos_sessions`

Canonical split:
- Device lifecycle: `device_enrollments`
- Runtime cashier session: `pos_sessions`

เหตุผล:
- `device_enrollments` คือการผูกเครื่อง/อนุมัติเครื่อง
- `pos_sessions` คือ session ใช้งานขายจริง
- `mobile_device_sessions` ยังไม่มีข้อมูล แต่เป็นชื่อที่ทับซ้อนระหว่าง auth session กับ device enrollment

Plan:
1. เก็บ `device_enrollments` สำหรับสถานะเครื่อง เช่น approved/revoked/last_seen
2. เก็บ `pos_sessions` สำหรับการเปิดกะ/เครื่องแคชเชียร์ที่กำลังใช้งาน
3. เลิกเขียน `mobile_device_sessions` โดยย้าย logic ไปสองตารางด้านบน
4. ถ้าต้องใช้ token/session mobile ระยะสั้น ให้ใช้ตาราง token แยกที่มี TTL ชัดเจน ไม่ปนกับ POS session
5. ทำ view/report compatibility ก่อน deprecate

## API/Component Usage ที่ต้องตามแก้

Mobile:
- `src/app/sales/table/page.tsx`
- `src/app/api/mobile/shifts/route.ts`
- `src/app/api/mobile/features/route.ts`
- `src/lib/auth/session.ts`
- `src/lib/auth/mobile-auth-service.ts`

Backoffice:
- `apps/backoffice-web/src/lib/services/table-service.ts`
- `apps/backoffice-web/src/lib/table-qr-ordering.ts`
- `apps/backoffice-web/src/components/tables/table-management-page.tsx`
- `apps/backoffice-web/src/lib/services/subscription-package-service.ts`
- `apps/backoffice-web/src/lib/feature-gate.ts`
- `apps/backoffice-web/src/lib/server/feature-gate-safe.ts`
- `apps/backoffice-web/src/lib/server/pos-session.ts`
- `apps/backoffice-web/src/lib/pos-session-guard.ts`
- `apps/backoffice-web/src/app/api/pos/*`
- `apps/backoffice-web/src/app/api/backoffice/tables/*`
- `apps/backoffice-web/src/app/api/it-admin/admin/tenants/*`
- `apps/backoffice-web/src/app/api/auth/devices/*`

## SQL Guardrail ก่อน Drop

ต้องผ่านทุกข้อก่อนสร้าง migration ที่ drop ตาราง:

```sql
select count(*) from public.<deprecated_table>;

select tc.table_name, tc.constraint_name
from information_schema.table_constraints tc
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.constraint_schema = tc.constraint_schema
where tc.constraint_type = 'FOREIGN KEY'
  and ccu.table_schema = 'public'
  and ccu.table_name = '<deprecated_table>';
```

และใน repo:

```bash
rg "<deprecated_table>" E:/SSTiPOS E:/SSTiPOSMobile
```

## Release Sequence

1. Release A: เพิ่ม view/RPC compatibility และเริ่มอ่านจาก canonical
2. Release B: ย้าย write path ทั้งสองโปรเจคไป canonical
3. Release C: backfill + เพิ่ม monitoring query + comment deprecated
4. Release D: ปิด fallback ใน API/component
5. Release E: drop table/column ที่ deprecated แล้วเท่านั้น

## ลำดับแนะนำ

1. `dine_in_tables` -> `dining_tables` เพราะตารางเก่าว่างและ dependency ต่ำ
2. `plans/plan_features/tenant_contracts` -> subscription package tables เพราะ legacy ไม่มีข้อมูล
3. `branch_device_shift_sessions` -> `pos_sessions` เพราะตารางเก่าว่าง แต่ต้องทดสอบ shift flow
4. `mobile_device_sessions` split ไป `device_enrollments`/`pos_sessions`
5. `pos_user_profiles` + `users_profiles` ให้ทำเป็น view/service consolidation ก่อน ยังไม่ drop

## Pair 1 execution log - 2026-07-18

Status: Release A/C compatibility step completed for `dine_in_tables` -> `dining_tables`.

Verified in Supabase project `deejlitaivfnsbwqdugy`:
- `dine_in_tables` has only outgoing FK constraints to `tenants.id` and `branches.id`.
- No table has an incoming FK to `dine_in_tables`.
- `dining_tables` is the canonical FK target for `orders.table_id`, `table_bill_sessions.table_id`, `table_qr_orders.table_id`, and `table_qr_sessions.table_id`.
- Existing Backoffice migration `202605190001_table_management_floor_plan.sql` already backfilled from `dine_in_tables` into `dining_tables` and moved `orders.table_id` to `dining_tables`.

Repo usage scan:
- `rg "dine_in_tables|dining_tables"` across TypeScript/TSX/SQL/Markdown in `E:/SSTiPOS` and `E:/SSTiPOSMobile` found no runtime code references to `dine_in_tables`.

Change added:
- Backoffice migration `supabase/migrations/202607180004_dine_in_tables_compat.sql` creates `public.dine_in_tables_compat` with `security_invoker = true`.
- Compatibility mapping: `dining_tables.id`, `tenant_id`, `branch_id`, `table_code`, `capacity as seats`, `is_active`, `created_at`.
- Added DB comments marking `public.dine_in_tables` deprecated and the compat view as temporary compatibility.

Guardrail:
- Do not drop `public.dine_in_tables` yet.
- Do not repoint `orders.table_id` away from `public.dining_tables`.
- Legacy consumers that still expect the old shape should read `public.dine_in_tables_compat`, not write to `public.dine_in_tables`.

## Mobile continuation note - 2026-07-18

Latest Mobile work continued in `E:/SSTiPOSMobile` after Pair 1:

- Mobile checkout was manually exercised and fixed for:
  - duplicate `orders_tenant_id_branch_id_order_no_key` on draft order creation/rename.
  - duplicate `idx_stock_movements_tenant_branch_request_id` during stock deduction by using per-ingredient request IDs.
  - `payment_method` enum cast failure in the mobile takeaway checkout RPC.
- Stock now deducts without waiting for shift close and Mobile has a stock API/screen that refreshes current product, ingredient, and recent stock movement state.
- Mobile stock product categories now read from canonical shared table `product_categories`.
- Product SKU/code is generated automatically and is not editable from the Mobile modal.
- Product and ingredient CRUD exists in Mobile stock; ingredient quantity adjustment writes stock changes.
- Mobile stock UI state at handoff:
  - table-style rows.
  - pagination is 5 rows per page.
  - top product/ingredient control panel is sticky.
  - user asked to stop broad UI iteration and only make exact requested changes next.

Verification:
- `E:/SSTiPOSMobile`: `npm run typecheck` passed after the latest stock UI tweak.
- `E:/SSTiPOSMobile`: `npm run lint` passed before the final sticky/pagination tweak; rerun lint in the next chat if more edits are made.

Guardrail remains:
- Do not drop/deprecate-remove any Supabase schema/table/column immediately.
- Use compatibility views/RPCs and staged migration docs before any destructive schema cleanup.
