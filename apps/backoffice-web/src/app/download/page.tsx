import { DownloadCenterClient } from "./download-center-client";

export const metadata = {
  title: "CpIPOS Download Center",
  description: "ดาวน์โหลด CpIPOS เวอร์ชันล่าสุดสำหรับ Windows และ Android"
};

export default function CpiposDownloadCenterPage() {
  return (
    <div className="h-dvh overflow-y-auto overscroll-y-contain">
      <DownloadCenterClient />
    </div>
  );
}
