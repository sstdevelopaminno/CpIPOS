"use client";

import { Award, History, Plus, Search, Star, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type SalesMember = {
  id: string;
  name: string;
  phone: string;
  points: number;
  stamps: number;
};

type MemberHistory = {
  id: string;
  orderNo: string;
  amount: number;
  points: number;
  stamps: number;
  createdAt: string | null;
};

type MemberLauncherProps = {
  orderId?: string;
  selectedMember?: SalesMember | null;
  compact?: boolean;
  disabled?: boolean;
  onMemberLinked?: (member: SalesMember, earned: { points: number; stamps: number }) => void;
};

type MembersResponse = {
  data?: { members?: SalesMember[]; member?: SalesMember; history?: MemberHistory[] } | null;
  error?: { message?: string } | null;
};

const LOCAL_MEMBERS_KEY = "sstipos_mobile_members_fallback";
const LOCAL_HISTORY_KEY = "sstipos_mobile_member_history_fallback";

function digitsOnly(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

function money(value: number) {
  return Number(value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function readLocalMembers(): SalesMember[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_MEMBERS_KEY);
    return raw ? (JSON.parse(raw) as SalesMember[]) : [];
  } catch {
    return [];
  }
}

function writeLocalMembers(members: SalesMember[]) {
  window.localStorage.setItem(LOCAL_MEMBERS_KEY, JSON.stringify(members));
}

function readLocalHistory(memberId: string): MemberHistory[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_HISTORY_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, MemberHistory[]>) : {};
    return all[memberId] ?? [];
  } catch {
    return [];
  }
}

function appendLocalHistory(memberId: string, entry: MemberHistory) {
  const raw = window.localStorage.getItem(LOCAL_HISTORY_KEY);
  const all = raw ? (JSON.parse(raw) as Record<string, MemberHistory[]>) : {};
  all[memberId] = [entry, ...(all[memberId] ?? [])].slice(0, 30);
  window.localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(all));
}

function searchLocalMembers(query: string) {
  const value = query.trim().toLowerCase();
  const phone = digitsOnly(query);
  return readLocalMembers().filter((member) => {
    if (!value && !phone) return true;
    return member.name.toLowerCase().includes(value) || member.phone.includes(phone);
  });
}

export function MemberLauncher({ orderId, selectedMember, compact = false, disabled = false, onMemberLinked }: MemberLauncherProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "add" | "detail">("list");
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<SalesMember[]>([]);
  const [activeMember, setActiveMember] = useState<SalesMember | null>(selectedMember ?? null);
  const [history, setHistory] = useState<MemberHistory[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [earnedPoints, setEarnedPoints] = useState("0");
  const [earnedStamps, setEarnedStamps] = useState("0");
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fallbackMode, setFallbackMode] = useState(false);

  useEffect(() => {
    setActiveMember(selectedMember ?? null);
  }, [selectedMember]);

  const canAttachToBill = Boolean(orderId);
  const normalizedPhone = useMemo(() => digitsOnly(phone), [phone]);

  function activateLocalFallback(message?: string, nextQuery = query) {
    setFallbackMode(true);
    setMembers(searchLocalMembers(nextQuery));
    if (message) setError(message);
  }

  async function loadMembers(nextQuery = query) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/mobile/members?q=${encodeURIComponent(nextQuery)}`, { cache: "no-store" });
      const json = await response.json().catch(() => null) as MembersResponse | null;
      if (!response.ok || json?.error) {
        activateLocalFallback("ฐานข้อมูลสมาชิกยังไม่พร้อม ใช้ข้อมูลชั่วคราวในเครื่องนี้ก่อน", nextQuery);
        return;
      }
      setFallbackMode(false);
      setMembers(json?.data?.members ?? []);
    } catch {
      activateLocalFallback("เชื่อมต่อสมาชิกไม่ได้ ใช้ข้อมูลชั่วคราวในเครื่องนี้ก่อน", nextQuery);
    } finally {
      setLoading(false);
    }
  }

  async function createMember() {
    if (!name.trim() || normalizedPhone.length < 9) {
      setError("กรุณาใส่ชื่อและเบอร์โทรให้ครบ");
      return;
    }
    setLoading(true);
    setError("");
    const payload = {
      name: name.trim(),
      phone: normalizedPhone,
      points: Number(earnedPoints || 0),
      stamps: Number(earnedStamps || 0),
    };
    try {
      const response = await fetch("/api/mobile/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => null) as MembersResponse | null;
      if (!response.ok || json?.error || !json?.data?.member) {
        const localMember = saveLocalMember(payload);
        setError("ฐานข้อมูลสมาชิกยังไม่พร้อม บันทึกเป็นข้อมูลชั่วคราวในเครื่องนี้แล้ว");
        openLocalDetail(localMember);
        return;
      }
      const member = json.data.member;
      setFallbackMode(false);
      setMembers((current) => [member, ...current.filter((item) => item.id !== member.id)]);
      openRemoteDetail(member);
    } catch {
      const localMember = saveLocalMember(payload);
      setError("เชื่อมต่อสมาชิกไม่ได้ บันทึกเป็นข้อมูลชั่วคราวในเครื่องนี้แล้ว");
      openLocalDetail(localMember);
    } finally {
      setLoading(false);
      setName("");
      setPhone("");
    }
  }

  function saveLocalMember(input: { name: string; phone: string; points: number; stamps: number }) {
    setFallbackMode(true);
    const current = readLocalMembers();
    const existing = current.find((member) => member.phone === input.phone);
    const member: SalesMember = existing
      ? { ...existing, name: input.name, points: input.points, stamps: input.stamps }
      : { id: `local-${crypto.randomUUID()}`, name: input.name, phone: input.phone, points: input.points, stamps: input.stamps };
    const next = [member, ...current.filter((item) => item.id !== member.id && item.phone !== member.phone)];
    writeLocalMembers(next);
    setMembers(next);
    return member;
  }

  function openLocalDetail(member: SalesMember) {
    setActiveMember(member);
    setHistory(readLocalHistory(member.id));
    setShowHistory(false);
    setMode("detail");
  }

  async function openRemoteDetail(member: SalesMember) {
    setActiveMember(member);
    setShowHistory(false);
    setMode("detail");
    if (member.id.startsWith("local-") || fallbackMode) {
      openLocalDetail(member);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/mobile/members/${member.id}`, { cache: "no-store" });
      const json = await response.json().catch(() => null) as MembersResponse | null;
      if (!response.ok || json?.error) {
        setError(json?.error?.message ?? "โหลดประวัติสมาชิกไม่สำเร็จ");
        return;
      }
      setActiveMember(json?.data?.member ?? member);
      setHistory(json?.data?.history ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function attachToBill(member = activeMember) {
    if (!member) return;
    const points = Math.max(0, Number(earnedPoints || 0));
    const stamps = Math.max(0, Number(earnedStamps || 0));
    if (!orderId || member.id.startsWith("local-") || fallbackMode) {
      const linkedMember = { ...member, points: member.points + points, stamps: member.stamps + stamps };
      const nextMembers = [linkedMember, ...readLocalMembers().filter((item) => item.id !== member.id)];
      writeLocalMembers(nextMembers);
      appendLocalHistory(member.id, {
        id: `local-history-${crypto.randomUUID()}`,
        orderNo: orderId ? "บิลปัจจุบัน" : "ยังไม่ผูกบิล",
        amount: 0,
        points,
        stamps,
        createdAt: new Date().toISOString(),
      });
      setActiveMember(linkedMember);
      setMembers(nextMembers);
      onMemberLinked?.(linkedMember, { points, stamps });
      setOpen(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/mobile/sales/takeaway/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ orderId, memberId: member.id, points, stamps }),
      });
      const json = await response.json().catch(() => null) as MembersResponse | null;
      if (!response.ok || json?.error) {
        setError(json?.error?.message ?? "ผูกสมาชิกกับบิลไม่สำเร็จ");
        return;
      }
      const linkedMember = json?.data?.member ?? { ...member, points: member.points + points, stamps: member.stamps + stamps };
      setActiveMember(linkedMember);
      onMemberLinked?.(linkedMember, { points, stamps });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  function openPopup() {
    if (disabled) return;
    setOpen(true);
    setMode("list");
    setError("");
    void loadMembers("");
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={openPopup}
        className={`${compact ? "inline-grid min-h-[34px] rounded-full px-3 text-[12px]" : "grid min-h-[58px] rounded-[18px] px-3 text-[14px]"} touch-manipulation place-items-center border border-[#d4e5f8] bg-white font-black text-[#17416f] shadow-[0_8px_20px_rgba(15,39,69,0.06)] transition active:scale-[0.98] active:bg-[#f5faff] disabled:bg-[#f1f6fb] disabled:text-[#9aadc2] disabled:opacity-65`}
      >
        <span className="flex items-center justify-center gap-2">
          <UserRound className={`${compact ? "h-4 w-4" : "h-5 w-5"} text-[#1677d9]`} strokeWidth={2.35} />
          {selectedMember ? selectedMember.name : "สมาชิก"}
        </span>
      </button>

      {open ? (
        <div role="dialog" aria-modal="true" aria-label="สมาชิก" className="fixed inset-0 z-[170] flex items-center justify-center bg-[rgba(15,39,69,0.35)] p-4">
          <section className="grid max-h-[88dvh] w-[min(94vw,410px)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[22px] border border-[#d9e8f7] bg-white shadow-[0_18px_48px_rgba(15,39,69,0.22)]">
            <header className="flex items-start justify-between gap-3 border-b border-[#eef4fb] p-4">
              <div>
                <h2 className="m-0 text-[20px] font-black text-[#0f2745]">สมาชิก</h2>
                <p className="m-0 mt-1 text-[13px] font-bold text-[#6a7f99]">ค้นหา เพิ่ม และผูกสมาชิกกับบิลขาย</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="ปิดสมาชิก" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d9e8f7] bg-white text-[#17416f]">
                <X size={18} />
              </button>
            </header>

            <div className="overflow-y-auto p-4">
              {fallbackMode ? <div className="mb-3 rounded-[14px] border border-[#ffe0a3] bg-[#fffaf0] p-3 text-[12px] font-bold text-[#9a5b00]">โหมดชั่วคราว: ข้อมูลถูกเก็บในเครื่องนี้จนกว่าจะสร้างตารางสมาชิกใน Supabase</div> : null}
              <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
                <label className="flex min-h-11 items-center gap-2 rounded-[14px] border border-[#d9e8f7] bg-[#f8fbff] px-3 text-[#17416f]">
                  <Search size={17} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadMembers(); }} placeholder="ค้นหาชื่อหรือเบอร์โทร" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] font-bold text-[#0f2745] outline-none placeholder:text-[#8aa1ba]" />
                </label>
                <button type="button" onClick={() => void loadMembers()} className="min-h-11 rounded-[14px] border border-[#cfe3fa] bg-white px-3 text-[12px] font-black text-[#1677d9]">ค้นหา</button>
              </div>

              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                <button type="button" onClick={() => setMode("list")} className={`min-h-10 rounded-[14px] border px-3 text-[12px] font-black ${mode === "list" || mode === "detail" ? "border-[#1677d9] bg-[#eef6ff] text-[#1677d9]" : "border-[#d9e8f7] bg-white text-[#587398]"}`}>รายชื่อสมาชิก</button>
                <button type="button" onClick={() => setMode("add")} className={`flex min-h-10 items-center justify-center gap-1 rounded-[14px] border px-3 text-[12px] font-black ${mode === "add" ? "border-[#1677d9] bg-[#eef6ff] text-[#1677d9]" : "border-[#d9e8f7] bg-white text-[#587398]"}`}><Plus size={15} /> เพิ่มสมาชิก</button>
              </div>

              {error ? <div className="mb-3 rounded-[14px] border border-[#ffd7d7] bg-[#fff8f8] p-3 text-[12px] font-bold text-[#b42318]">{error}</div> : null}

              {mode === "add" ? (
                <div className="grid gap-3 rounded-[18px] border border-[#d9e8f7] bg-[#f8fbff] p-3">
                  <label className="grid min-w-0 gap-1 text-[12px] font-black text-[#587398]">ชื่อสมาชิก<input value={name} onChange={(event) => setName(event.target.value)} className="min-h-11 min-w-0 rounded-[13px] border border-[#d9e8f7] bg-white px-3 text-[14px] font-bold text-[#0f2745] outline-none" /></label>
                  <label className="grid min-w-0 gap-1 text-[12px] font-black text-[#587398]">เบอร์โทร<input value={phone} onChange={(event) => setPhone(digitsOnly(event.target.value))} inputMode="tel" className="min-h-11 min-w-0 rounded-[13px] border border-[#d9e8f7] bg-white px-3 text-[14px] font-bold text-[#0f2745] outline-none" /></label>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                    <label className="grid min-w-0 gap-1 text-[12px] font-black text-[#587398]">คะแนนเริ่มต้น<input value={earnedPoints} onChange={(event) => setEarnedPoints(digitsOnly(event.target.value))} inputMode="numeric" className="min-h-11 min-w-0 rounded-[13px] border border-[#d9e8f7] bg-white px-3 text-[14px] font-bold text-[#0f2745] outline-none" /></label>
                    <label className="grid min-w-0 gap-1 text-[12px] font-black text-[#587398]">แต้มเริ่มต้น<input value={earnedStamps} onChange={(event) => setEarnedStamps(digitsOnly(event.target.value))} inputMode="numeric" className="min-h-11 min-w-0 rounded-[13px] border border-[#d9e8f7] bg-white px-3 text-[14px] font-bold text-[#0f2745] outline-none" /></label>
                  </div>
                  <button type="button" onClick={() => void createMember()} disabled={loading} className="min-h-11 rounded-[14px] border-0 bg-[#1677d9] px-4 text-[14px] font-black text-white disabled:opacity-60">บันทึกสมาชิก</button>
                </div>
              ) : null}

              {mode === "list" ? (
                <div className="grid gap-2">
                  {loading ? <div className="rounded-[16px] border border-[#d9e8f7] bg-[#f8fbff] p-4 text-center text-[13px] font-bold text-[#587398]">กำลังโหลด...</div> : null}
                  {!loading && !members.length ? <div className="rounded-[16px] border border-[#d9e8f7] bg-[#f8fbff] p-4 text-center text-[13px] font-bold text-[#587398]">ยังไม่พบสมาชิก</div> : null}
                  {members.map((member) => (
                    <button key={member.id} type="button" onClick={() => void openRemoteDetail(member)} className="grid min-h-[74px] grid-cols-[1fr_auto] items-center gap-3 rounded-[16px] border border-[#d9e8f7] bg-white p-3 text-left shadow-[0_4px_12px_rgba(15,39,69,0.05)]">
                      <span className="min-w-0"><b className="block truncate text-[15px] font-black text-[#0f2745]">{member.name}</b><span className="mt-1 block text-[12px] font-bold text-[#587398]">{member.phone}</span></span>
                      <span className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 text-center"><span className="rounded-[12px] bg-[#eef6ff] px-2 py-1 text-[11px] font-black text-[#1677d9]">{member.points} คะแนน</span><span className="rounded-[12px] bg-[#fff6e8] px-2 py-1 text-[11px] font-black text-[#d98600]">{member.stamps} แต้ม</span></span>
                    </button>
                  ))}
                </div>
              ) : null}

              {mode === "detail" && activeMember ? (
                <div className="grid gap-3">
                  <section className="rounded-[18px] border border-[#cfe3fa] bg-[#f8fbff] p-4">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="m-0 truncate text-[18px] font-black text-[#0f2745]">{activeMember.name}</h3><p className="m-0 mt-1 text-[13px] font-bold text-[#587398]">{activeMember.phone}</p></div><UserRound className="h-8 w-8 shrink-0 text-[#1677d9]" /></div>
                    <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2"><div className="rounded-[14px] bg-white p-3"><Star className="mb-1 h-5 w-5 text-[#1677d9]" /><p className="m-0 text-[11px] font-black text-[#587398]">คะแนนสะสม</p><b className="mt-1 block text-[22px] text-[#0f2745]">{activeMember.points}</b></div><div className="rounded-[14px] bg-white p-3"><Award className="mb-1 h-5 w-5 text-[#d98600]" /><p className="m-0 text-[11px] font-black text-[#587398]">แต้มสะสม</p><b className="mt-1 block text-[22px] text-[#0f2745]">{activeMember.stamps}</b></div></div>
                  </section>

                  <section className="grid gap-2 rounded-[18px] border border-[#d9e8f7] bg-white p-3">
                    <p className="m-0 text-[13px] font-black text-[#0f2745]">{canAttachToBill ? "ผูกกับบิลนี้" : "เลือกคะแนนและแต้ม"}</p>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2"><label className="grid min-w-0 gap-1 text-[12px] font-black text-[#587398]">คะแนน<input value={earnedPoints} onChange={(event) => setEarnedPoints(digitsOnly(event.target.value))} inputMode="numeric" className="min-h-10 min-w-0 rounded-[13px] border border-[#d9e8f7] bg-[#f8fbff] px-3 text-[14px] font-bold text-[#0f2745] outline-none" /></label><label className="grid min-w-0 gap-1 text-[12px] font-black text-[#587398]">แต้ม<input value={earnedStamps} onChange={(event) => setEarnedStamps(digitsOnly(event.target.value))} inputMode="numeric" className="min-h-10 min-w-0 rounded-[13px] border border-[#d9e8f7] bg-[#f8fbff] px-3 text-[14px] font-bold text-[#0f2745] outline-none" /></label></div>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <button type="button" onClick={() => void attachToBill()} disabled={loading} className="min-h-11 rounded-[14px] border-0 bg-[#1677d9] px-3 text-[14px] font-black text-white disabled:opacity-60">{canAttachToBill ? "ใช้สมาชิกกับบิลนี้" : "เลือกสมาชิกนี้"}</button>
                      <button type="button" onClick={() => setShowHistory((value) => !value)} className="flex min-h-11 items-center justify-center gap-1 rounded-[14px] border border-[#d9e8f7] bg-white px-3 text-[12px] font-black text-[#17416f]">
                        <History size={15} />
                        ประวัติ
                      </button>
                    </div>
                  </section>

                  {showHistory ? <section className="rounded-[18px] border border-[#d9e8f7] bg-white p-3">
                    <div className="mb-2 flex items-center gap-2 text-[13px] font-black text-[#0f2745]"><History size={16} /> ประวัติสมาชิก</div>
                    <div className="grid gap-2">
                      {history.length ? history.map((item) => (
                        <article key={item.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-[14px] bg-[#f8fbff] p-3"><span className="min-w-0"><b className="block truncate text-[13px] text-[#0f2745]">{item.orderNo}</b><span className="text-[11px] font-bold text-[#587398]">{item.createdAt ? new Date(item.createdAt).toLocaleString("th-TH") : "-"}</span></span><span className="text-right text-[11px] font-black text-[#1677d9]">฿{money(item.amount)}<br />+{item.points} คะแนน / +{item.stamps} แต้ม</span></article>
                      )) : <div className="rounded-[14px] bg-[#f8fbff] p-3 text-center text-[12px] font-bold text-[#587398]">ยังไม่มีประวัติ</div>}
                    </div>
                  </section> : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
