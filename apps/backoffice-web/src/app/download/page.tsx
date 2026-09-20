import { DownloadCenterClient } from "./download-center-client";

export const metadata = {
  title: "Download CpIPOS - Windows 0.3.3 & Android 1.0.23 RC",
  description: "ดาวน์โหลด CpIPOS Desktop สำหรับ Windows และ CpIPOS Android POS รุ่น MDM RC ทดสอบ"
};

export default function CpiposDownloadCenterPage() {
  return (
    <div className="h-dvh overflow-y-auto overscroll-y-contain">
      <DownloadCenterClient />
    </div>
  );
}
