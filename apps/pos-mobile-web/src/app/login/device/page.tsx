import { AuthShell } from "@/components/auth/auth-shell";
import { DeviceSelector } from "@/components/auth/device-selector";
import { listBranchDevices } from "@/lib/auth/mobile-auth-service";
import { readMobileFlow } from "@/lib/auth/mobile-flow";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DevicePage() {
  const flow = await readMobileFlow();
  if (!flow) redirect("/login/store");
  if (flow.stage === "store_verified") redirect("/login/branch");
  if (flow.stage === "branch_selected") redirect("/login/employee");
  if (flow.stage !== "employee_verified") redirect("/login/store");

  const devices = await listBranchDevices(flow);

  return (
    <AuthShell title="เลือกเครื่องแคชเชียร์" subtitle={flow.branchName ?? flow.branchCode ?? "สาขา"}>
      <DeviceSelector branchName={flow.branchName ?? flow.branchCode ?? "สาขา"} devices={devices} />
    </AuthShell>
  );
}
