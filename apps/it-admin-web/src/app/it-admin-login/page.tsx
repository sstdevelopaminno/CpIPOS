"use client";

import { useState } from "react";

export default function ItAdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        cache: "no-store"
      });
      const payload = (await response.json()) as { data?: { redirect_to?: string }; error?: { message?: string } };
      if (!response.ok || payload.error) throw new Error(payload.error?.message ?? "เข้าสู่ระบบไม่สำเร็จ");
      window.location.assign(payload.data?.redirect_to ?? "/it-admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="loginBrand">CpIPOS<small>IT CONTROL PLANE</small></div>
        <h1>ศูนย์ควบคุมระบบ</h1>
        <p>ระบบ IT แยก deployment ออกจาก POS สำหรับ Monitoring, MDM, Provisioning และ Incident Operations</p>
        <form className="form" onSubmit={submit}>
          <label>อีเมลผู้ดูแล<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>รหัสผ่าน<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error ? <div className="error">{error}</div> : null}
          <button type="submit" disabled={loading}>{loading ? "กำลังตรวจสอบ..." : "เข้าสู่ IT Control Plane"}</button>
        </form>
      </section>
    </main>
  );
}
