> [!WARNING]
> ARCHIVED (2026-05-31): This document references legacy QR login flow and is kept for historical/audit context only.
> Active runtime flow: apps/backoffice-web `/login/store -> /login/branches|employee -> /login/devices`.
> See: `docs/ARCHIVE-QR-DECOMMISSION-2026-05-31.md`.
# AI Handoff: QR Scan Register Flow (2026-05-28)

## สถานะล่าสุด
- ปรับหน้า `qr-scan` ตาม UI ใหม่แล้ว:
  - มีหัวข้อฟิลด์ `รหัสร้านค้า` และ `ชื่อผู้ใช้งาน`
  - ปรับตัวอักษรหัวข้อให้ไม่หนาและไม่ใหญ่เกินไป
  - ปุ่มล่างเปลี่ยนเป็น `ลงทะเบียนผู้ใช้งาน`
- เพิ่ม flow ลงทะเบียนผู้ใช้งานจริงที่หน้า:
  - `/qr-scan/register`
- เพิ่ม API ตรวจสอบข้อมูลลงทะเบียน:
  - `POST /api/auth/register-user/verify`

## พฤติกรรม flow ลงทะเบียน (ปัจจุบัน)
1. กรอก `รหัสร้านค้า` + `ชื่อ` + `ชื่อผู้ใช้งาน`
2. กด `ยืนยันการลงทะเบียน`
3. ระบบแสดง POPUP `กำลังตรวจสอบ`
4. ถ้าผ่าน:
   - แสดงสถานะสำเร็จ
   - เด้งกลับหน้า `/qr-scan`

## Logic ตรวจสอบล่าสุด
- ตรวจหลักด้วย `รหัสร้านค้า + ชื่อผู้ใช้งาน` (เพื่อให้ใช้งานได้จริงแม้ข้อมูลชื่อมี encoding เพี้ยนใน seed บางชุด)
- `ชื่อ` ยังรับและตรวจเทียบอยู่ แต่ไม่บล็อกการผ่านในกรณี mismatch
- แก้ปัญหา user ซ้ำหลายสาขาโดย dedupe ก่อนตรวจ

## ไฟล์ที่แก้ในรอบนี้
- `apps/qr-login-web/src/app/qr-scan/page.tsx`
- `apps/qr-login-web/src/app/qr-scan/register/page.tsx`
- `apps/qr-login-web/src/app/api/auth/register-user/verify/route.ts`
- `apps/qr-login-web/src/components/pwa/pwa-bootstrap.tsx`
- `apps/qr-login-web/public/sw.js`

## ข้อมูลทดสอบ (ร้านที่ใช้งานตอนนี้)
- Store code: `NDL-TH-001`
- Username แนะนำ:
  - `EMP-000101`
  - `EMP-000102`
  - `EMP-000103`

## หมายเหตุสำคัญ
- เคยมีปัญหา cache จาก Service Worker ทำให้หน้าไม่อัปเดต
- ปัจจุบันแก้แล้วโดย:
  - Dev mode unregister SW + clear cache
  - ปรับ SW เป็น cache version ใหม่

## งานถัดไปที่ควรทำ
- ผูกการ “ผ่านลงทะเบียน” เข้าสู่ flow อนุมัติสิทธิ์/เปิดใช้งาน user ฝั่งหลังบ้านแบบครบวงจร
- เพิ่มหน้าแสดงผลสำเร็จ/ไม่สำเร็จที่บอกเหตุผลละเอียดขึ้น
- รัน E2E evidence ใหม่ทั้งชุด (login -> register -> qr-scan -> pos)
