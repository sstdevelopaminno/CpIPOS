import type { ReactNode } from "react";
import type { AccountingRole } from "@/lib/auth";
import { AppNav } from "./nav";

export function AppShell({
  role,
  title,
  subtitle,
  children
}: {
  role: AccountingRole;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="appShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">CUTTING POINT TECH</p>
          <h1>{title}</h1>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
        <div className="topActions">
          <span className="roleBadge">{role === "cfo" ? "CFO" : "Marketing"}</span>
          <form action="/logout" method="post">
            <button className="ghostButton" type="submit">ออก</button>
          </form>
        </div>
      </header>
      <main className="content">{children}</main>
      <AppNav role={role} />
    </div>
  );
}

export function EmptyState({
  title,
  detail
}: {
  title: string;
  detail: string;
}) {
  return (
    <section className="emptyState">
      <div className="emptyIcon">i</div>
      <h2>{title}</h2>
      <p>{detail}</p>
    </section>
  );
}
