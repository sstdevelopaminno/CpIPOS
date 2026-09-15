"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cacheBranches, clearPreEntryClientCache } from "@/lib/pre-entry-client-cache";

type VerifyResponse = {
  data?: {
    next_step: "branches" | "employee";
    branches?: Array<{ id: string; code: string | null; name: string | null; address?: string | null }>;
  } | null;
  error?: { code?: string; message?: string } | null;
};

function normalizeStoreCode(value: string) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

export function TenantPosLaunch({ storeCode }: { storeCode: string }) {
  const router = useRouter();
  const normalizedStoreCode = useMemo(() => normalizeStoreCode(storeCode), [storeCode]);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!normalizedStoreCode) {
      setError("ไม่พบรหัสร้านสำหรับเปิด POS");
      return;
    }

    const controller = new AbortController();
    setError(null);
    clearPreEntryClientCache();

    void (async () => {
      try {
        const response = await fetch("/api/auth/store-code/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ store_code: normalizedStoreCode }),
          signal: controller.signal
        });
        const body = (await response.json().catch(() => null)) as VerifyResponse | null;
        if (!response.ok || !body?.data) {
          setError(body?.error?.message ?? "ไม่สามารถเปิด POS ของร้านนี้ได้");
          return;
        }

        cacheBranches(body.data.branches ?? []);
        const flow = body.data.next_step === "employee" ? "single" : "multi";
        router.replace(body.data.next_step === "employee" ? `/login/employee?flow=${flow}` : `/login/branches?flow=${flow}`);
      } catch (launchError) {
        if (controller.signal.aborted) return;
        setError(launchError instanceof Error ? launchError.message : "ไม่สามารถเชื่อมต่อ POS ได้");
      }
    })();

    return () => controller.abort();
  }, [normalizedStoreCode, retryKey, router]);

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#f4f7fb" }}>
      <section style={{ width: "min(520px, 100%)", border: "1px solid #dbe5f1", borderRadius: 20, background: "#fff", padding: 28, boxShadow: "0 24px 70px rgba(18,48,83,.14)", display: "grid", gap: 14 }}>
        <span style={{ color: "#6480a4", fontSize: 12, fontWeight: 800, letterSpacing: ".1em" }}>TENANT POS LAUNCH</span>
        <h1 style={{ margin: 0, color: "#15375f", fontSize: 26 }}>กำลังเปิด POS ของร้าน</h1>
        <p style={{ margin: 0, color: "#6e8096", lineHeight: 1.7 }}>Store Code: <strong style={{ color: "#214f82" }}>{normalizedStoreCode || "—"}</strong></p>
        {!error ? <p style={{ margin: 0, color: "#4270a8" }}>กำลังตรวจสอบร้านและสาขากับระบบกลาง…</p> : (
          <div style={{ display: "grid", gap: 12, border: "1px solid #efc9c9", borderRadius: 12, background: "#fff7f7", padding: 14 }}>
            <strong style={{ color: "#9b3535" }}>เปิด POS ไม่สำเร็จ</strong>
            <span style={{ color: "#7f5151", lineHeight: 1.6 }}>{error}</span>
            <button type="button" onClick={() => setRetryKey((value) => value + 1)} style={{ justifySelf: "start", border: 0, borderRadius: 10, background: "#2f6ef4", color: "#fff", padding: "10px 16px", fontWeight: 800, cursor: "pointer" }}>ลองใหม่</button>
          </div>
        )}
      </section>
    </main>
  );
}
