import { DownloadCenterV107 } from "./download-center-v107";

export const metadata = {
  title: "Download CpIPOS Android POS 1.0.7",
  description: "ดาวน์โหลด CpIPOS POS สำหรับ Android Tablet เวอร์ชัน 1.0.7 Stable"
};

export default function CpiposDownloadCenterPage() {
  return (
    <div className="h-dvh overflow-y-auto overscroll-y-contain">
      <DownloadCenterV107 />
    </div>
  );
}
