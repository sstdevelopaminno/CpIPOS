import { AuthShell } from "@/components/auth/auth-shell";
import { EmployeeLoginForm } from "@/components/auth/employee-login-form";
import { readMobileFlow } from "@/lib/auth/mobile-flow";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EmployeePage() {
  const flow = await readMobileFlow();
  if (!flow) redirect("/login/store");
  if (flow.stage === "store_verified") redirect("/login/branch");
  if (!flow.branchId || flow.stage !== "branch_selected") redirect("/login/store");

  return (
    <AuthShell title="ยืนยันพนักงาน" subtitle="Employee Code">
      <EmployeeLoginForm branchName={flow.branchName ?? flow.branchCode ?? "สาขา"} />
    </AuthShell>
  );
}
