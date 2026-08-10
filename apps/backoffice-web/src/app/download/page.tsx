import { DownloadCenterClient } from "./download-center-client";

export const metadata = {
  title: "Download CpIPOS",
  description: "ดาวน์โหลด CpIPOS POS สำหรับ Android Tablet และตรวจสอบสถานะแอป CpIPOS สำหรับแพลตฟอร์มอื่น"
};

export default function CpiposDownloadCenterPage() {
  return (
    <div className="h-dvh overflow-y-auto overscroll-y-contain">
      <DownloadCenterClient />
    </div>
  );
}
