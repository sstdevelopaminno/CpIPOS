"use client";

export function FinanceLogout() {
  async function logout() {
    await fetch("/api/auth/accounting/logout", { method: "POST", cache: "no-store" }).catch(() => null);
    window.location.replace("/login/store");
  }
  return (
    <button type="button" onClick={() => void logout()}
      className="rounded-lg border border-white/40 px-4 py-2 text-sm font-semibold hover:bg-white/10">
      ออกจากระบบ
    </button>
  );
}
