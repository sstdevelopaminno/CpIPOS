"use client";

import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";

type TaxEntityType = "company" | "limited_partnership" | "shop" | "individual";

type TaxProfile = {
  id: string;
  entity_type: TaxEntityType;
  display_name: string;
  tax_id: string;
  address_line: string;
  subdistrict: string;
  district: string;
  province: string;
  postal_code: string;
  invoice_count: number;
  last_issued_at: string | null;
};

type AddressOption = {
  postal_code: string;
  subdistrict: string;
  district: string;
  province: string;
  subdistrict_code: string;
  district_code: string;
  province_code: string;
};

type ReceiptListRow = {
  id: string;
  order_no: string;
  customer_name: string | null;
  total: number;
  tax_total: number;
  created_at: string;
  paid_at: string | null;
  invoice: { id: string; invoice_no: string; profile_id: string; issued_at: string; print_count: number } | null;
};

type ReceiptDetail = {
  order: { id: string; order_no: string; status: string };
  order_snapshot: {
    order_id: string;
    order_no: string;
    created_at: string;
    paid_at: string | null;
    subtotal: number;
    discount_amount: number;
    tax_total: number;
    grand_total: number;
    paid_total: number;
    customer_name: string | null;
  };
  items: Array<{ name: string; quantity: number; unit_price: number; line_total: number; notes?: string | null }>;
  payments: Array<{ method?: string; amount?: number; status?: string }>;
  tax: {
    source: "order_snapshot";
    tax_total: number;
    lines: Array<{ label: string; rate_pct: number; mode: string; amount: number }>;
    warning: string | null;
  };
  invoice: {
    id: string;
    profile_id: string;
    invoice_no: string;
    issued_at: string;
    print_count: number;
    paper_width_mm: number;
  } | null;
  seller: { display_name: string; tax_id: string; branch_no: string; address: string; phone: string };
  seller_ready: boolean;
};

type ApiBody<T> = { data?: T | null; error?: { code?: string; message?: string } | null };

type ProfileForm = {
  entity_type: TaxEntityType;
  display_name: string;
  tax_id: string;
  address_line: string;
  postal_code: string;
  subdistrict: string;
  district: string;
  province: string;
};

type SellerForm = {
  seller_display_name: string;
  seller_tax_id: string;
  seller_branch_no: string;
  seller_address: string;
};

const EMPTY_PROFILE: ProfileForm = {
  entity_type: "company",
  display_name: "",
  tax_id: "",
  address_line: "",
  postal_code: "",
  subdistrict: "",
  district: "",
  province: ""
};

const EMPTY_SELLER: SellerForm = {
  seller_display_name: "",
  seller_tax_id: "",
  seller_branch_no: "00000",
  seller_address: ""
};

const PAGE_SIZE = 10;

function digits(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function validThaiTaxId(value: string) {
  const clean = digits(value);
  if (!/^\d{13}$/.test(clean)) return false;
  const sum = clean
    .slice(0, 12)
    .split("")
    .reduce((acc, digit, index) => acc + Number(digit) * (13 - index), 0);
  return (11 - (sum % 11)) % 10 === Number(clean[12]);
}

function money(value: number, lang: Language) {
  return Number(value || 0).toLocaleString(lang === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function dateTime(value: string | null, lang: Language) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function entityLabel(value: TaxEntityType, lang: Language) {
  if (lang === "en") {
    if (value === "company") return "Company";
    if (value === "limited_partnership") return "Limited partnership";
    if (value === "shop") return "Shop";
    return "Individual";
  }
  if (value === "company") return "บริษัท";
  if (value === "limited_partnership") return "หจก.";
  if (value === "shop") return "ร้านค้า";
  return "บุคคลธรรมดา";
}

export function PosTaxInvoiceWorkspace({ lang, role }: { lang: Language; role: string }) {
  const [profiles, setProfiles] = useState<TaxProfile[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [profileSaving, setProfileSaving] = useState(false);
  const [addressOptions, setAddressOptions] = useState<AddressOption[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);

  const [sellerOpen, setSellerOpen] = useState(false);
  const [sellerForm, setSellerForm] = useState<SellerForm>(EMPTY_SELLER);
  const [sellerSaving, setSellerSaving] = useState(false);

  const [issueProfile, setIssueProfile] = useState<TaxProfile | null>(null);
  const [receiptQuery, setReceiptQuery] = useState("");
  const [receipts, setReceipts] = useState<ReceiptListRow[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [managerPin, setManagerPin] = useState("");
  const [printing, setPrinting] = useState(false);

  const canManageSeller = role === "owner" || role === "manager";
  const totalPages = Math.max(1, Math.ceil(profiles.length / PAGE_SIZE));
  const visibleProfiles = useMemo(
    () => profiles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [profiles, page]
  );

  async function loadProfiles(query = search) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ mode: "profiles" });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/pos/tax-invoices?${params}`, { cache: "no-store", credentials: "include" });
      const body = (await response.json().catch(() => null)) as ApiBody<{ profiles?: TaxProfile[] }> | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "Unable to load tax profiles.");
      setProfiles(Array.isArray(body?.data?.profiles) ? body!.data!.profiles! : []);
      setPage(1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  async function loadSeller() {
    try {
      const response = await fetch("/api/pos/tax-invoices?mode=seller", { cache: "no-store", credentials: "include" });
      const body = (await response.json().catch(() => null)) as ApiBody<{ seller?: ReceiptDetail["seller"] }> | null;
      if (!response.ok || body?.error) return;
      const seller = body?.data?.seller;
      if (!seller) return;
      setSellerForm({
        seller_display_name: seller.display_name ?? "",
        seller_tax_id: seller.tax_id ?? "",
        seller_branch_no: seller.branch_no || "00000",
        seller_address: seller.address ?? ""
      });
    } catch {
      // Seller setup remains optional until issuance.
    }
  }

  useEffect(() => {
    void loadProfiles("");
    void loadSeller();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 2400);
    return () => window.clearTimeout(timer);
  }, [success]);

  useEffect(() => {
    const postalCode = digits(profileForm.postal_code);
    setAddressOptions([]);
    setAddressError(null);
    setProfileForm((current) =>
      current.subdistrict || current.district || current.province
        ? { ...current, subdistrict: "", district: "", province: "" }
        : current
    );
    if (postalCode.length !== 5) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setAddressLoading(true);
      try {
        const response = await fetch(`/api/pos/tax-invoices?mode=address&postal_code=${encodeURIComponent(postalCode)}`, {
          cache: "no-store",
          credentials: "include"
        });
        const body = (await response.json().catch(() => null)) as ApiBody<{ options?: AddressOption[] }> | null;
        if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "ค้นหาที่อยู่ไม่สำเร็จ");
        if (cancelled) return;
        const options = Array.isArray(body?.data?.options) ? body!.data!.options! : [];
        setAddressOptions(options);
        if (options.length === 1) selectAddress(options[0]);
        if (options.length === 0) setAddressError("ไม่พบตำบล/อำเภอ/จังหวัดสำหรับรหัสไปรษณีย์นี้");
      } catch (caught) {
        if (!cancelled) setAddressError(caught instanceof Error ? caught.message : "ค้นหาที่อยู่ไม่สำเร็จ");
      } finally {
        if (!cancelled) setAddressLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileForm.postal_code]);

  function selectAddress(option: AddressOption) {
    setProfileForm((current) => ({
      ...current,
      postal_code: option.postal_code,
      subdistrict: option.subdistrict,
      district: option.district,
      province: option.province
    }));
  }

  function openNewProfile() {
    setProfileForm(EMPTY_PROFILE);
    setAddressOptions([]);
    setAddressError(null);
    setError(null);
    setProfileOpen(true);
  }

  async function saveProfile() {
    if (!validThaiTaxId(profileForm.tax_id)) {
      setError(lang === "th" ? "เลขผู้เสียภาษี 13 หลักไม่ถูกต้อง" : "Invalid 13-digit tax ID.");
      return;
    }
    if (!profileForm.subdistrict || !profileForm.district || !profileForm.province) {
      setError(lang === "th" ? "กรุณาเลือกรายการที่อยู่จากผลค้นหารหัสไปรษณีย์" : "Choose an address from postal-code results.");
      return;
    }
    setProfileSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/tax-invoices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "save_profile", ...profileForm, tax_id: digits(profileForm.tax_id), postal_code: digits(profileForm.postal_code) })
      });
      const body = (await response.json().catch(() => null)) as ApiBody<{ message?: string }> | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "บันทึกไม่สำเร็จ");
      setProfileOpen(false);
      setSuccess(body?.data?.message ?? "บันทึกข้อมูลผู้เสียภาษีสำเร็จ");
      await loadProfiles();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "บันทึกไม่สำเร็จ");
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveSeller() {
    setSellerSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/tax-invoices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "save_seller", ...sellerForm })
      });
      const body = (await response.json().catch(() => null)) as ApiBody<{ message?: string }> | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "บันทึกไม่สำเร็จ");
      setSellerOpen(false);
      setSuccess(body?.data?.message ?? "บันทึกข้อมูลผู้ออกใบกำกับภาษีสำเร็จ");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSellerSaving(false);
    }
  }

  async function loadReceipts(query = "") {
    setReceiptsLoading(true);
    setDetail(null);
    try {
      const params = new URLSearchParams({ mode: "receipts" });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/pos/tax-invoices?${params}`, { cache: "no-store", credentials: "include" });
      const body = (await response.json().catch(() => null)) as ApiBody<{ records?: ReceiptListRow[] }> | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "ค้นหาบิลไม่สำเร็จ");
      setReceipts(Array.isArray(body?.data?.records) ? body!.data!.records! : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ค้นหาบิลไม่สำเร็จ");
    } finally {
      setReceiptsLoading(false);
    }
  }

  function openIssue(profile: TaxProfile) {
    setIssueProfile(profile);
    setReceiptQuery("");
    setReceipts([]);
    setDetail(null);
    setManagerPin("");
    setError(null);
    void loadReceipts("");
  }

  async function selectReceipt(orderId: string) {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/pos/tax-invoices?mode=receipt_detail&order_id=${encodeURIComponent(orderId)}`, {
        cache: "no-store",
        credentials: "include"
      });
      const body = (await response.json().catch(() => null)) as ApiBody<ReceiptDetail> | null;
      if (!response.ok || body?.error || !body?.data) throw new Error(body?.error?.message ?? "โหลดรายละเอียดบิลไม่สำเร็จ");
      setDetail(body.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "โหลดรายละเอียดบิลไม่สำเร็จ");
    } finally {
      setDetailLoading(false);
    }
  }

  async function printInvoice() {
    if (!issueProfile || !detail) return;
    setPrinting(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/tax-invoices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "print_invoice",
          profile_id: issueProfile.id,
          order_id: detail.order_snapshot.order_id,
          manager_pin: managerPin
        })
      });
      const body = (await response.json().catch(() => null)) as ApiBody<{
        invoice_no?: string;
        paper_widths?: number[];
        jobs?: Array<{ id?: string; status?: string }>;
        tax_warning?: string | null;
      }> | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "พิมพ์ใบกำกับภาษีไม่สำเร็จ");
      const widths = (body?.data?.paper_widths ?? []).join("/") || "58/80";
      setSuccess(`ออกใบกำกับภาษี ${body?.data?.invoice_no ?? ""} แล้ว · กระดาษ ${widths}mm`);
      setIssueProfile(null);
      setDetail(null);
      setManagerPin("");
      await loadProfiles();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "พิมพ์ใบกำกับภาษีไม่สำเร็จ");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-slate-50 p-3 sm:p-5">
      <section className="min-h-full rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-5 sm:px-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">CpIPOS Tax Invoice</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">{lang === "th" ? "ออกใบกำกับภาษี" : "Tax Invoice"}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {lang === "th"
                ? "ทะเบียนผู้เสียภาษี → เลือกบิลย้อนหลัง → ตรวจยอดภาษีจากบิลจริง → พิมพ์ตามกระดาษ 58/80mm ของเครื่องที่ตั้งไว้"
                : "Tax registry → historical receipt → persisted tax review → configured 58/80mm receipt printer."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManageSeller ? (
              <button type="button" onClick={() => setSellerOpen(true)} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50">
                {lang === "th" ? "ตั้งค่าผู้ออกใบกำกับภาษี" : "Seller tax setup"}
              </button>
            ) : null}
            <button type="button" onClick={openNewProfile} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-blue-700">
              + {lang === "th" ? "เพิ่มรายการใหม่" : "New tax profile"}
            </button>
          </div>
        </header>

        <div className="p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void loadProfiles(search);
              }}
              placeholder={lang === "th" ? "ค้นหาชื่อ หรือเลขผู้เสียภาษี..." : "Search name or tax ID..."}
              className="h-11 min-w-[260px] flex-1 rounded-lg border border-slate-300 px-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button type="button" onClick={() => void loadProfiles(search)} className="h-11 rounded-lg bg-slate-900 px-4 text-sm font-black text-white">
              {lang === "th" ? "ค้นหา" : "Search"}
            </button>
          </div>

          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{lang === "th" ? "ชื่อสำหรับออกภาษี" : "Tax name"}</th>
                    <th className="px-4 py-3">{lang === "th" ? "ประเภท" : "Type"}</th>
                    <th className="px-4 py-3">{lang === "th" ? "เลขผู้เสียภาษี" : "Tax ID"}</th>
                    <th className="px-4 py-3">{lang === "th" ? "ที่อยู่" : "Address"}</th>
                    <th className="px-4 py-3 text-center">{lang === "th" ? "เคยออก" : "Issued"}</th>
                    <th className="px-4 py-3">{lang === "th" ? "ล่าสุด" : "Latest"}</th>
                    <th className="px-4 py-3 text-right">{lang === "th" ? "ดำเนินการ" : "Action"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleProfiles.map((profile) => (
                    <tr key={profile.id} className="hover:bg-blue-50/40">
                      <td className="px-4 py-3 font-black text-slate-950">{profile.display_name}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-600">{entityLabel(profile.entity_type, lang)}</td>
                      <td className="px-4 py-3 font-mono text-sm font-bold text-slate-700">{profile.tax_id}</td>
                      <td className="max-w-[360px] px-4 py-3 text-sm font-medium text-slate-600">
                        {profile.address_line} {profile.subdistrict} {profile.district} {profile.province} {profile.postal_code}
                      </td>
                      <td className="px-4 py-3 text-center font-black text-slate-700">{profile.invoice_count}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-500">{dateTime(profile.last_issued_at, lang)}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => openIssue(profile)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700">
                          {lang === "th" ? "เลือกบิล / ออกใบกำกับ" : "Choose bill"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && profiles.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm font-semibold text-slate-400">{lang === "th" ? "ยังไม่มีทะเบียนผู้เสียภาษี" : "No tax profiles yet."}</td></tr>
                  ) : null}
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm font-semibold text-slate-400">{lang === "th" ? "กำลังโหลด..." : "Loading..."}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {profiles.length > PAGE_SIZE ? (
            <div className="mt-4 flex items-center justify-end gap-3 text-sm font-bold text-slate-600">
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40">ก่อนหน้า</button>
              <span>หน้า {page} / {totalPages}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40">ถัดไป</button>
            </div>
          ) : null}
        </div>
      </section>

      {profileOpen ? (
        <div className="fixed inset-0 z-[210] grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <section className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div><h2 className="text-xl font-black text-slate-950">เพิ่มข้อมูลผู้เสียภาษี</h2><p className="mt-1 text-sm font-semibold text-slate-500">กรอกรหัสไปรษณีย์ก่อน ระบบจะล็อกจังหวัด/อำเภอ/ตำบลจากข้อมูลที่ถูกต้อง</p></div>
              <button type="button" disabled={profileSaving} onClick={() => setProfileOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 font-black text-slate-600">×</button>
            </header>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">ประเภทนาม
                <select value={profileForm.entity_type} onChange={(event) => setProfileForm({ ...profileForm, entity_type: event.target.value as TaxEntityType })} className="h-11 rounded-lg border border-slate-300 px-3">
                  <option value="company">บริษัท</option><option value="limited_partnership">หจก.</option><option value="shop">ร้านค้า</option><option value="individual">บุคคลธรรมดา</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">ชื่อสำหรับออกภาษี
                <input value={profileForm.display_name} onChange={(event) => setProfileForm({ ...profileForm, display_name: event.target.value })} className="h-11 rounded-lg border border-slate-300 px-3" />
              </label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">เลขผู้เสียภาษี
                <input value={profileForm.tax_id} maxLength={13} inputMode="numeric" onChange={(event) => setProfileForm({ ...profileForm, tax_id: digits(event.target.value).slice(0, 13) })} className={`h-11 rounded-lg border px-3 font-mono ${profileForm.tax_id.length === 13 && !validThaiTaxId(profileForm.tax_id) ? "border-red-400" : "border-slate-300"}`} />
              </label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">รหัสไปรษณีย์
                <input value={profileForm.postal_code} maxLength={5} inputMode="numeric" onChange={(event) => setProfileForm({ ...profileForm, postal_code: digits(event.target.value).slice(0, 5) })} className="h-11 rounded-lg border border-slate-300 px-3 font-mono" />
              </label>
              <label className="sm:col-span-2 grid gap-1.5 text-sm font-bold text-slate-700">ที่อยู่ผู้เสียภาษี (บ้านเลขที่ / หมู่ / ถนน / อาคาร)
                <input value={profileForm.address_line} onChange={(event) => setProfileForm({ ...profileForm, address_line: event.target.value })} className="h-11 rounded-lg border border-slate-300 px-3" />
              </label>

              <div className="sm:col-span-2">
                {addressLoading ? <p className="text-sm font-bold text-blue-600">กำลังค้นหาที่อยู่จากรหัสไปรษณีย์...</p> : null}
                {addressError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{addressError}</p> : null}
                {addressOptions.length > 1 && !profileForm.subdistrict ? (
                  <div className="grid gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 sm:grid-cols-2">
                    <p className="sm:col-span-2 text-sm font-black text-blue-950">รหัสนี้มีหลายพื้นที่ กรุณาเลือกให้ตรงกับที่อยู่จริง</p>
                    {addressOptions.map((option) => (
                      <button key={`${option.subdistrict_code}-${option.district_code}`} type="button" onClick={() => selectAddress(option)} className="rounded-lg border border-blue-200 bg-white p-3 text-left text-sm font-bold text-slate-700 hover:border-blue-500">
                        {option.subdistrict} · {option.district} · {option.province}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <label className="grid gap-1.5 text-sm font-bold text-slate-700">ตำบล / แขวง
                <input readOnly value={profileForm.subdistrict} className="h-11 rounded-lg border border-slate-200 bg-slate-100 px-3 font-bold text-slate-700" />
              </label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">อำเภอ / เขต
                <input readOnly value={profileForm.district} className="h-11 rounded-lg border border-slate-200 bg-slate-100 px-3 font-bold text-slate-700" />
              </label>
              <label className="sm:col-span-2 grid gap-1.5 text-sm font-bold text-slate-700">จังหวัด
                <input readOnly value={profileForm.province} className="h-11 rounded-lg border border-slate-200 bg-slate-100 px-3 font-bold text-slate-700" />
              </label>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 p-4">
              <button type="button" onClick={() => setProfileOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700">ยกเลิก</button>
              <button type="button" disabled={profileSaving} onClick={() => void saveProfile()} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{profileSaving ? "กำลังบันทึก..." : "บันทึก"}</button>
            </footer>
          </section>
        </div>
      ) : null}

      {sellerOpen ? (
        <div className="fixed inset-0 z-[215] grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <section className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between border-b border-slate-200 p-5"><div><h2 className="text-xl font-black text-slate-950">ตั้งค่าผู้ออกใบกำกับภาษี</h2><p className="mt-1 text-sm font-semibold text-slate-500">ข้อมูลร้านส่วนนี้จำเป็นก่อนพิมพ์ใบกำกับภาษีฉบับจริง</p></div><button type="button" onClick={() => setSellerOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 font-black">×</button></header>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">ชื่อผู้ออกใบกำกับภาษี<input value={sellerForm.seller_display_name} onChange={(event) => setSellerForm({ ...sellerForm, seller_display_name: event.target.value })} className="h-11 rounded-lg border border-slate-300 px-3" /></label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">เลขผู้เสียภาษีของร้าน<input value={sellerForm.seller_tax_id} maxLength={13} inputMode="numeric" onChange={(event) => setSellerForm({ ...sellerForm, seller_tax_id: digits(event.target.value).slice(0, 13) })} className="h-11 rounded-lg border border-slate-300 px-3 font-mono" /></label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">เลขสาขา<input value={sellerForm.seller_branch_no} maxLength={5} inputMode="numeric" onChange={(event) => setSellerForm({ ...sellerForm, seller_branch_no: digits(event.target.value).slice(0, 5) })} className="h-11 rounded-lg border border-slate-300 px-3 font-mono" /><span className="text-xs font-semibold text-slate-400">สำนักงานใหญ่ใช้ 00000</span></label>
              <label className="sm:col-span-2 grid gap-1.5 text-sm font-bold text-slate-700">ที่อยู่ผู้ออกใบกำกับภาษี<textarea rows={3} value={sellerForm.seller_address} onChange={(event) => setSellerForm({ ...sellerForm, seller_address: event.target.value })} className="rounded-lg border border-slate-300 p-3" /></label>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 p-4"><button type="button" onClick={() => setSellerOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2.5 font-black text-slate-700">ยกเลิก</button><button type="button" disabled={sellerSaving} onClick={() => void saveSeller()} className="rounded-lg bg-blue-600 px-5 py-2.5 font-black text-white disabled:opacity-50">{sellerSaving ? "กำลังบันทึก..." : "บันทึก"}</button></footer>
          </section>
        </div>
      ) : null}

      {issueProfile ? (
        <div className="fixed inset-0 z-[220] grid place-items-center bg-slate-950/55 p-3" role="dialog" aria-modal="true">
          <section className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Tax Invoice</p><h2 className="mt-1 text-xl font-black text-slate-950">{issueProfile.display_name}</h2><p className="mt-1 text-sm font-semibold text-slate-500">เลขผู้เสียภาษี {issueProfile.tax_id}</p></div>
              <button type="button" disabled={printing} onClick={() => setIssueProfile(null)} className="rounded-lg border border-slate-200 px-3 py-2 font-black text-slate-600">×</button>
            </header>
            <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[0.9fr_1.1fr]">
              <section className="min-h-0 overflow-y-auto border-r border-slate-200 p-4">
                <div className="flex gap-2"><input value={receiptQuery} onChange={(event) => setReceiptQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadReceipts(receiptQuery); }} placeholder="ใส่เลขที่บิล..." className="h-11 flex-1 rounded-lg border border-slate-300 px-3 font-semibold" /><button type="button" onClick={() => void loadReceipts(receiptQuery)} className="rounded-lg bg-slate-900 px-4 text-sm font-black text-white">ค้นหา</button></div>
                <p className="mt-2 text-xs font-semibold text-slate-400">ไม่กรอกเลขบิลจะแสดง 20 บิลที่ชำระล่าสุด</p>
                <div className="mt-4 grid gap-2">
                  {receiptsLoading ? <div className="rounded-lg bg-slate-50 p-6 text-center text-sm font-bold text-slate-400">กำลังค้นหา...</div> : null}
                  {!receiptsLoading && receipts.length === 0 ? <div className="rounded-lg bg-slate-50 p-6 text-center text-sm font-bold text-slate-400">ไม่พบบิล</div> : null}
                  {receipts.map((receipt) => {
                    const conflict = Boolean(receipt.invoice && receipt.invoice.profile_id !== issueProfile.id);
                    return <button key={receipt.id} type="button" disabled={conflict} onClick={() => void selectReceipt(receipt.id)} className={`rounded-xl border p-3 text-left ${detail?.order_snapshot.order_id === receipt.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"} disabled:cursor-not-allowed disabled:bg-red-50 disabled:opacity-70`}>
                      <div className="flex items-center justify-between gap-3"><strong className="text-sm font-black text-slate-950">{receipt.order_no}</strong><span className="font-black text-orange-600">{money(receipt.total, lang)}</span></div>
                      <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs font-semibold text-slate-500"><span>{dateTime(receipt.paid_at ?? receipt.created_at, lang)}</span><span>ภาษี {money(receipt.tax_total, lang)}</span></div>
                      {receipt.invoice ? <div className={`mt-2 text-xs font-black ${conflict ? "text-red-700" : "text-emerald-700"}`}>{conflict ? `ออกแล้วให้ผู้รับรายอื่น: ${receipt.invoice.invoice_no}` : `เคยออกแล้ว: ${receipt.invoice.invoice_no} · พิมพ์ ${receipt.invoice.print_count} ครั้ง`}</div> : null}
                    </button>;
                  })}
                </div>
              </section>

              <section className="min-h-0 overflow-y-auto p-4">
                {detailLoading ? <div className="grid min-h-[360px] place-items-center text-sm font-bold text-slate-400">กำลังโหลดรายละเอียดบิล...</div> : null}
                {!detailLoading && !detail ? <div className="grid min-h-[360px] place-items-center text-center text-sm font-bold text-slate-400">เลือกบิลด้านซ้ายเพื่อดูตัวอย่างก่อนออกใบกำกับภาษี</div> : null}
                {detail ? (
                  <div className="grid gap-4">
                    {!detail.seller_ready ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">ยังไม่ได้ตั้งชื่อ/ที่อยู่/เลขผู้เสียภาษีของร้าน จึงยังพิมพ์ใบกำกับภาษีไม่ได้ {canManageSeller ? <button type="button" onClick={() => setSellerOpen(true)} className="ml-2 underline">ตั้งค่าตอนนี้</button> : null}</div> : null}
                    {detail.tax.warning ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">{detail.tax.warning}</div> : null}
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase text-slate-400">ตัวอย่างใบกำกับภาษี</p><h3 className="mt-1 text-lg font-black text-slate-950">บิล {detail.order_snapshot.order_no}</h3></div>{detail.invoice ? <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">{detail.invoice.invoice_no} · Reprint</span> : <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">ยังไม่เคยออก</span>}</div>
                      <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm"><div><b>ผู้ซื้อ:</b> {issueProfile.display_name}</div><div><b>เลขผู้เสียภาษี:</b> {issueProfile.tax_id}</div><div><b>ที่อยู่:</b> {issueProfile.address_line} {issueProfile.subdistrict} {issueProfile.district} {issueProfile.province} {issueProfile.postal_code}</div></div>
                      <div className="mt-4 max-h-[240px] overflow-y-auto rounded-lg border border-slate-200"><table className="w-full text-sm"><tbody className="divide-y divide-slate-100">{detail.items.map((item, index) => <tr key={`${item.name}-${index}`}><td className="px-3 py-2"><b>{item.name}</b><div className="text-xs text-slate-400">{item.quantity} × {money(item.unit_price, lang)}</div></td><td className="px-3 py-2 text-right font-black">{money(item.line_total, lang)}</td></tr>)}</tbody></table></div>
                      <div className="mt-4 grid gap-1.5 text-sm"><div className="flex justify-between"><span>ยอดสินค้า</span><b>{money(detail.order_snapshot.subtotal, lang)}</b></div><div className="flex justify-between"><span>ส่วนลด</span><b>-{money(detail.order_snapshot.discount_amount, lang)}</b></div>{detail.tax.lines.map((line, index) => <div key={`${line.label}-${index}`} className="flex justify-between text-slate-600"><span>{line.label}{line.rate_pct > 0 ? ` ${line.rate_pct}%` : ""}</span><b>{money(line.amount, lang)}</b></div>)}{detail.tax.lines.length === 0 ? <div className="flex justify-between text-slate-600"><span>ภาษี</span><b>{money(detail.tax.tax_total, lang)}</b></div> : null}<div className="mt-1 flex justify-between border-t border-slate-300 pt-2 text-lg"><span className="font-black">ยอดสุทธิ</span><b className="text-orange-600">{money(detail.order_snapshot.grand_total, lang)}</b></div></div>
                    </div>
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><p className="text-sm font-black text-blue-950">การพิมพ์</p><p className="mt-1 text-xs font-semibold leading-5 text-blue-800">ระบบเลือก 58mm หรือ 80mm อัตโนมัติตาม Receipt/Reprint Printer ที่ผูกกับ POS เครื่องนี้ และใช้ยอดภาษี snapshot ของบิลเดิมเท่านั้น</p><label className="mt-3 grid gap-1 text-sm font-black text-blue-950">PIN Owner / Manager<input type="password" inputMode="numeric" value={managerPin} onChange={(event) => setManagerPin(event.target.value)} className="h-11 rounded-lg border border-blue-200 bg-white px-3 text-lg font-black tracking-[0.18em]" /></label></div>
                    <button type="button" disabled={printing || !detail.seller_ready || managerPin.length < 4} onClick={() => void printInvoice()} className="h-12 rounded-xl bg-blue-600 text-base font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45">{printing ? "กำลังออกและส่งพิมพ์..." : detail.invoice ? "พิมพ์ใบกำกับภาษีซ้ำ" : "ยืนยันออกใบกำกับภาษีและพิมพ์"}</button>
                  </div>
                ) : null}
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {success ? (
        <div className="fixed inset-0 z-[260] grid place-items-center bg-slate-950/25 p-4 pointer-events-none"><div className="rounded-2xl border border-emerald-200 bg-white px-6 py-5 text-center shadow-2xl"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-2xl font-black text-emerald-700">✓</div><p className="mt-3 text-base font-black text-slate-950">บันทึกสำเร็จ</p><p className="mt-1 text-sm font-semibold text-slate-600">{success}</p></div></div>
      ) : null}
    </main>
  );
}
