import Link from "next/link";
import type { ReactNode } from "react";
import { requireOperator } from "@/lib/auth";

export default async function ItAdminLayout({ children }: { children: ReactNode }) {
  const operator = await requireOperator();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">CpIPOS<small>IT CONTROL PLANE</small></div>
        <nav className="nav">
          <Link href="/it-admin">ภาพรวม</Link>
          <Link href="/it-admin/operations">Operations Center</Link>
          <Link href="/it-admin/stores">Store Registry</Link>
          <Link href="/it-admin/mdm">MDM Control</Link>
          <Link href="/it-admin/incidents">Incident Center</Link>
        </nav>
        <div className="sideNote">Role: {operator.role}<br />POS deployment: isolated<br />Global MDM broadcast: disabled by design</div>
      </aside>
      <main className="main">
        <header className="topbar"><div><strong>IT Operations</strong><div style={{fontSize:11,color:"#718096"}}>Production control plane · separate Vercel project</div></div><span className="role">{operator.role.toUpperCase()}</span></header>
        {children}
      </main>
    </div>
  );
}
