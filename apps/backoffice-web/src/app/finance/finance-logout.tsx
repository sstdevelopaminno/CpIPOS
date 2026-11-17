"use client";

import { useState } from "react";
import { FinanceNavIcon } from "./finance-nav-icon";

export function FinanceLogout({ collapsed = false }: { collapsed?: boolean }) {
  const [error, setError] = useState("");

  async function logout() {
    setError("");
    try {
      const response = await fetch("/api/auth/accounting/logout", {
        method: "POST",
        cache: "no-store"
      });
      if (!response.ok) throw new Error("logout_failed");
      window.location.replace("/login/store");
    } catch {
      setError("ออกจากระบบไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => void logout()}
        title={collapsed ? "ออกจากระบบ" : undefined}
        aria-label="ออกจากระบบ"
        className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-sky-300/25 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-slate-100 transition-colors hover:border-rose-300/40 hover:bg-rose-400/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
      >
        <FinanceNavIcon name="logout" />
        {!collapsed ? <span>ออกจากระบบ</span> : null}
      </button>
      {error ? <p role="alert" className="text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}
