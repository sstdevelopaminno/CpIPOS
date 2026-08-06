import { LoadingDialog } from "@/components/auth/loading-dialog";

export default function SalesLoading() {
  return <LoadingDialog open title="กำลังเปิดเมนู" message="กำลังโหลดข้อมูลเมนูขาย..." />;
}
