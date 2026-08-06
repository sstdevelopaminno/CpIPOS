import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { requireOpenShift } from "@/lib/permissions/guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AttendancePage() {
  const { scope } = await requireOpenShift(["owner", "manager", "staff"]);
  return (
    <MobileAppShell title="เข้างาน" scope={scope}>
      <div className="card p-4 text-sm text-slate-600">สถานะเข้างานและประวัติวันนี้</div>
    </MobileAppShell>
  );
}
