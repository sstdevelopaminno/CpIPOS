import { DownloadCenterClient } from "./download-center-client";

export const metadata = {
  title: "Download CpIPOS Desktop 0.2.7",
  description: "ดาวน์โหลด CpIPOS Desktop Windows 0.2.7 และ CpIPOS POS สำหรับ Android"
};

export default function CpiposDownloadCenterPage() {
  return (
    <div className="h-dvh overflow-y-auto overscroll-y-contain">
      <DownloadCenterClient />
    </div>
  );
}
