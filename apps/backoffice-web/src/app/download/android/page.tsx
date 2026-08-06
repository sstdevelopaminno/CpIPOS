import { DownloadPageShell } from "@/components/download/download-page-shell";
import { AndroidPosIllustration } from "@/components/download/download-illustrations";

const downloadUrl = "/download/android/latest";

export const metadata = {
  title: "ดาวน์โหลด CpIPOS Android",
  description: "ดาวน์โหลด CpIPOS Android APK สำหรับแท็บเล็ต POS"
};

export default function AndroidRuntimeDownloadPage() {
  return (
    <DownloadPageShell
      eyebrow="CpIPOS Android"
      title="พกร้านของคุณไปกับแท็บเล็ต Android"
      subtitle="แอป Android สำหรับแท็บเล็ต POS เปิดระบบ CpIPOS แบบเต็มจอแนวนอน ไม่มี address bar เว็บ UI เดิมยังเป็นแหล่งข้อมูลหลักของหน้าจอขาย แอปนี้เป็นเปลือกแสดงผลเท่านั้น"
      illustration={<AndroidPosIllustration />}
      features={["เต็มจอแนวนอน ไม่มี Address Bar", "รองรับแท็บเล็ตทุกขนาดขึ้นไป", "ใช้ร่วมกับ Bluetooth Print Agent บนเว็บ", "อัปเดต UI อัตโนมัติทุกครั้งที่เข้าเน็ต"]}
      downloadUrl={downloadUrl}
      downloadLabel="ดาวน์โหลด CpIPOS Android (APK)"
      fileHint='ไฟล์ CpIPOS-Android-debug.apk ต้องเปิด "อนุญาตติดตั้งจากแหล่งที่ไม่รู้จัก" (Install unknown apps) ก่อนติดตั้ง เพราะยังไม่ได้เผยแพร่ผ่าน Google Play'
      separateNoticeTitle="แยกจาก CpIPOS Web"
      separateNoticeBody={["CpIPOS Web ยังคงเป็นเว็บหลักสำหรับเข้าใช้งานผ่านเบราว์เซอร์ ส่วนหน้านี้ใช้สำหรับดาวน์โหลดแอป Android โดยเฉพาะ"]}
      stepsTitle="วิธีติดตั้งบนแท็บเล็ต Android"
      steps={[
        "เปิดหน้านี้จากเบราว์เซอร์บนแท็บเล็ต Android แล้วกดปุ่มดาวน์โหลด",
        'เมื่อเบราว์เซอร์เตือนเรื่องไฟล์ไม่รู้จัก ให้กด "ดาวน์โหลดต่อ"',
        "เปิดไฟล์ CpIPOS-Android-debug.apk แล้วอนุญาตติดตั้งจากแหล่งที่ไม่รู้จักตามที่ระบบขอ",
        "กดติดตั้ง แล้วเปิดแอป CpIPOS",
        "เข้าสู่ระบบด้วยรหัสร้านเหมือนบนเว็บปกติ"
      ]}
      statusTitle="สถานะฟีเจอร์"
      statusBody="เวอร์ชันนี้เป็น Android Runtime เฟส 1: เปิดเว็บ POS แบบเต็มจอแนวนอนเท่านั้น ยังไม่มีเครื่องพิมพ์/ลิ้นชักผ่าน native bridge ให้ใช้ Bluetooth Print Agent บนเว็บแทนในระหว่างนี้ และยังเป็นไฟล์ debug (ยังไม่ได้เซ็นชื่อแบบ release)"
    />
  );
}
