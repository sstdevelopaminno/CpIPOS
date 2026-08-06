import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { MemberSettingsClient } from "@/components/sales/member-settings-client";
import { requireOpenShift } from "@/lib/permissions/guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MemberSettingsPage() {
  const { scope } = await requireOpenShift("settings:view");

  return (
    <MobileAppShell title="ตั้งค่าสมาชิก" scope={scope}>
      <MemberSettingsClient />
    </MobileAppShell>
  );
}
