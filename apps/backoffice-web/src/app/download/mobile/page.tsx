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
      title="CpIPOS Mobile — Native Android 100%"
      subtitle="แอป Android ที่เขียนด้วย Kotlin + Jetpack Compose โดยตรง ไม่มี WebView และไม่ต้องมีเว็บไซต์หรือ Hosting แยกสำหรับตัว Mobile แอปเชื่อม API ของ CpIPOS Server เพื่อใช้ Tenant / Branch / Device / Session / Shift / Order / Payment ชุดเดียวกับระบบหลัก"
      illustration={<AndroidPosIllustration />}
      features={[
        "Native Android 100% ไม่มี WebView",
        "รองรับมือถือและแท็บเล็ต Android",
        "Login / Device / Session / Shift จาก CpiPOS Server",
        "ขายสินค้า ชำระเงิน รายการขาย สินค้า สมาชิก และปิดยอด",
        "APK สร้างและแจกผ่าน GitHub Actions / Releases",
        "ไม่ใช้ Vercel Project แยกสำหรับ CpIPOS Mobile"
      ]}
      downloadUrl={downloadUrl}
      downloadLabel="ดาวน์โหลด CpIPOS Mobile (APK)"
      fileHint='ไฟล์ CpIPOS-Mobile.apk ติดตั้งแบบ Sideload บน Android ให้เปิด "อนุญาตติดตั้งจากแหล่งที่ไม่รู้จัก" สำหรับเบราว์เซอร์หรือ File Manager ที่ใช้เปิดไฟล์'
      separateNoticeTitle="แยกจาก CpIPOS Android POS"
      separateNoticeBody={[
        "CpIPOS Mobile เป็นแอป Native สำหรับ Owner / Manager / Staff บนมือถือและแท็บเล็ต ส่วน CpIPOS Android POS ยังคงเป็นผลิตภัณฑ์ POS Tablet แยกอีกตัวหนึ่ง",
        "ทั้งสองแอปใช้ Backend / Database / Security Gate ของ CpIPOS ชุดเดียวกัน แต่มี APK และ Release แยกกัน"
      ]}
      stepsTitle="วิธีติดตั้ง CpIPOS Mobile"
      steps={[
        "เปิดหน้านี้บนโทรศัพท์หรือแท็บเล็ต Android แล้วกดดาวน์โหลด",
        'หาก Android แจ้งเตือน ให้เปิดสิทธิ์ "Install unknown apps" ให้เบราว์เซอร์หรือ File Manager ที่ใช้งาน',
        "เปิดไฟล์ CpIPOS-Mobile.apk แล้วกดติดตั้ง",
        "เปิดแอป CpIPOS Mobile และกรอกรหัสร้าน → สาขา → รหัสพนักงาน → เครื่อง",
        "เปิดกะ แล้วเริ่มใช้งานเมนูขาย รายการขาย สินค้า สมาชิก ปิดยอด และตั้งค่า"
      ]}
      statusTitle="สถาปัตยกรรม"
      statusBody="ตัวแอปเป็น Native Android จริงและไม่มี WebView ธุรกรรมสำคัญยังคงทำผ่าน Server-side API ของ CpIPOS เพื่อให้ราคา Order / Payment / Stock / Session / Shift / Trial routing และ Audit ใช้กติกาเดียวกับ Production baseline"
    />
  );
}
