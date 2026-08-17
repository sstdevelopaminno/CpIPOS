"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";

type Zone = {
  id: string;
  access_code: string | null;
  zone_code: string;
  zone_name: string;
  kds_enabled: boolean;
  display_order: number;
  is_active: boolean;
  default_printer_id: string | null;
  metadata?: { description?: string | null } | null;
};

type RouteRule = {
  id: string;
  zone_id: string;
  category_name: string | null;
  is_active: boolean;
};

type KitchenPrinter = {
  id: string;
  printer_name: string;
  paper_width_mm: 58 | 80;
  enabled: boolean;
};

type ConfigPayload = {
  zones: Zone[];
  routing_rules: RouteRule[];
  kitchen_printers: KitchenPrinter[];
  categories: string[];
};

type FormState = {
  zone_id: string | null;
  zone_name: string;
  zone_code: string;
  description: string;
  display_order: number;
  is_active: boolean;
  kds_enabled: boolean;
  default_printer_id: string;
  category_names: string[];
};

const emptyForm: FormState = {
  zone_id: null,
  zone_name: "",
  zone_code: "",
  description: "",
  display_order: 0,
  is_active: true,
  kds_enabled: true,
  default_printer_id: "",
  category_names: []
};

function text(lang: Language, th: string, en: string) {
  return lang === "th" ? th : en;
}

export function KitchenManagement({ lang }: { lang: Language }) {
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [kdsSavingIds, setKdsSavingIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categoriesByZone = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const rule of config?.routing_rules ?? []) {
      if (!rule.is_active || !rule.category_name) continue;
      map.set(rule.zone_id, [...(map.get(rule.zone_id) ?? []), rule.category_name]);
    }
    return map;
  }, [config]);

  const kpi = useMemo(() => {
    const zones = config?.zones ?? [];
    return {
      total: zones.length,
      active: zones.filter((zone) => zone.is_active).length,
      inactive: zones.filter((zone) => !zone.is_active).length,
      kds: zones.filter((zone) => zone.kds_enabled).length
    };
  }, [config]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 2600);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function load(options: { silent?: boolean } = {}) {
    if (!options.silent) setLoading(true);
    try {
      const response = await fetch("/api/pos/kitchen/config", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "Kitchen config failed");
      setConfig(body.data);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Kitchen config failed");
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function closeDrawer() {
    if (saving) return;
    setDrawerOpen(false);
  }

  function openAddZone() {
    setForm(emptyForm);
    setError(null);
    setDrawerOpen(true);
  }

  function editZone(zone: Zone) {
    setForm({
      zone_id: zone.id,
      zone_name: zone.zone_name,
      zone_code: zone.zone_code,
      description: zone.metadata?.description ?? "",
      display_order: zone.display_order,
      is_active: zone.is_active,
      kds_enabled: zone.kds_enabled,
      default_printer_id: zone.default_printer_id ?? "",
      category_names: categoriesByZone.get(zone.id) ?? []
    });
    setError(null);
    setDrawerOpen(true);
  }

  function toggleCategory(category: string) {
    setForm((current) => {
      const exists = current.category_names.includes(category);
      return {
        ...current,
        category_names: exists
          ? current.category_names.filter((value) => value !== category)
          : [...current.category_names, category]
      };
    });
  }

  async function toggleKds(zone: Zone) {
    if (kdsSavingIds.has(zone.id)) return;
    const nextEnabled = !zone.kds_enabled;
    setKdsSavingIds((current) => new Set(current).add(zone.id));
    setError(null);
    setConfig((current) => current ? {
      ...current,
      zones: current.zones.map((row) => row.id === zone.id ? { ...row, kds_enabled: nextEnabled } : row)
    } : current);
    try {
      const response = await fetch("/api/pos/kitchen/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "zone.kds", zone_id: zone.id, kds_enabled: nextEnabled })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.data?.zone) throw new Error(body?.error?.message ?? "Kitchen KDS update failed");
      setConfig((current) => current ? {
        ...current,
        zones: current.zones.map((row) => row.id === zone.id ? { ...row, kds_enabled: Boolean(body.data.zone.kds_enabled) } : row)
      } : current);
      if (form.zone_id === zone.id) {
        setForm((current) => ({ ...current, kds_enabled: Boolean(body.data.zone.kds_enabled) }));
      }
      setMessage(nextEnabled ? text(lang, "เปิดระบบจอครัวแล้ว", "Kitchen display enabled") : text(lang, "ปิดระบบจอครัวแล้ว", "Kitchen display disabled"));
    } catch (toggleError) {
      setConfig((current) => current ? {
        ...current,
        zones: current.zones.map((row) => row.id === zone.id ? { ...row, kds_enabled: zone.kds_enabled } : row)
      } : current);
      setError(toggleError instanceof Error ? toggleError.message : "Kitchen KDS update failed");
    } finally {
      setKdsSavingIds((current) => {
        const next = new Set(current);
        next.delete(zone.id);
        return next;
      });
    }
  }

  async function saveZone() {
    if (saving) return;
    const zoneName = form.zone_name.trim();
    const zoneCode = form.zone_code.trim().toUpperCase();
    if (!zoneName) {
      setError(text(lang, "กรุณาระบุชื่อโซนครัว", "Zone name is required"));
      return;
    }
    if (!/^[A-Z0-9_-]{1,32}$/.test(zoneCode)) {
      setError(text(lang, "รหัสโซนใช้ได้เฉพาะ A-Z, 0-9, _ และ - สูงสุด 32 ตัวอักษร", "Zone code must use A-Z, 0-9, _ or - (max 32 characters)"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/kitchen/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "zone.upsert",
          ...form,
          zone_name: zoneName,
          zone_code: zoneCode,
          default_printer_id: form.default_printer_id || null
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Kitchen zone save failed");
      setForm(emptyForm);
      setDrawerOpen(false);
      setMessage(text(lang, "บันทึกโซนครัวสำเร็จ", "Kitchen zone saved"));
      await load({ silent: true });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Kitchen zone save failed");
    } finally {
      setSaving(false);
    }
  }

  async function disableZone(zone: Zone) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/kitchen/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "zone.disable", zone_id: zone.id })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Kitchen zone disable failed");
      setMessage(text(lang, "ปิดใช้งานโซนครัวแล้ว", "Kitchen zone disabled"));
      await load({ silent: true });
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : "Kitchen zone disable failed");
    } finally {
      setSaving(false);
    }
  }

  async function rotateCode(zone: Zone) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/kitchen/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "zone.rotate_access_code", zone_id: zone.id })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Access code rotation failed");
      setMessage(text(lang, "เปลี่ยน Kitchen ID แล้ว", "Kitchen ID rotated"));
      await load({ silent: true });
    } catch (rotateError) {
      setError(rotateError instanceof Error ? rotateError.message : "Access code rotation failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 text-slate-950">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 overflow-hidden p-3 sm:p-5">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div>
            <Link href="/preview/pos/more" className="text-sm font-bold text-slate-500">&lt; {text(lang, "กลับเมนูเพิ่มเติม", "Back to More")}</Link>
            <h1 className="mt-1 text-2xl font-black">{text(lang, "จัดการครัว", "Kitchen Management")}</h1>
          </div>
          <button type="button" onClick={openAddZone} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-black text-white">
            + {text(lang, "เพิ่มโซนครัว", "Add Kitchen Zone")}
          </button>
        </header>

        <section className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [text(lang, "โซนครัวทั้งหมด", "Total zones"), kpi.total],
            [text(lang, "เปิดใช้งาน", "Active"), kpi.active],
            [text(lang, "ปิดใช้งาน", "Inactive"), kpi.inactive],
            [text(lang, "เปิดระบบจอครัว", "KDS enabled"), kpi.kds]
          ].map(([label, value]) => (
            <div key={label} className="border border-slate-200 bg-white px-4 py-3">
              <div className="text-xs font-bold text-slate-500">{label}</div>
              <div className="mt-1 text-2xl font-black">{value}</div>
            </div>
          ))}
        </section>

        {error ? <div className="shrink-0 border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700" role="alert">{error}</div> : null}

        <section className="min-h-0 flex-1 overflow-hidden border border-slate-200 bg-white">
          <div className="h-full overflow-auto">
            <table className="min-w-[980px] w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Kitchen ID", text(lang, "ชื่อโซน", "Zone"), text(lang, "รหัสโซน", "Code"), text(lang, "หมวดหมู่อาหาร", "Categories"), "KDS", text(lang, "เครื่องพิมพ์", "Printer"), text(lang, "สถานะ", "Status"), text(lang, "แก้ไข", "Edit"), text(lang, "ลบ/ปิดใช้งาน", "Disable")].map((head) => (
                    <th key={head} className="border-b border-slate-200 px-3 py-2 font-black">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-3 py-12 text-center font-bold text-slate-500">{text(lang, "กำลังโหลด...", "Loading...")}</td></tr>
                ) : (config?.zones ?? []).length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-12 text-center font-bold text-slate-500">{text(lang, "ยังไม่มีโซนครัว", "No kitchen zones")}</td></tr>
                ) : (config?.zones ?? []).map((zone) => {
                  const printer = config?.kitchen_printers.find((item) => item.id === zone.default_printer_id);
                  const kdsSaving = kdsSavingIds.has(zone.id);
                  return (
                    <tr key={zone.id} className="border-b border-slate-100">
                      <td className="px-3 py-3 font-mono font-black">{zone.access_code ?? "-"}</td>
                      <td className="px-3 py-3 font-bold">{zone.zone_name}</td>
                      <td className="px-3 py-3 font-mono">{zone.zone_code}</td>
                      <td className="px-3 py-3">{(categoriesByZone.get(zone.id) ?? []).join(", ") || "-"}</td>
                      <td className="px-3 py-3">
                        <label className="inline-flex cursor-pointer items-center gap-2 font-bold">
                          <input
                            type="checkbox"
                            checked={zone.kds_enabled}
                            disabled={kdsSaving || !zone.is_active}
                            onChange={() => void toggleKds(zone)}
                          />
                          <span>{kdsSaving ? text(lang, "กำลังบันทึก...", "Saving...") : zone.kds_enabled ? "ON" : "OFF"}</span>
                        </label>
                      </td>
                      <td className="px-3 py-3">{printer ? `${printer.printer_name} (${printer.paper_width_mm}mm)` : "-"}</td>
                      <td className="px-3 py-3">{zone.is_active ? text(lang, "เปิด", "Active") : text(lang, "ปิด", "Inactive")}</td>
                      <td className="px-3 py-3"><button type="button" onClick={() => editZone(zone)} className="rounded-md border border-slate-300 px-3 py-1.5 font-bold">{text(lang, "แก้ไข", "Edit")}</button></td>
                      <td className="px-3 py-3">
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void rotateCode(zone)} disabled={saving} className="rounded-md border border-slate-300 px-3 py-1.5 font-bold disabled:opacity-50">ID</button>
                          <button type="button" onClick={() => void disableZone(zone)} disabled={saving || !zone.is_active} className="rounded-md border border-red-200 px-3 py-1.5 font-bold text-red-700 disabled:opacity-50">{text(lang, "ปิด", "Disable")}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {message ? (
        <div className="fixed right-4 top-4 z-[60] rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 shadow-lg" role="status">
          {message}
        </div>
      ) : null}

      {drawerOpen ? (
        <>
          <button type="button" aria-label={text(lang, "ปิดฟอร์มจัดการครัว", "Close Kitchen form")} onClick={closeDrawer} className="fixed inset-0 z-40 bg-slate-950/35" />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={form.zone_id ? text(lang, "แก้ไขโซนครัว", "Edit Kitchen Zone") : text(lang, "เพิ่มโซนครัว", "Add Kitchen Zone")}>
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-black">{form.zone_id ? text(lang, "แก้ไขโซนครัว", "Edit Kitchen Zone") : text(lang, "เพิ่มโซนครัว", "Add Kitchen Zone")}</h2>
              <button type="button" onClick={closeDrawer} disabled={saving} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-black disabled:opacity-50">{text(lang, "ปิด", "Close")}</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-3">
                <label className="grid gap-1 text-sm font-bold">{text(lang, "ชื่อโซนครัว", "Zone name")}<input className="rounded-md border border-slate-300 px-3 py-2" value={form.zone_name} onChange={(e) => setForm({ ...form, zone_name: e.target.value })} /></label>
                <label className="grid gap-1 text-sm font-bold">{text(lang, "รหัสโซน", "Zone code")}<input className="rounded-md border border-slate-300 px-3 py-2 uppercase" value={form.zone_code} maxLength={32} onChange={(e) => setForm({ ...form, zone_code: e.target.value.toUpperCase() })} /></label>
                <label className="grid gap-1 text-sm font-bold">{text(lang, "คำอธิบาย", "Description")}<input className="rounded-md border border-slate-300 px-3 py-2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
                <label className="grid gap-1 text-sm font-bold">{text(lang, "เครื่องพิมพ์หลัก", "Default printer")}
                  <select className="rounded-md border border-slate-300 px-3 py-2" value={form.default_printer_id} onChange={(e) => setForm({ ...form, default_printer_id: e.target.value })}>
                    <option value="">-</option>
                    {(config?.kitchen_printers ?? []).filter((printer) => printer.enabled).map((printer) => <option key={printer.id} value={printer.id}>{printer.printer_name} ({printer.paper_width_mm}mm)</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-bold">{text(lang, "ลำดับแสดงผล", "Display order")}<input type="number" className="rounded-md border border-slate-300 px-3 py-2" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) || 0 })} /></label>
                <div className="grid gap-2">
                  <span className="text-sm font-black">{text(lang, "หมวดหมู่อาหาร", "Categories")}</span>
                  <div className="grid max-h-52 gap-2 overflow-auto border border-slate-200 p-2">
                    {(config?.categories ?? []).length === 0 ? <span className="text-sm font-semibold text-slate-400">-</span> : null}
                    {(config?.categories ?? []).map((category) => (
                      <label key={category} className="flex items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" checked={form.category_names.includes(category)} onChange={() => toggleCategory(category)} />
                        <span>{category}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.kds_enabled} onChange={(e) => setForm({ ...form, kds_enabled: e.target.checked })} />{text(lang, "เปิดระบบจอครัว", "KDS enabled")}</label>
                <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />{text(lang, "เปิดใช้งานโซน", "Zone active")}</label>
              </div>
            </div>
            <footer className="shrink-0 border-t border-slate-200 p-5">
              <button type="button" onClick={() => void saveZone()} disabled={saving || !form.zone_name.trim() || !form.zone_code.trim()} className="w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
                {saving ? text(lang, "กำลังบันทึก...", "Saving...") : text(lang, "บันทึก", "Save")}
              </button>
            </footer>
          </aside>
        </>
      ) : null}
    </main>
  );
}
