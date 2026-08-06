import { requireMobileSession } from "@/lib/permissions/guard";
import { createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const scope = await requireMobileSession();
  const supabase = createServiceClient();
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("id")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("device_code", scope.deviceCode)
    .eq("status", "open")
    .maybeSingle();

  if (error) throw new Error(error.message);
  redirect(shift ? "/sales" : "/shifts");
}
