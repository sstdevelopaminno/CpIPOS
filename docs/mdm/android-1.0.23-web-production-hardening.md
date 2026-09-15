# MDM Hardening — Android 1.0.23 + Web Production

เอกสารนี้เป็นขอบเขต Production-safe สำหรับระบบ MDM ของ CpIPOS โดยจำกัด full MDM เฉพาะเครื่อง Android `1.0.23 + Web Production` ที่บริษัทเป็นเจ้าของหรือเป็นเครื่องผ่อนของบริษัทเท่านั้น

## เป้าหมาย

ทำให้ระบบ MDM พร้อมใช้งานเชิง Production โดยมี guard, audit, database contract, Web Console state และ Android agent contract ครบก่อนเปิดใช้จริงกับเครื่องผ่อน/เครื่องบริษัท

## ขอบเขตที่เปิด full MDM ได้

เครื่องต้องผ่านทุกเงื่อนไขต่อไปนี้:

| Field | Required value |
| --- | --- |
| `platform` | `android` |
| `appVersion` | `1.0.23` only |
| `appFlavor` | `web-production`, `web_production`, or `production_web` |
| `nativeGeneration` | not `2.0` |
| `ownershipType` | `company_owned` or `company_financed` |
| `enrollmentMode` | `android_enterprise_device_owner`, `fully_managed`, or `dedicated_device` |
| `isDeviceOwner` | `true` |
| `capabilities` | must include `mdm_core` |

## ขอบเขตที่ต้องเป็น Diagnostics Only

กลุ่มต่อไปนี้ห้ามได้ full MDM ใน release นี้:

- Android `1.0.12 LTS`
- Android app version อื่นที่ไม่ใช่ `1.0.23`
- Native `2.0`
- เครื่องลูกค้าที่ซื้อเอง
- BYOD / เครื่องส่วนตัว
- เครื่องที่ `device_owner=false`
- เครื่องที่ลง APK เองโดยไม่ได้ enroll ผ่าน managed flow

## คำสั่ง MDM

| Command | Full MDM | Diagnostics only | หมายเหตุ |
| --- | --- | --- | --- |
| `diagnostics_ping` | yes | yes | ใช้ตรวจสถานะพื้นฐาน |
| `sync_policy` | yes, if `policy_sync` | no | ดึง policy ล่าสุด |
| `lock_device` | yes, if `remote_lock` | no | ต้องมีเหตุผลและ audit |
| `unlock_device` | yes, if `remote_lock` | no | ต้องมีเหตุผลและ audit |
| `financing_lock` | yes, if `remote_lock` | no | สำหรับเครื่องผ่อน/ค้างชำระ |
| `revoke_device_access` | yes, if `remote_lock` | no | ใช้แทนการถอน core agent โดยตรง |
| `request_location` | yes, if `location` | no | ต้องมีเหตุผลและ audit |
| `start_remote_support` | yes, if `remote_support` | no | เฉพาะ attended/company_kiosk |
| `stop_remote_support` | yes, if `remote_support` | no | ปิด session และบันทึก audit |
| `install_app` | yes, if `app_install` | no | managed app เท่านั้น |
| `uninstall_app` | yes, if `app_uninstall` | no | ห้าม uninstall core agent package โดยตรง |

## Remote screen access

การเข้าถึงหน้าจอเครื่องต้องทำเป็น Remote Support Session เท่านั้น

อนุญาต:

- `attended` session
- `company_kiosk` session สำหรับเครื่องบริษัท/เครื่องผ่อนที่ enroll ถูกต้อง
- session มี TTL สูงสุด 60 นาที
- มี audit log ทุกครั้ง

ไม่อนุญาต:

- silent remote viewing
- remote session ไม่จำกัดเวลา
- remote session บน BYOD/customer-owned devices
- remote session บนเครื่องที่ `device_owner=false`

## Financing lock lifecycle

สำหรับธุรกิจเครื่องผ่อน ให้แยกสถานะดังนี้:

1. `normal` — ใช้งานปกติ
2. `payment_due_warning` — เตือนใกล้ครบกำหนด
3. `payment_overdue_limited` — จำกัดบางฟังก์ชันตาม policy
4. `financing_locked` — ล็อกเครื่องตามสัญญา/approval
5. `recovered` — เครื่องถูกนำกลับ/ปิดบัญชี
6. `released` — ชำระครบและปลดจาก policy ผ่อน

## Implementation status for items 1–7

| Item | Status | File |
| --- | --- | --- |
| 1. Create branch | done | `feature/mdm-android-1-0-23-web-production-final` |
| 2. Eligibility gate | done | `src/lib/mdm/eligibility.ts` |
| 3. Supabase schema | done | `supabase/migrations/20260911184500_mdm_android_1023_web_production.sql` |
| 4. API command validation | done | `src/lib/mdm/commandPolicy.ts` |
| 5. Web Production console state | done | `src/lib/mdm/webConsoleControls.ts` |
| 6. Android 1.0.23 agent contract | done | `docs/mdm/android-agent-contract-1.0.23.md` |
| 7. Smoke tests | done | `docs/mdm/smoke-test-android-1.0.23-web-production.md` and `src/lib/mdm/eligibility.test.ts` |

## Production rollout checklist

Do not skip these steps:

1. Review PR diff.
2. Run TypeScript checks and unit tests.
3. Apply migration to Supabase staging only.
4. Enroll one staging Android 1.0.23 device as Device Owner.
5. Confirm Web Production console shows full MDM only for the staging managed device.
6. Confirm FF0001-style unmanaged devices remain Diagnostics Only.
7. Confirm Android 1.0.12 LTS remains unaffected.
8. Confirm Native 2.0 remains Diagnostics Only.
9. Deploy Web Production with feature flag/tenant allowlist off by default.
10. Enable tenant allowlist for company-owned/company-financed pilot devices only.
11. Apply production migration only after explicit approval.

## Rollback

If any issue appears:

1. Disable the MDM feature flag or tenant allowlist.
2. Stop MDM command workers.
3. Expire active remote support sessions.
4. Do not delete audit tables.
5. Keep devices in Diagnostics Only until the issue is fixed.

## Current known device note

`FF0001-POS-01` is not eligible for full MDM until it is upgraded/enrolled as Android `1.0.23 + Web Production` with Device Owner status.
