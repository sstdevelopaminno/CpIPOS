import { DownloadPageShell } from "@/components/download/download-page-shell";
import { AndroidPosIllustration } from "@/components/download/download-illustrations";

const downloadUrl = "/download/mobile/latest";

export const metadata = {
  title: "ดาวน์โหลด CpIPOS Mobile",
  description: "ดาวน์โหลด CpIPOS Mobile แบบ Native Android สำหรับมือถือและแท็บเล็ต"
};

export default function CpiposMobileDownloadPage() {
  return (
    <DownloadPageShell
      eyebrow="CpIPOS Mobile"
      title="พก CpIPOS Mobile ไปกับมือถือและแท็บเล็ต Android"
      subtitle="แอป CpIPOS Mobile แบบ Native Android 100% เขียนด้วย Kotlin + Jetpack Compose โดยตรง ไม่มี WebView และไม่ต้องมี Hosting แยก เชื่อมต่อ CpIPOS Server ชุดเดียวกับระบบหลักสำหรับ Login, Device, Session, Shift, Order และ Payment"
      illustration={<AndroidPosIllustration />}
      features={[
        "Native Android 100% ไม่มี WebView",
        "รองรับมือถือและแท็บเล็ต Android",
        "ใช้ Login / Device / Session / Shift ชุดเดียวกับ CpIPOS",
        "อัปเดต APK ผ่านลิงก์ดาวน์โหลดเดิมอัตโนมัติ"
      ]}
      downloadUrl={downloadUrl}
      downloadLabel="ดาวน์โหลด CpIPOS Mobile (APK)"
      fileHint='ไฟล์ CpIPOS-Mobile.apk สำหรับติดตั้งบน Android โดยตรง ให้เปิด "อนุญาตติดตั้งจากแหล่งที่ไม่รู้จัก" (Install unknown apps) สำหรับเบราว์เซอร์หรือ File Manager ที่ใช้เปิดไฟล์'
      separateNoticeTitle="แยกจาก CpIPOS Android POS"
      separateNoticeBody={[
        "CpIPOS Mobile เป็นแอป Native สำหรับ Owner / Manager / Staff บนมือถือและแท็บเล็ต ส่วน CpIPOS Android POS ยังคงเป็นผลิตภัณฑ์ POS Tablet แยกอีกตัวหนึ่ง",
        "ทั้งสองแอปใช้ Backend / Database / Security Gate ของ CpIPOS ชุดเดียวกัน แต่มี APK และ Release แยกกัน"
      ]}
      stepsTitle="วิธีติดตั้ง CpIPOS Mobile บน Android"
      steps={[
        "เปิดหน้านี้จากเบราว์เซอร์บนมือถือหรือแท็บเล็ต Android แล้วกดปุ่มดาวน์โหลด",
        'หาก Android แจ้งเตือน ให้เปิดสิทธิ์ "Install unknown apps" ให้เบราว์เซอร์หรือ File Manager ที่ใช้งาน',
        "เปิดไฟล์ CpIPOS-Mobile.apk แล้วกดติดตั้ง",
        "เปิดแอป CpIPOS Mobile แล้วกรอกรหัสร้าน → สาขา → รหัสพนักงาน → เครื่อง",
        "เปิดกะ แล้วเริ่มใช้งานเมนูขาย รายการขาย สินค้า สมาชิก ปิดยอด และตั้งค่า"
      ]}
      statusTitle="สถานะ CpIPOS Mobile"
      statusBody="CpIPOS Mobile เป็น Native Android จริง ไม่มี WebView และไม่ต้องใช้ Vercel Project แยก ธุรกรรมสำคัญยังทำผ่าน Server-side API ของ CpIPOS เพื่อให้ราคา Order / Payment / Stock / Session / Shift / Trial routing และ Audit ใช้กติกาเดียวกับ Production baseline"
    />
  );
}
