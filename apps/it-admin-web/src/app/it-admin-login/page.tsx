"use client";

import { useState } from "react";
import styles from "./it-login.module.css";

export default function ItAdminLoginPage() {
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
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
        body: JSON.stringify({ code }),
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
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.language} aria-label="ภาษา"><span className={styles.active}>ไทย</span><span>EN</span></div>

        <div className={styles.brand}>
          <img className={styles.symbol} src="/brand/cpipos-symbol-user.svg" alt="CpIPOS" />
          <div className={styles.brandName}>Cp<b>IPOS</b></div>
          <div className={styles.brandSub}>IT CONTROL PLANE</div>
        </div>

        <form className={styles.form} onSubmit={submit}>
          <label className={styles.label}>รหัส IT
            <div className={styles.inputWrap}>
              <span className={styles.icon}>⌘</span>
              <input
                className={styles.input}
                type={showCode ? "text" : "password"}
                inputMode="numeric"
                autoComplete="current-password"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 12))}
                minLength={4}
                maxLength={12}
                placeholder="กรอกรหัส IT"
                autoFocus
                required
              />
              <button className={styles.eye} type="button" onClick={() => setShowCode((current) => !current)} aria-label={showCode ? "ซ่อนรหัส" : "แสดงรหัส"}>{showCode ? "◉" : "◎"}</button>
            </div>
          </label>

          <div className={styles.hint}><span>{code.length}/12</span><span>IT Admin / IT Support เท่านั้น</span></div>
          {error ? <div className={styles.error}>{error}</div> : null}
          <button className={styles.button} type="submit" disabled={loading || code.length < 4}>{loading ? "กำลังตรวจสอบ..." : "ล็อกอิน"}</button>
        </form>

        <div className={styles.security}>Protected IT Control Plane · Session 8 ชั่วโมง · จำกัดการลองรหัสผิดอัตโนมัติ</div>
      </section>
    </main>
  );
}
