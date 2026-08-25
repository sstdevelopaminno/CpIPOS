"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/it-admin", label: "ภาพรวม", hint: "Platform overview", icon: "◫" },
  { href: "/it-admin/operations", label: "Operations", hint: "24/7 fleet health", icon: "◉" },
  { href: "/it-admin/stores", label: "Store Registry", hint: "FG / FF / tenants", icon: "▦" },
  { href: "/it-admin/provisioning", label: "Provisioning", hint: "Preflight / onboarding", icon: "＋" },
  { href: "/it-admin/mdm", label: "MDM Control", hint: "Store → Branch → Device", icon: "⌁" },
  { href: "/it-admin/incidents", label: "Incidents", hint: "Alerts & response", icon: "⚠" }
];

export function ItSidebar({ role }: { role: string }) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="brandBlock">
        <div className="brandMark">CP</div>
        <div>
          <div className="brandName">CpIPOS</div>
          <div className="brandSub">IT CONTROL PLANE</div>
        </div>
      </div>

      <div className="navSectionLabel">CONTROL CENTER</div>
      <nav className="nav">
        {items.map((item) => {
          const active = item.href === "/it-admin" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`navItem ${active ? "navItemActive" : ""}`}>
              <span className="navIcon">{item.icon}</span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebarSafety">
        <div className="safetyRow"><span className="liveDot" />Deployment isolated</div>
        <div>Role <strong>{role.toUpperCase()}</strong></div>
        <div>Global MDM broadcast <strong>OFF</strong></div>
      </div>
    </aside>
  );
}
