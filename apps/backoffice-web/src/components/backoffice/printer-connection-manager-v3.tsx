"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./printer-connection-manager-v3.module.css";

type Mode = "lan" | "usb" | "bluetooth";
type Purpose = "receipt" | "kitchen" | "drink" | "bar" | "reprint" | "shift_report" | "payment_slip" | "cash_drawer";
type ZonedPurpose = "kitchen" | "drink" | "bar";
type Assignment = { id: string; purpose: Purpose; zone_key: string; is_enabled: boolean; is_default: boolean; copies: number };
type KitchenZone = { id: string; zone_code: string; zone_name: string; display_order: number; is_active: boolean; default_printer_id: string | null };
type Device = {
  id: string;
  printer_profile_id: string | null;
  display_name: string;
  brand: string | null;
  model: string | null;
  connection_mode: Mode;
  paper_width_mm: 58 | 80;
  runtime_device_code: string | null;
  status: string;
  capabilities: Record<string, unknown>;
  last_seen_at: string | null;
  disconnected_at: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  printer_device_assignments: Assignment[];
  ip_address: string | null;
  port: number | null;
  profile_enabled: boolean;
};
type History = {
  id: string;
  printer_profile_id: string | null;
  event_type: string;
  device_name: string;
  brand: string | null;
  model: string | null;
  connection_mode: Mode | null;
  paper_width_mm: number | null;
  created_at: string;
  can_reconnect: boolean;
};
type Registry = {
  branch: { id: string; code: string | null; name: string | null };
  devices: Device[];
  history: History[];
  kitchen_zones: KitchenZone[];
};
type Candidate = { id: string; name: string; mode: Mode; paper_width_mm: 58 | 80; source: string; status: string; runtime_device_code: string | null; printer_profile_id: string | null; functions: string[]; helper: string };
type Discovery = { items: Candidate[]; note: string };
type Envelope<T> = { data?: T; error?: { message?: string } };

const modeCards: Array<{ mode: Mode; title: string; icon: string; desc: string; help: string }> = [
  { mode: "lan", title: "LAN", icon: "▣", desc: "เชื่อมต่อผ่านเครือข่ายร้าน", help: "เหมาะกับครัวและเครื่องพิมพ์ประจำจุด" },
  { mode: "usb", title: "USB", icon: "⌁", desc: "ต่อสายตรงกับเครื่อง POS", help: "แนะนำสำหรับแคชเชียร์และลิ้นชัก" },
  { mode: "bluetooth", title: "Bluetooth", icon: "ᛒ", desc: "เชื่อมต่อไร้สายใกล้เครื่อง", help: "เหมาะกับ Android และจุดขายเคลื่อนที่" }
];
const purposes: Array<{ value: Purpose; label: string }> = [
  { value: "receipt", label: "ใบเสร็จหน้าขาย" },
  { value: "kitchen", label: "ครัว" },
  { value: "drink", label: "เครื่องดื่ม" },
  { value: "bar", label: "บาร์" },
  { value: "reprint", label: "ใบเสร็จย้อนหลัง" },
  { value: "shift_report", label: "ปิดกะ / รายงานกะ" },
  { value: "payment_slip", label: "สลิปชำระเงิน" },
  { value: "cash_drawer", label: "ลิ้นชักเงินสด" }
];
const zonedPurposes: ZonedPurpose[] = ["kitchen", "drink", "bar"];
const PAGE_SIZE = 5;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as Envelope<T> & T;
  if (!response.ok || body.error) throw new Error(body.error?.message ?? "ดำเนินการไม่สำเร็จ");
  return (body.data ?? body) as T;
}

function fmt(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}

function purposeLabel(value: Purpose) {
  return purposes.find((item) => item.value === value)?.label ?? value;
}

function statusClass(status: string) {
  return status === "online" ? styles.dotOnline : status === "offline" || status === "disconnected" ? styles.dotOffline : styles.dotWarn;
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    online: "ออนไลน์",
    offline: "ออฟไลน์",
    checking: "กำลังตรวจสอบ",
    connecting: "กำลังเชื่อมต่อ",
    needs_check: "ต้องตรวจสอบ",
    disabled: "ปิดใช้งาน",
    disconnected: "ยกเลิกการเชื่อมต่อ"
  };
  return map[status] ?? status;
}

function historyLabel(eventType: string) {
  const map: Record<string, string> = {
    connected: "เชื่อมต่อ",
    reconnected: "เชื่อมต่อใหม่",
    updated: "แก้ไขการตั้งค่า",
    status_changed: "เปลี่ยนสถานะ",
    disconnected: "ยกเลิกการเชื่อมต่อ",
    deleted: "ลบเครื่อง",
    test_print_requested: "พิมพ์ทดสอบ",
    test_print_failed: "พิมพ์ทดสอบไม่สำเร็จ",
    drawer_test_requested: "ทดสอบลิ้นชัก",
    drawer_test_failed: "ทดสอบลิ้นชักไม่สำเร็จ"
  };
  return map[eventType] ?? eventType;
}

function emptyZoneSelections(): Record<ZonedPurpose, string[]> {
  return { kitchen: [], drink: [], bar: [] };
}

export function PrinterConnectionManagerV3() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [mode, setMode] = useState<Mode>("lan");
  const [purposeFilter, setPurposeFilter] = useState<Purpose | "all">("all");
  const [page, setPage] = useState(1);
  const [discovering, setDiscovering] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [paper, setPaper] = useState<58 | 80>(58);
  const [selectedPurposes, setSelectedPurposes] = useState<Purpose[]>(["receipt"]);
  const [zoneSelections, setZoneSelections] = useState<Record<ZonedPurpose, string[]>>(emptyZoneSelections());
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("9100");
  const [runtimeCode, setRuntimeCode] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setRegistry(await api<Registry>("/api/backoffice/printers/devices"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => (registry?.devices ?? []).filter((device) => {
    if (purposeFilter === "all") return true;
    return device.printer_device_assignments.some((assignment) => assignment.is_enabled && assignment.purpose === purposeFilter);
  }), [registry, purposeFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const zoneNameByCode = useMemo(() => new Map((registry?.kitchen_zones ?? []).map((zone) => [zone.zone_code.toUpperCase(), zone.zone_name])), [registry]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function resetForm(nextMode: Mode = mode) {
    setEditId(null);
    setMode(nextMode);
    setName("");
    setBrand("");
    setModel("");
    setPaper(58);
    setSelectedPurposes(["receipt"]);
    setZoneSelections(emptyZoneSelections());
    setIp("");
    setPort("9100");
    setRuntimeCode("");
  }

  function applyCandidate(item: Candidate) {
    setEditId(null);
    setMode(item.mode);
    setName(item.name);
    setModel(item.name);
    setPaper(item.paper_width_mm);
    setRuntimeCode(item.runtime_device_code ?? "");
    setIp("");
    setPort("9100");
    setZoneSelections(emptyZoneSelections());
    const fromCandidate = item.functions.filter((value): value is Purpose => purposes.some((candidatePurpose) => candidatePurpose.value === value));
    setSelectedPurposes(fromCandidate.length ? fromCandidate : ["receipt"]);
    setNotice(`เลือก ${item.name} แล้ว ตรวจสอบหน้าที่ใช้งานและกดบันทึก`);
    document.getElementById("printer-v3-config")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function edit(device: Device) {
    setEditId(device.printer_profile_id);
    setMode(device.connection_mode);
    setName(device.display_name);
    setBrand(device.brand ?? "");
    setModel(device.model ?? "");
    setPaper(device.paper_width_mm);
    const enabledAssignments = device.printer_device_assignments.filter((assignment) => assignment.is_enabled);
    setSelectedPurposes(Array.from(new Set(enabledAssignments.map((assignment) => assignment.purpose))));
    const nextZones = emptyZoneSelections();
    for (const purpose of zonedPurposes) {
      nextZones[purpose] = Array.from(new Set(enabledAssignments.filter((assignment) => assignment.purpose === purpose && assignment.zone_key).map((assignment) => assignment.zone_key.toUpperCase())));
    }
    setZoneSelections(nextZones);
    setRuntimeCode(device.runtime_device_code ?? "");
    setIp(device.ip_address ?? "");
    setPort(String(device.port ?? 9100));
    document.getElementById("printer-v3-config")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function togglePurpose(value: Purpose) {
    setSelectedPurposes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function toggleZone(purpose: ZonedPurpose, zoneCode: string) {
    const normalized = zoneCode.toUpperCase();
    setZoneSelections((current) => ({
      ...current,
      [purpose]: current[purpose].includes(normalized)
        ? current[purpose].filter((value) => value !== normalized)
        : [...current[purpose], normalized]
    }));
  }

  function buildAssignments() {
    return selectedPurposes.flatMap((purpose) => {
      if (purpose === "kitchen" || purpose === "drink" || purpose === "bar") {
        const zones = zoneSelections[purpose];
        if (zones.length > 0) return zones.map((zoneKey) => ({ purpose, zone_key: zoneKey, is_default: true, copies: 1 }));
      }
      return [{ purpose, zone_key: "", is_default: false, copies: 1 }];
    });
  }

  async function discover() {
    setDiscovering(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api<Discovery>(`/api/backoffice/printers/discover?mode=${mode}`);
      setCandidates(data.items);
      setNotice(data.note || `ค้นหา ${mode.toUpperCase()} เสร็จแล้ว`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ค้นหาอุปกรณ์ไม่สำเร็จ");
    } finally {
      setDiscovering(false);
    }
  }

  async function save() {
    setError(null);
    setNotice(null);
    if (!name.trim()) {
      setError("กรุณาตั้งชื่อเครื่องพิมพ์");
      return;
    }
    if (!selectedPurposes.length) {
      setError("กรุณาเลือกอย่างน้อย 1 หน้าที่");
      return;
    }
    if (mode === "lan" && !ip.trim()) {
      setError("LAN ต้องระบุ IP ในตั้งค่าขั้นสูง");
      return;
    }
    setBusy("save");
    try {
      const payload = {
        printer_id: editId,
        printer_name: name.trim(),
        brand: brand.trim() || null,
        model: model.trim() || null,
        connection_mode: mode,
        paper_width_mm: paper,
        purposes: selectedPurposes,
        assignments: buildAssignments(),
        ip_address: ip.trim() || null,
        port: Number(port || 9100),
        runtime_device_code: runtimeCode.trim() || null,
        enabled: true
      };
      await api("/api/backoffice/printers/devices", { method: editId ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setNotice(editId ? "อัปเดตเครื่องพิมพ์และเส้นทางพิมพ์แล้ว" : "เชื่อมต่อ บันทึก และตั้งเส้นทางพิมพ์แล้ว");
      resetForm(mode);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function reconnectPrinter(printerId: string, key: string) {
    setBusy(`reconnect:${key}`);
    setError(null);
    setNotice(null);
    try {
      await api("/api/backoffice/printers/devices", {
        method: "PATCH",
        body: JSON.stringify({ printer_id: printerId, action: "reconnect" })
      });
      setNotice("เชื่อมต่อเครื่องพิมพ์ใหม่แล้ว ระบบเปิด profile สำหรับรับงานพิมพ์อีกครั้ง");
      setCandidates([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เชื่อมต่อใหม่ไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function runAction(device: Device, action: "test" | "drawer" | "disconnect" | "delete") {
    if (!device.printer_profile_id) return;
    if (action === "delete" && !confirm(`ลบ ${device.display_name} ออกจากรายการใช้งาน? ประวัติจะยังเก็บไว้`)) return;
    setBusy(`${action}:${device.id}`);
    setError(null);
    setNotice(null);
    try {
      if (action === "test") {
        await api("/api/backoffice/printers/test", { method: "POST", body: JSON.stringify({ printer_id: device.printer_profile_id }) });
      }
      if (action === "drawer") {
        await api("/api/backoffice/printers/drawer-test", { method: "POST", body: JSON.stringify({ printer_id: device.printer_profile_id }) });
      }
      if (action === "disconnect") {
        await api("/api/backoffice/printers/devices", { method: "PATCH", body: JSON.stringify({ printer_id: device.printer_profile_id, action: "disconnect" }) });
      }
      if (action === "delete") {
        await api("/api/backoffice/printers/devices", { method: "DELETE", body: JSON.stringify({ printer_id: device.printer_profile_id }) });
      }
      setNotice(action === "test"
        ? "ส่งงานพิมพ์ทดสอบแล้ว"
        : action === "drawer"
          ? "ส่งคำสั่งทดสอบลิ้นชักแล้ว"
          : action === "disconnect"
            ? "ยกเลิกการเชื่อมต่อแล้ว profile ถูกปิด และสามารถเชื่อมต่อใหม่จากประวัติได้"
            : "ลบเครื่องพิมพ์แล้ว และเก็บประวัติไว้");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  return <div className={styles.page}>
    <div className={styles.header}>
      <div className={styles.titleWrap}>
        <div className={styles.titleIcon}>▤</div>
        <div>
          <h1 className={styles.title}>ตั้งค่าเครื่องพิมพ์</h1>
          <p className={styles.subtitle}>แยกการตั้งค่าตามเจ้าของร้าน → สาขา → เครื่อง POS → หน้าที่พิมพ์/โซนครัว รองรับกระดาษ 58 และ 80 mm</p>
        </div>
      </div>
      <div className={styles.topActions}>
        <span className={styles.branchBadge}>⌂ {registry?.branch?.name ?? "สาขาปัจจุบัน"}{registry?.branch?.code ? ` · ${registry.branch.code}` : ""}</span>
        <button className={styles.ghost} onClick={() => void load()}>รีเฟรช</button>
      </div>
    </div>

    {notice ? <div className={styles.notice}>{notice}</div> : null}
    {error ? <div className={styles.error}>{error}</div> : null}

    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div>
          <span className={styles.label}>สาขา</span>
          <select className={styles.select} value={registry?.branch?.id ?? ""} disabled>
            <option value={registry?.branch?.id ?? ""}>{registry?.branch?.name ?? "สาขาปัจจุบัน"}</option>
          </select>
        </div>
        <div>
          <span className={styles.label}>คำสั่งพิมพ์ / วัตถุประสงค์</span>
          <div className={styles.purposeTabs}>
            <button className={`${styles.tab} ${purposeFilter === "all" ? styles.tabActive : ""}`} onClick={() => { setPurposeFilter("all"); setPage(1); }}>ทั้งหมด</button>
            {purposes.map((purpose) => <button key={purpose.value} className={`${styles.tab} ${purposeFilter === purpose.value ? styles.tabActive : ""}`} onClick={() => { setPurposeFilter(purpose.value); setPage(1); }}>{purpose.label}</button>)}
          </div>
        </div>
      </div>
      <div className={styles.modeGrid}>
        {modeCards.map((card) => <button key={card.mode} className={`${styles.mode} ${mode === card.mode ? styles.modeActive : ""}`} onClick={() => { setMode(card.mode); setCandidates([]); }}>
          <span className={styles.modeIcon}>{card.icon}</span>
          <span><strong>{card.title}</strong><p>{card.desc}<br />{card.help}</p></span>
        </button>)}
      </div>
    </section>

    <section className={`${styles.panel} ${styles.discovery}`}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>✣ ค้นหาอุปกรณ์ที่ระบบรองรับ</h2>
          <span className={styles.hint}>แสดง Runtime / Android / MDM และโปรไฟล์ที่ระบบรู้จักอยู่แล้ว; Web App ไม่สแกนวง LAN โดยตรง</span>
        </div>
        <button className={styles.primary} onClick={() => void discover()} disabled={discovering}>{discovering ? "กำลังค้นหา..." : "⌕ ค้นหาอุปกรณ์"}</button>
      </div>
      {candidates.length ? <div className={styles.candidateGrid}>
        {candidates.map((item) => <div className={styles.candidate} key={item.id}>
          <div className={styles.candidateIcon}>▤</div>
          <div className={styles.candidateInfo}>
            <div className={styles.candidateName}>{item.name}</div>
            <div className={styles.meta}>{item.mode.toUpperCase()} · {item.paper_width_mm}mm · {item.helper}</div>
          </div>
          {item.printer_profile_id ? item.status === "disabled" ? <button className={styles.secondary} onClick={() => void reconnectPrinter(item.printer_profile_id!, item.id)} disabled={busy === `reconnect:${item.id}`}>{busy === `reconnect:${item.id}` ? "กำลังเชื่อมต่อ..." : "เชื่อมต่อใหม่"}</button> : <button className={styles.secondary} disabled>บันทึกไว้แล้ว</button> : <button className={styles.secondary} onClick={() => applyCandidate(item)}>ใช้เครื่องนี้</button>}
        </div>)}
      </div> : <div className={styles.empty}>กดค้นหาเพื่อดู Runtime / Android / MDM หรือโปรไฟล์ที่บันทึกไว้ หากเป็น LAN ให้เพิ่มเครื่องแล้วกรอก IP/Port ด้านล่าง</div>}
    </section>

    <section id="printer-v3-config" className={`${styles.panel} ${styles.config}`}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>{editId ? "แก้ไขเครื่องพิมพ์และเส้นทาง" : "+ เพิ่มเครื่องพิมพ์"}</h2>
          <span className={styles.hint}>การตั้งค่านี้มีผลเฉพาะสาขาปัจจุบัน เครื่อง POS และเครื่องพิมพ์ของสาขาอื่นไม่ถูกแก้ไข</span>
        </div>
        {editId ? <button className={styles.ghost} onClick={() => resetForm(mode)}>ยกเลิกแก้ไข</button> : null}
      </div>
      <div className={styles.formGrid}>
        <div className={styles.wide}>
          <span className={styles.label}>ชื่อเครื่องพิมพ์</span>
          <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} placeholder="เช่น เคาน์เตอร์ 1, ครัวร้อน" />
        </div>
        <div>
          <span className={styles.label}>ยี่ห้อ</span>
          <input className={styles.input} value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="เช่น Epson, Xprinter" />
        </div>
        <div>
          <span className={styles.label}>รุ่น</span>
          <input className={styles.input} value={model} onChange={(event) => setModel(event.target.value)} placeholder="เช่น TM-T82, XP-58" />
        </div>
        <div>
          <span className={styles.label}>รูปแบบเชื่อมต่อ</span>
          <select className={styles.select} value={mode} onChange={(event) => setMode(event.target.value as Mode)}><option value="lan">LAN</option><option value="usb">USB</option><option value="bluetooth">Bluetooth</option></select>
        </div>
        <div>
          <span className={styles.label}>ขนาดกระดาษ</span>
          <select className={styles.select} value={paper} onChange={(event) => setPaper(Number(event.target.value) as 58 | 80)}><option value={58}>58 mm</option><option value={80}>80 mm</option></select>
        </div>
      </div>
      <div className={styles.purposeGrid}>
        {purposes.map((purpose) => <label className={styles.check} key={purpose.value}>
          <input type="checkbox" checked={selectedPurposes.includes(purpose.value)} onChange={() => togglePurpose(purpose.value)} />
          <span>{purpose.label}</span>
        </label>)}
      </div>

      {zonedPurposes.filter((purpose) => selectedPurposes.includes(purpose)).map((purpose) => <div className={styles.advanced} key={purpose}>
        <div className={styles.label}>{purposeLabel(purpose)} — แยกตามโซนครัว</div>
        {(registry?.kitchen_zones ?? []).length > 0 ? <div className={styles.purposeGrid}>
          {(registry?.kitchen_zones ?? []).map((zone) => <label className={styles.check} key={`${purpose}:${zone.id}`}>
            <input type="checkbox" checked={zoneSelections[purpose].includes(zone.zone_code.toUpperCase())} onChange={() => toggleZone(purpose, zone.zone_code)} />
            <span>{zone.zone_name} · {zone.zone_code}</span>
          </label>)}
        </div> : <div className={styles.hint}>สาขานี้ยังไม่มี Kitchen Zone — เครื่องจะเป็นค่าเริ่มต้นแบบทั้งสาขา จนกว่าจะสร้างโซนครัว</div>}
        <div className={styles.hint}>{zoneSelections[purpose].length === 0 ? "ไม่ได้เลือกโซน: ใช้เป็นเส้นทางสำรองของทั้งสาขา" : `เลือก ${zoneSelections[purpose].length} โซน: งานของแต่ละโซนจะส่งไปเครื่องนี้`}</div>
      </div>)}

      <details className={styles.advanced}>
        <summary>⚙ ตั้งค่าขั้นสูง / ผูกเครื่อง POS</summary>
        <div className={styles.advancedGrid}>
          {mode === "lan" ? <>
            <div>
              <span className={styles.label}>IP เครื่องพิมพ์</span>
              <input className={styles.input} value={ip} onChange={(event) => setIp(event.target.value)} placeholder="192.168.1.50" />
            </div>
            <div>
              <span className={styles.label}>Port</span>
              <input className={styles.input} inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} placeholder="9100" />
            </div>
          </> : <div>
            <span className={styles.label}>รหัสเครื่อง POS / Runtime</span>
            <input className={styles.input} value={runtimeCode} onChange={(event) => setRuntimeCode(event.target.value)} placeholder="เช่น POS-COUNTER-01" />
            <div className={styles.meta}>กรอกเมื่อเครื่องพิมพ์นี้ต้องรับงานจาก POS เครื่องนี้โดยเฉพาะ; เว้นว่างเพื่อเป็นเครื่องประจำสาขา</div>
          </div>}
        </div>
      </details>
      <div className={styles.formActions}>
        <button className={styles.ghost} onClick={() => resetForm(mode)}>ล้างค่า</button>
        <button className={styles.primary} onClick={() => void save()} disabled={busy === "save"}>{busy === "save" ? "กำลังบันทึก..." : editId ? "บันทึกการเปลี่ยนแปลง" : "เชื่อมต่อและบันทึก"}</button>
      </div>
    </section>

    <section className={`${styles.panel} ${styles.tablePanel}`}>
      <div className={styles.tableHeader}>
        <div>
          <h2 className={styles.sectionTitle}>รายการเครื่องพิมพ์ <span className={styles.hint}>({filtered.length} เครื่อง)</span></h2>
          <span className={styles.hint}>Routing แยกตามสาขาและ POS; ครัวใช้ Kitchen Zone เดียวกับระบบเมนู/ครัว</span>
        </div>
        <button className={styles.primary} onClick={() => resetForm(mode)}>+ เพิ่มเครื่องพิมพ์</button>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>สถานะ</th><th>ชื่อเครื่อง</th><th>รุ่น / ยี่ห้อ</th><th>โหมด / POS</th><th>สาขา</th><th>โซน / หน้าที่</th><th>กระดาษ</th><th>ออนไลน์ล่าสุด</th><th>การทำงาน</th><th>จัดการ</th></tr></thead>
          <tbody>{pageItems.map((device) => {
            const assignments = device.printer_device_assignments.filter((assignment) => assignment.is_enabled);
            const hasDrawer = assignments.some((assignment) => assignment.purpose === "cash_drawer");
            return <tr key={device.id}>
              <td><span className={styles.status}><span className={`${styles.dot} ${statusClass(device.status)}`} />{statusLabel(device.status)}</span></td>
              <td><div className={styles.deviceName}>{device.display_name}</div><div className={styles.meta}>{device.printer_profile_id ? "พร้อมเข้าคิวพิมพ์" : "ยังไม่ผูก profile"}</div></td>
              <td>{device.brand || "ทั่วไป"}<div className={styles.meta}>{device.model || "ไม่ระบุรุ่น"}</div></td>
              <td>{device.connection_mode.toUpperCase()}<div className={styles.meta}>{device.runtime_device_code ? `POS: ${device.runtime_device_code}` : "ทั้งสาขา"}</div></td>
              <td>{registry?.branch?.name ?? "สาขาปัจจุบัน"}</td>
              <td><div className={styles.chips}>{assignments.map((assignment) => {
                const zoneCode = assignment.zone_key?.toUpperCase();
                const zoneLabel = zoneCode ? zoneNameByCode.get(zoneCode) ?? zoneCode : null;
                return <span className={styles.chip} key={`${assignment.purpose}:${assignment.zone_key}`}>{purposeLabel(assignment.purpose)}{zoneLabel ? ` · ${zoneLabel}` : ""}</span>;
              })}</div></td>
              <td>{device.paper_width_mm}mm</td>
              <td>{fmt(device.last_seen_at ?? device.updated_at)}</td>
              <td><div className={styles.actions}>
                <button className={styles.iconButton} title="พิมพ์ทดสอบ" onClick={() => void runAction(device, "test")}>▤</button>
                {hasDrawer ? <button className={styles.iconButton} title="เปิดลิ้นชักทดสอบ" onClick={() => void runAction(device, "drawer")}>⌑</button> : null}
                <button className={styles.iconButton} title="แก้ไข" onClick={() => edit(device)}>✎</button>
              </div></td>
              <td><div className={styles.actions}>
                <button className={styles.ghost} onClick={() => void runAction(device, "disconnect")} disabled={busy === `disconnect:${device.id}`}>ยกเลิกเชื่อมต่อ</button>
                <button className={styles.danger} onClick={() => void runAction(device, "delete")} disabled={busy === `delete:${device.id}`}>ลบ</button>
              </div></td>
            </tr>;
          })}</tbody>
        </table>
        {pageItems.length === 0 ? <div className={styles.empty}>ยังไม่มีเครื่องพิมพ์ในตัวกรองนี้</div> : null}
      </div>
      <div className={styles.pager}>
        <button className={styles.pageButton} disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</button>
        {Array.from({ length: totalPages }, (_, index) => index + 1).slice(Math.max(0, page - 3), Math.max(5, page + 2)).map((pageNumber) => <button key={pageNumber} className={`${styles.pageButton} ${page === pageNumber ? styles.pageActive : ""}`} onClick={() => setPage(pageNumber)}>{pageNumber}</button>)}
        <button className={styles.pageButton} disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>›</button>
      </div>
    </section>

    <section className={`${styles.panel} ${styles.history}`}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>ประวัติเครื่องที่เคยเชื่อมต่อ</h2>
          <span className={styles.hint}>เครื่องที่ยกเลิกการเชื่อมต่อจะอยู่ที่นี่และเชื่อมต่อใหม่ได้ ส่วนการลบ profile จะเก็บประวัติไว้แต่ไม่เปิดให้ reconnect</span>
        </div>
      </div>
      <div className={styles.historyList}>
        {(registry?.history ?? []).length ? (registry?.history ?? []).map((item) => <div className={styles.historyRow} key={item.id}>
          <strong>{item.device_name}</strong>
          <span>{item.brand || "ทั่วไป"} {item.model || ""}</span>
          <span>{item.connection_mode?.toUpperCase() || "-"} · {item.paper_width_mm || "-"}mm</span>
          <span>{historyLabel(item.event_type)}</span>
          <div className={styles.actions}>
            <span>{fmt(item.created_at)}</span>
            {item.can_reconnect && item.printer_profile_id ? <button className={styles.secondary} onClick={() => void reconnectPrinter(item.printer_profile_id!, item.id)} disabled={busy === `reconnect:${item.id}`}>{busy === `reconnect:${item.id}` ? "กำลังเชื่อมต่อ..." : "เชื่อมต่อใหม่"}</button> : null}
          </div>
        </div>) : <div className={styles.empty}>ยังไม่มีประวัติการเชื่อมต่อ</div>}
      </div>
    </section>
  </div>;
}
