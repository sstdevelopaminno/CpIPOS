"use client";

import { LoadingDialog } from "@/components/auth/loading-dialog";
import { Monitor, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type Device = {
  id: string;
  device_code: string | null;
  device_name: string | null;
  device_type: string | null;
  status: string | null;
};

function statusText(status: string | null) {
  const normalized = String(status ?? "active").toLowerCase();
  if (normalized === "active" || normalized === "available" || normalized === "online") return "พร้อมใช้งาน";
  return status ?? "พร้อมใช้งาน";
}

function networkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message)) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจว่า npm run dev ยังเปิดอยู่ แล้วลองใหม่";
  }
  return error instanceof Error ? error.message : fallback;
}

export function DeviceSelector({ branchName, devices }: { branchName: string; devices: Device[] }) {
  const router = useRouter();
  const navigationWatchdogRef = useRef<number | null>(null);
  const [selectedId, setSelectedId] = useState(devices[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedDevice = useMemo(() => devices.find((device) => device.id === selectedId), [devices, selectedId]);
  const canSubmit = Boolean(selectedDevice) && !loading;

  useEffect(() => {
    return () => {
      if (navigationWatchdogRef.current) window.clearTimeout(navigationWatchdogRef.current);
    };
  }, []);

  async function submit() {
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    let keepLoadingForNavigation = false;
    try {
      const res = await fetch("/api/auth/devices/select", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({ deviceId: selectedId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "เลือกเครื่องแคชเชียร์ไม่สำเร็จ");
      keepLoadingForNavigation = true;
      window.location.assign(json.data.redirectTo);
      navigationWatchdogRef.current = window.setTimeout(() => {
        setLoading(false);
        setError("การเปลี่ยนหน้าช้ากว่าปกติ กรุณากดเปิดแคชอีกครั้ง");
      }, 10_000);
    } catch (err) {
      setError(networkErrorMessage(err, "เลือกเครื่องแคชเชียร์ไม่สำเร็จ"));
    } finally {
      if (!keepLoadingForNavigation) setLoading(false);
    }
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#17416f]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#bcd5f5] bg-[#eef6ff]">
            <Store className="h-5 w-5" />
          </span>
          <span>สาขา: {branchName}</span>
        </div>

        <section className="rounded-xl border border-[#c9dbf2] bg-white p-3">
          <h2 className="mb-3 text-base font-bold text-[#0f2745]">เลือกเครื่องแคชเชียร์</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {devices.map((device) => {
              const active = device.id === selectedId;
              return (
                <button
                  key={device.id}
                  type="button"
                  className={`min-h-[132px] touch-manipulation rounded-xl border p-3 text-left transition active:scale-[0.99] disabled:opacity-60 ${
                    active ? "border-[#1677ff] bg-[#eef6ff] shadow-sm" : "border-[#c9dbf2] bg-white"
                  }`}
                  onClick={() => setSelectedId(device.id)}
                  disabled={loading}
                >
                  <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-[#bcd5f5] bg-white text-[#1f6fd1]">
                    <Monitor className="h-5 w-5" />
                  </span>
                  <span className="block text-sm font-semibold text-[#0f2745]">{device.device_name ?? "เครื่องขาย"}</span>
                  <span className="mt-1 block text-sm text-[#0f2745]">
                    รหัสเครื่อง <b>{device.device_code ?? "-"}</b>
                  </span>
                  <span className="mt-3 inline-flex rounded-full border border-[#9dd8b5] bg-[#ecfff3] px-2 py-1 text-xs font-semibold text-[#13713a]">
                    {statusText(device.status)}
                  </span>
                </button>
              );
            })}
          </div>
          {devices.length === 0 ? <p className="text-sm text-slate-500">ไม่พบเครื่องแคชเชียร์ที่พร้อมใช้งานสำหรับสาขานี้</p> : null}
        </section>

        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="touch-manipulation rounded-xl border border-[#bcd5f5] bg-white px-4 py-3 text-sm font-semibold text-[#17416f]" onClick={() => router.push("/login/employee")} disabled={loading}>
            ย้อนกลับ
          </button>
          <button
            type="button"
            className={`touch-manipulation rounded-xl px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed ${canSubmit ? "bg-[#1677d9] hover:bg-[#075fbb]" : "bg-[#aacdf3] opacity-80"}`}
            onClick={submit}
            disabled={!canSubmit}
          >
            {loading ? "กำลังเปิดแคช..." : "เปิดแคช"}
          </button>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <LoadingDialog open={loading} title="กำลังเปิดแคช" message="กำลังเปิดเครื่องแคชเชียร์และเข้าสู่ระบบ POS..." />
    </>
  );
}
