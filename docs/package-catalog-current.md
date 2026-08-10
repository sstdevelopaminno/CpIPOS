# CpIPOS Canonical Package Catalog

Status: authoritative working baseline from the approved package artwork on 2026-08-11.

Only the packages below are canonical/public at this stage. Additional package details may be added later by explicit product decision.

## Starter — 350 บาท / เดือน

- 1 สาขา
- 1 เครื่อง
- สินค้า 1,000 รายการ
- 3,000 บิล / เดือน
- พื้นที่ 3 GB
- ดูข้อมูลย้อนหลัง 6 เดือน
- ส่งออก CSV

## Growth — 550 บาท / เดือน

- 1 สาขา
- 2 เครื่อง
- สินค้า 2,000 รายการ
- 5,000 บิล / เดือน
- พื้นที่ 5 GB
- ดูข้อมูลย้อนหลัง 12 เดือน
- พนักงาน 5 บัญชี
- ซิงก์ข้อมูลแบบเรียลไทม์
- แพ็กเกจแนะนำ

## Trial

- ทดลองใช้ฟรี 7 วัน
- เริ่มต้นใช้งานได้ทันที
- Trial is handled by the Trial data plane (CpiPOS-002), not as an additional paid package row.
- Paid/activated tenants are promoted to the Primary data plane (CpiPOS-001) through the controlled tenant-promotion flow.

## Catalog rule

Customer-facing package selection must expose only `starter` and `growth` until a later explicit package decision is approved.

Obsolete package rows that have no references may be deleted. Legacy rows still referenced by tenant/contract/history records must remain hidden and non-canonical until those references are migrated or archived safely; they must not appear as saleable packages.
