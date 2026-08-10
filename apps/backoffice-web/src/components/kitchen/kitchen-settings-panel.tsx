"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ZoneSetting = {
  id: string;
  zone_code: string;
  zone_name: string;
  display_order: number;
  is_active: boolean;
  kds_enabled: boolean;
  categories: string[];
  products: Array<{ id: string; name: string }>;
};

type SettingsResponse = {
  data?: { zones?: ZoneSetting[] };
  error?: { message?: string };
};

export function KitchenSettingsPanel() {
  const [zones, setZones] = useState<ZoneSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyZoneId, setBusyZoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pos/kitchen/kds-settings", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as SettingsResponse | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "โหลดการตั้งค่าครัวไม่สำเร็จ");
      setZones(body.data.zones ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดการตั้งค่าครัวไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleKds(zone: ZoneSetting) {
    if (busyZoneId) return;
    const nextEnabled = !zone.kds_enabled;
    setBusyZoneId(zone.id);
    try {
      const response = await fetch("/api/pos/kitchen/kds-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone_id: zone.id, kds_enabled: nextEnabled })
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "บันทึกการตั้งค่าครัวไม่สำเร็จ");
      setZones((current) => current.map((row) => (row.id === zone.id ? { ...row, kds_enabled: nextEnabled } : row)));
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "บันทึกการตั้งค่าครัวไม่สำเร็จ");
    } finally {
      setBusyZoneId(null);
    }
  }

  return (
    <section className="min-h-full bg-slate-100 px-5 py-5 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/preview/pos/kitchen" className="text-sm font-bold text-blue-700 hover:underline">← กลับหน้าครัว</Link>
            <h1 className="mt-2 text-2xl font-black">ตั้งค่าระบบจอครัว</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              กำหนดเป็นรายโซนครัวว่าโซนใดต้องเคลียร์งานผ่าน Kitchen Display ก่อนชำระบิลนั่งโต๊ะ
              โซนที่ปิด KDS ยังใช้การจัดเส้นทางอาหารและเครื่องพิมพ์ครัวได้ แต่จะไม่แสดงบนจอครัวและไม่บล็อกการชำระเงิน
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black shadow-sm">
            รีเฟรช
          </button>
        </header>

        {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">กำลังโหลดการตั้งค่าครัว...</div>
        ) : zones.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="font-black">ยังไม่มีโซนครัว</p>
            <p className="mt-1 text-sm text-slate-500">สร้างโซนครัวและกำหนดหมวด/สินค้าที่ส่งเข้าโซนก่อนใช้งาน KDS</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {zones.map((zone) => (
              <article key={zone.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-black">{zone.zone_name}</h2>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{zone.zone_code}</span>
                      {!zone.is_active ? <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-bold text-slate-600">ปิดโซน</span> : null}
                    </div>

                    <div className="mt-3 grid gap-2 text-sm text-slate-600">
                      <div>
                        <strong className="text-slate-800">หมวด:</strong>{" "}
                        {zone.categories.length ? zone.categories.join(", ") : "ใช้กฎสินค้า/ค่าเริ่มต้นของสาขา"}
                      </div>
                      {zone.products.length ? (
                        <div>
                          <strong className="text-slate-800">สินค้าที่กำหนดตรง:</strong>{" "}
                          {zone.products.map((product) => product.name).join(", ")}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={zone.kds_enabled}
                    disabled={Boolean(busyZoneId)}
                    onClick={() => void toggleKds(zone)}
                    className={`min-w-[210px] rounded-xl border px-4 py-3 text-left transition disabled:opacity-50 ${
                      zone.kds_enabled
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : "border-orange-300 bg-orange-50 text-orange-800"
                    }`}
                  >
                    <span className="block text-sm font-black">
                      {busyZoneId === zone.id ? "กำลังบันทึก..." : zone.kds_enabled ? "✓ ใช้ระบบจอครัว (KDS)" : "ไม่มีระบบจอครัว"}
                    </span>
                    <span className="mt-1 block text-xs font-semibold opacity-80">
                      {zone.kds_enabled ? "ต้องพร้อมเสิร์ฟก่อนเคลียร์บิล" : "ไม่ต้องรอครัวเคลียร์ก่อนชำระ"}
                    </span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
