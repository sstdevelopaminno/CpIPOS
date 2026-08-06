import { DownloadPageShell } from "@/components/download/download-page-shell";
import { WindowsPosIllustration } from "@/components/download/download-illustrations";

const downloadUrl = "/download/windows-runtime/latest";

export const metadata = {
  title: "ดาวน์โหลด CpIPOS Windows",
  description: "ดาวน์โหลดตัวติดตั้ง CpIPOS Windows Runtime สำหรับเครื่อง POS Windows."
};

export default function WindowsRuntimeDownloadPage() {
  return (
    <DownloadPageShell
      eyebrow="CpIPOS Windows"
      title="เปิดร้านของคุณด้วย CpIPOS บน Windows"
      subtitle="ตัวติดตั้ง CpIPOS Windows Runtime สำหรับเครื่อง POS แคชเชียร์ เปิดระบบด้วย WebView2 แบบเต็มจอ ไม่มี address bar พร้อม Local Print Bridge ในตัวสำหรับเครื่องพิมพ์และลิ้นชักเก็บเงิน"
      illustration={<WindowsPosIllustration />}
      features={["เต็มจอ ไม่มี Address Bar", "Local Print Bridge ในตัว", "พิมพ์ได้ทั้ง USB / Bluetooth / LAN", "เปิดลิ้นชักเงินสดได้"]}
      downloadUrl={downloadUrl}
      downloadLabel="ดาวน์โหลดตัวติดตั้ง Windows"
      fileHint="ไฟล์หลักคือ CpIPOS-WindowsRuntime-Setup.exe สำหรับติดตั้งลงเครื่อง Windows และสร้าง shortcut ให้อัตโนมัติ"
      separateNoticeTitle="แยกจาก CpIPOS Web"
      separateNoticeBody={[
        "CpIPOS Web ยังคงเป็นเว็บหลักสำหรับเข้าใช้งานผ่าน browser ส่วนหน้านี้ใช้สำหรับดาวน์โหลดตัวติดตั้ง CpIPOS Windows โดยเฉพาะ",
        "เมื่อติดตั้งแล้ว ระบบจะสร้าง shortcut สำหรับเปิดโปรแกรม CpIPOS Windows บนเครื่อง POS"
      ]}
      stepsTitle="วิธีติดตั้งบนเครื่อง POS Windows"
      steps={[
        "กดปุ่ม “ดาวน์โหลดตัวติดตั้ง Windows”",
        "เปิดไฟล์ CpIPOS-WindowsRuntime-Setup.exe",
        "กดติดตั้งตามขั้นตอน ระบบจะสร้าง shortcut ที่ Desktop/Start Menu",
        "เปิดโปรแกรม CpIPOS Windows Runtime จาก shortcut",
        "ปิดโปรแกรมได้จากปุ่ม “ปิดโปรแกรม” ด้านบนขวา หรือกด Esc / Alt+F4"
      ]}
      statusTitle="สถานะฟีเจอร์"
      statusBody="เวอร์ชันนี้เป็น Windows Runtime + Local Print Bridge สำหรับทดสอบเครื่อง POS Windows จริง ระบบขาย offline เต็มรูปแบบและ sync queue ยังเป็นเฟสถัดไป"
    />
  );
}
