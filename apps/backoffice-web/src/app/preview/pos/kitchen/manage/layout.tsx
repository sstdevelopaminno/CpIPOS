import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requirePosSession } from "@/lib/pos-session-guard";

export default async function KitchenManageLayout({ children }: { children: ReactNode }) {
  const scope = await requirePosSession();
  const role = String(scope.session.role ?? "").trim().toLowerCase();
  if (role !== "owner" && role !== "manager") {
    redirect("/preview/pos/kitchen");
  }
  return children;
}
