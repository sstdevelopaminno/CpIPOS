"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./platform-login.module.css";

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
      const response = await fetch("/api/it-admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        cache: "no-store"
      });
      const payload = (await response.json()) as { data?: { redirect_to?: string }; error?: { message?: string } };
      if (!response.ok || payload.error) throw new Error(payload.error?.message ?? "เข้าสู่ระบบไม่สำเร็จ");
      window.location.assign(payload.data?.redirect_to ?? "/it-admin");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.brand}>
          <Image src="/brand/cpipos-symbol-transparent.png" alt="CpIPOS" width={58} height={58} priority />
          <div><strong>CpIPOS</strong><span>CONTROL PLANE</span></div>
        </div>
        <div className={styles.heading}>
          <span>SECURE PLATFORM ACCESS</span>
          <h1>ศูนย์ควบคุมระบบ</h1>
          <p>สำหรับ IT Admin และทีม Support ที่ได้รับสิทธิ์เท่านั้น ระบบหลังบ้านแยกการยืนยันตัวตนออกจาก POS Session โดยสมบูรณ์</p>
        </div>
        <form onSubmit={submit} className={styles.form}>
          <label>อีเมลผู้ดูแล<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>รหัสผ่าน<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error ? <div className={styles.error}>{error}</div> : null}
          <button type="submit" disabled={loading}>{loading ? "กำลังตรวจสอบ..." : "เข้าสู่ Control Plane"}</button>
        </form>
        <div className={styles.security}><span /> Platform Auth · RBAC · Audit Protected</div>
      </section>
    </main>
  );
}
