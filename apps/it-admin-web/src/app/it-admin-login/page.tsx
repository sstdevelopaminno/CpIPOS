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
      <section className="loginVisual">
        <div>
          <div className="brandBlock" style={{padding:0}}>
            <div className="brandMark">CP</div>
            <div><div className="brandName">CpIPOS</div><div className="brandSub">IT CONTROL PLANE</div></div>
          </div>
          <h1>ควบคุมระบบทั้งหมด<br/>โดยไม่แตะ POS Production</h1>
          <p>Monitoring, Store Registry, MDM และ Incident Operations อยู่บน deployment แยก เพื่อให้ทีม IT ปรับปรุงหน้าจอและเครื่องมือได้โดยไม่ทำให้ระบบขายหน้าร้านถูก build หรือ deploy ตามไปด้วย</p>
        </div>
        <div className="loginPoints"><span>Separate Vercel Project</span><span>Exact-device MDM</span><span>Scoped access</span><span>Audit-ready</span></div>
      </section>

      <section className="loginPanel">
        <div className="loginCard">
          <div className="loginBrand"><div className="loginBrandMark">CP</div><div><strong>CpIPOS IT</strong><small>CONTROL PLANE ACCESS</small></div></div>
          <h2>เข้าสู่ระบบผู้ดูแล</h2>
          <p>สำหรับบัญชี IT Admin / IT Support ที่ได้รับสิทธิ์เท่านั้น</p>
          <form className="form" onSubmit={submit}>
            <label>อีเมลผู้ดูแล<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="admin@company.com" /></label>
            <label>รหัสผ่าน<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" /></label>
            {error ? <div className="error">{error}</div> : null}
            <button type="submit" disabled={loading}>{loading ? "กำลังตรวจสอบสิทธิ์..." : "เข้าสู่ IT Control Plane"}</button>
          </form>
        </div>
      </section>
    </main>
  );
}
