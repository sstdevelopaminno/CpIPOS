import type { ReactNode } from "react";
import { requireOperator } from "@/lib/auth";
import { ItSidebar } from "@/components/it-sidebar";

export default async function ItAdminLayout({ children }: { children: ReactNode }) {
  const operator = await requireOperator();

  return (
    <div className="shell">
      <ItSidebar role={operator.role} />
      <main className="main">
        <header className="topbar">
          <div>
            <div className="topbarTitle">IT Operations Control Plane</div>
            <div className="topbarSub">แยก deployment จาก POS · scoped control · production-safe by default</div>
          </div>
          <div className="topbarRight">
            <span className="environmentPill"><span className="liveDot" />CONTROL PLANE ONLINE</span>
            <span className="role">{operator.role.toUpperCase()}</span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
