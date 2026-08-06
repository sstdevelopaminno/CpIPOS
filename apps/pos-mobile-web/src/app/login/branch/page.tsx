import { AuthShell } from "@/components/auth/auth-shell";
import { BranchSelector } from "@/components/auth/branch-selector";
import { listBranches } from "@/lib/auth/mobile-auth-service";
import { readMobileFlow } from "@/lib/auth/mobile-flow";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BranchPage() {
  const flow = await readMobileFlow();
  if (!flow) redirect("/login/store");

  const branches = await listBranches(flow);

  return (
    <AuthShell title="เลือกสาขา" subtitle={flow.tenantName}>
      <BranchSelector branches={branches} />
    </AuthShell>
  );
}
