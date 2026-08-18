"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const NATIVE_ANDROID_POS_PATTERN = /CpIPOS-AndroidPOS\/(\d+\.\d+\.\d+)/i;
const POLICY_URL = "/api/android-pos/update-policy";
const POLICY_CACHE_KEY = "cpipos_android_pos_update_policy_v1";
const POLICY_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
// A mandatory update is still checked immediately on mount/foreground. While the app stays
// continuously visible, two minutes is frequent enough without keeping a fixed 45s HTTP loop.
const POLICY_REFRESH_MS = 2 * 60 * 1000;

type UpdatePolicy = {
  ok: boolean;
  platform: string;
  latestVersion?: string;
  requiredVersion?: string;
  forceUpdate?: boolean;
  releaseReady?: boolean;
  downloadUrl?: string;
  releaseUpdatedAt?: string | null;
};

type CachedPolicy = {
  cachedAt: number;
  policy: UpdatePolicy;
};

function parseVersion(value: string) {
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts as [number, number, number];
}

function compareVersions(left: string, right: string) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function nativeAndroidPosVersion() {
  if (typeof window === "undefined") return null;
  const match = window.navigator.userAgent.match(NATIVE_ANDROID_POS_PATTERN);
  return match?.[1] ?? null;
}

function readCachedPolicy() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(POLICY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPolicy;
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > POLICY_CACHE_MAX_AGE_MS) return null;
    return parsed.policy;
  } catch {
    return null;
  }
}

function cachePolicy(policy: UpdatePolicy) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      POLICY_CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), policy } satisfies CachedPolicy)
    );
  } catch {
    // localStorage can be unavailable on restricted WebView profiles. The live policy still works.
  }
}

export function AndroidPosMandatoryUpdate() {
  const currentVersion = useMemo(() => nativeAndroidPosVersion(), []);
  const [policy, setPolicy] = useState<UpdatePolicy | null>(null);
  const [checking, setChecking] = useState(Boolean(currentVersion));
  const [downloadStarted, setDownloadStarted] = useState(false);
  const policyCheckInFlightRef = useRef(false);

  const refreshPolicy = useCallback(async () => {
    if (!currentVersion || policyCheckInFlightRef.current) return;
    policyCheckInFlightRef.current = true;
    setChecking(true);
    try {
      const response = await fetch(POLICY_URL, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`update_policy_${response.status}`);
      const nextPolicy = (await response.json()) as UpdatePolicy;
      if (nextPolicy.ok && nextPolicy.releaseReady && nextPolicy.requiredVersion) {
        cachePolicy(nextPolicy);
        setPolicy(nextPolicy);
      } else {
        setPolicy(null);
      }
    } catch {
      setPolicy(readCachedPolicy());
    } finally {
      policyCheckInFlightRef.current = false;
      setChecking(false);
    }
  }, [currentVersion]);

  useEffect(() => {
    if (!currentVersion) return;
    void refreshPolicy();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPolicy();
    }, POLICY_REFRESH_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshPolicy();
    };
    window.addEventListener("focus", refreshPolicy);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshPolicy);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [currentVersion, refreshPolicy]);

  if (!currentVersion || !policy?.forceUpdate || !policy.requiredVersion) return null;
  if (compareVersions(currentVersion, policy.requiredVersion) >= 0) return null;

  const downloadUrl = policy.downloadUrl || "/download/android/latest";

  return (
    <div
      className="fixed inset-0 z-[2147483647] grid place-items-center overflow-y-auto bg-slate-950/95 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cpipos-android-update-title"
    >
      <div className="w-full max-w-xl rounded-3xl border border-amber-400/30 bg-slate-900 p-6 shadow-2xl shadow-black/60 sm:p-8">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-400/15 text-3xl" aria-hidden="true">
          ↻
        </div>
        <div className="mt-5 text-center">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">Mandatory Android POS Update</p>
          <h1 id="cpipos-android-update-title" className="mt-3 text-2xl font-black text-white sm:text-3xl">
            ต้องอัปเดต CpIPOS ก่อนใช้งานต่อ
          </h1>
          <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">
            เครื่องนี้กำลังใช้ Android POS เวอร์ชันเก่า ระบบจะเปิด POS ให้ใช้งานอีกครั้งหลังติดตั้งเวอร์ชัน Stable ล่าสุดสำเร็จ
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-center text-sm">
          <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
            <p className="text-xs text-slate-500">เวอร์ชันในเครื่อง</p>
            <p className="mt-1 font-black text-rose-300">{currentVersion}</p>
          </div>
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
            <p className="text-xs text-slate-500">เวอร์ชันที่ต้องใช้</p>
            <p className="mt-1 font-black text-emerald-300">{policy.requiredVersion}</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-sky-400/20 bg-sky-400/5 p-4 text-sm leading-6 text-slate-300">
          <strong className="text-sky-200">ขั้นตอน:</strong> กดปุ่มด้านล่าง → ดาวน์โหลด APK → เปิดไฟล์ที่ดาวน์โหลด → กดติดตั้ง/อัปเดต → เปิด CpIPOS ใหม่
        </div>

        <a
          href={downloadUrl}
          onClick={() => setDownloadStarted(true)}
          className="mt-6 inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-amber-400 px-5 py-3 text-center text-base font-black text-slate-950 shadow-lg shadow-amber-950/30 transition hover:bg-amber-300 active:scale-[0.99]"
        >
          {downloadStarted ? `ดาวน์โหลดอีกครั้ง · Android POS ${policy.requiredVersion}` : `ดาวน์โหลดและติดตั้ง Android POS ${policy.requiredVersion}`}
        </a>

        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
          <span className={`h-2 w-2 rounded-full ${checking ? "bg-amber-300" : "bg-emerald-400"}`} />
          {checking ? "กำลังตรวจสอบเวอร์ชัน Stable ล่าสุด…" : "ระบบตรวจเวอร์ชันอัตโนมัติทุก 2 นาที และตรวจทันทีเมื่อกลับเข้าแอป"}
        </div>
        <p className="mt-3 text-center text-xs leading-5 text-slate-500">
          หน้าต่างนี้ปิดไม่ได้เพื่อป้องกันการใช้งาน POS ด้วยเวอร์ชันที่ต่ำกว่ามาตรฐาน หลังติดตั้งสำเร็จและเปิดแอปใหม่ ระบบจะปลดล็อกอัตโนมัติ
        </p>
      </div>
    </div>
  );
}
