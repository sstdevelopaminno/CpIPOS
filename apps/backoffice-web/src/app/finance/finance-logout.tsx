"use client";

import { useState } from "react";

export function FinanceLogout() {
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
        className="rounded-lg border border-white/40 px-4 py-2 text-sm font-semibold hover:bg-white/10"
      >
        ออกจากระบบ
      </button>
      {error ? <p role="alert" className="text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}
