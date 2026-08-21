"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  EMPTY_BUFFET_TABLE_SESSION_SUMMARY,
  type BuffetTableSessionSummary
} from "@/lib/buffet-table-session";
import {
  DEFAULT_BUFFET_PRICE_PLANS,
  adjustBuffetQuantity,
  buildBuffetCartItem,
  calculateBuffetPlanTotal,
  selectBuffetQuickQuantity,
  type PosBuffetCartItem,
  type PosBuffetPricePlan,
  type PosBuffetPricingMode
} from "@/lib/pos-buffet-pricing";

type Lang = "th" | "en";

type Props = {
  open: boolean;
  lang?: Lang;
  tableCode?: string | null;
  plans?: PosBuffetPricePlan[];
  isBusy?: boolean;
  onClose: () => void;
  onConfirm: (item: PosBuffetCartItem, plan: PosBuffetPricePlan) => void;
};

type BuffetOption = {
  mode: PosBuffetPricingMode;
  plan: PosBuffetPricePlan;
  title: string;
  subtitle: string;
  unitLabel: string;
  icon: ReactNode;
};

type BuffetProductResolveBody = {
  error?: { code?: string; message?: string } | null;
  data?: {
    product_id?: string | null;
    name?: string | null;
    price?: number | null;
    plans?: PosBuffetPricePlan[];
    source?: string | null;
  } | null;
};

type BuffetSessionBody = {
  error?: { code?: string; message?: string } | null;
  data?: {
    table_id?: string | null;
    table_code?: string | null;
    table_name?: string | null;
    order_id?: string | null;
    active?: boolean;
    summary?: BuffetTableSessionSummary;
  } | null;
};

type BuffetAccessBody = {
  error?: { code?: string; message?: string } | null;
  data?: {
    access?: {
      mode?: PosBuffetPricingMode;
      plan_product_id?: string;
      plan_code?: string;
      plan_name?: string;
    } | null;
  } | null;
};

type OrderCreatedEventDetail = {
  order_id?: string | null;
  order_type?: string | null;
  table_id?: string | null;
};

type ResolvedBuffetProduct = {
  productId: string;
  name: string;
  price: number;
};

type TableContext = {
  tableId: string;
  orderId: string;
};

function PerPersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8">
      <path d="M8.5 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM15.8 12.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.8 20.2v-1.4c0-3 2.1-5.2 4.7-5.2s4.7 2.2 4.7 5.2v1.4H3.8ZM13.5 20.2v-1.6c0-1.7-.5-3.2-1.5-4.4.8-.5 1.9-.8 3.1-.8 2.8 0 5.1 2 5.1 4.8v2h-6.7Z" fill="currentColor" />
    </svg>
  );
}

function BuffetSetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8">
      <path d="M11 4.25a1 1 0 1 1 2 0v1.02a8.01 8.01 0 0 1 7 7.93H4a8.01 8.01 0 0 1 7-7.93V4.25ZM3 15.2h18v1.3a3.25 3.25 0 0 1-3.25 3.25H6.25A3.25 3.25 0 0 1 3 16.5v-1.3Z" fill="currentColor" />
      <path d="M6.8 11.2c.7-1.9 2.6-3.2 5.2-3.2s4.5 1.3 5.2 3.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function QuantityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
      <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 9h8M8 13h8M8 17h5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function rememberBuffetMode() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem("cpipos_active_sales_mode_label", "buffet_table");
  window.dispatchEvent(new CustomEvent("cpipos:sales-mode-label-change", { detail: { mode: "buffet_table" } }));
}

function clearCancelledTableStorage(tableId: string) {
  try {
    window.localStorage.removeItem("pos_dine_in_selected_table_v001");
    window.localStorage.removeItem("pos_active_order_v001");
    const raw = window.localStorage.getItem("pos_dine_in_draft_v001");
    if (raw) {
      const drafts = JSON.parse(raw) as Record<string, unknown>;
      if (drafts && typeof drafts === "object" && !Array.isArray(drafts)) {
        delete drafts[tableId];
        if (Object.keys(drafts).length > 0) window.localStorage.setItem("pos_dine_in_draft_v001", JSON.stringify(drafts));
        else window.localStorage.removeItem("pos_dine_in_draft_v001");
      }
    }
  } catch {
    // Storage cleanup is best effort; server cancellation remains authoritative.
  }
}

async function resolveBuffetProduct(plan: PosBuffetPricePlan): Promise<ResolvedBuffetProduct> {
  const response = await fetch("/api/pos/buffet-products/resolve", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      product_id: plan.product_id ?? null,
      plan_id: plan.id,
      code: plan.code,
      name: plan.name,
      mode: plan.mode,
      price: plan.price
    })
  });
  const body = (await response.json().catch(() => null)) as BuffetProductResolveBody | null;
  if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "Failed to resolve buffet product.");
  const productId = String(body?.data?.product_id ?? "").trim();
  const price = Number(body?.data?.price ?? plan.price);
  if (!productId) throw new Error("Buffet product resolver returned no product_id.");
  if (!Number.isFinite(price) || price <= 0) throw new Error("Buffet product resolver returned an invalid price.");
  return {
    productId,
    name: String(body?.data?.name ?? plan.name).trim() || plan.name,
    price
  };
}

async function lockBuffetPackageToTable(tableCode: string, planProductId: string) {
  const response = await fetch("/api/pos/buffet-table/access", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ table_code: tableCode, plan_product_id: planProductId })
  });
  const body = (await response.json().catch(() => null)) as BuffetAccessBody | null;
  if (!response.ok || body?.error) {
    throw new Error(body?.error?.message ?? "Failed to lock buffet package to this table.");
  }
  return body?.data?.access ?? null;
}

export function PosBuffetPricePickerModal({
  open,
  lang = "th",
  tableCode,
  plans = DEFAULT_BUFFET_PRICE_PLANS,
  isBusy = false,
  onClose,
  onConfirm
}: Props) {
  const [runtimePlans, setRuntimePlans] = useState<PosBuffetPricePlan[]>(plans);
  const activePlans = useMemo(() => runtimePlans.filter((plan) => plan.is_active && plan.price > 0 && !plan.draft), [runtimePlans]);
  const [selectedPlan, setSelectedPlan] = useState<PosBuffetPricePlan | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<BuffetTableSessionSummary>({ ...EMPTY_BUFFET_TABLE_SESSION_SUMMARY });
  const [tableContext, setTableContext] = useState<TableContext>({ tableId: "", orderId: "" });
  const [resolvingProduct, setResolvingProduct] = useState(false);
  const [cancelingBill, setCancelingBill] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    const onOrderCreated = (event: Event) => {
      const detail = (event as CustomEvent<OrderCreatedEventDetail>).detail;
      const orderId = String(detail?.order_id ?? "").trim();
      const tableId = String(detail?.table_id ?? "").trim();
      if (detail?.order_type !== "dine_in" || !orderId || !tableId) return;
      setTableContext({ tableId, orderId });
      void fetch("/api/pos/buffet-table/session", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId, table_id: tableId })
      })
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json().catch(() => null)) as BuffetSessionBody | null;
          const summary = body?.data?.summary;
          if (summary) {
            window.dispatchEvent(new CustomEvent("cpipos:buffet-session-synced", { detail: { table_id: tableId, order_id: orderId, summary } }));
          }
        })
        .catch(() => undefined);
    };
    window.addEventListener("pos:sales:order-created", onOrderCreated);
    return () => window.removeEventListener("pos:sales:order-created", onOrderCreated);
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setRuntimePlans(plans);
    setSelectedPlan(null);
    setQuantity(1);
    setLoadingPlans(true);
    setLoadingSession(Boolean(tableCode));
    setSessionSummary({ ...EMPTY_BUFFET_TABLE_SESSION_SUMMARY });
    setTableContext({ tableId: "", orderId: "" });
    setResolvingProduct(false);
    setCancelingBill(false);
    setResolveError(null);

    void fetch("/api/pos/buffet-products/resolve", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as BuffetProductResolveBody | null;
        if (!response.ok || body?.error || !Array.isArray(body?.data?.plans)) throw new Error(body?.error?.message ?? "Failed to load buffet plans.");
        setRuntimePlans(body.data.plans);
      })
      .catch((error) => {
        if ((error as { name?: string }).name !== "AbortError") setRuntimePlans(plans);
      })
      .finally(() => setLoadingPlans(false));

    if (tableCode) {
      void fetch(`/api/pos/buffet-table/session?table_code=${encodeURIComponent(tableCode)}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" }
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as BuffetSessionBody | null;
          if (!response.ok || body?.error) return;
          setTableContext({
            tableId: String(body?.data?.table_id ?? "").trim(),
            orderId: String(body?.data?.order_id ?? "").trim()
          });
          if (body?.data?.summary) setSessionSummary(body.data.summary);
        })
        .catch((error) => {
          if ((error as { name?: string }).name !== "AbortError") setSessionSummary({ ...EMPTY_BUFFET_TABLE_SESSION_SUMMARY });
        })
        .finally(() => setLoadingSession(false));
    } else {
      setLoadingSession(false);
    }

    return () => controller.abort();
  }, [open, plans, tableCode]);

  if (!open) return null;

  const existingBuffet = sessionSummary.enabled;
  const actionBusy = isBusy || resolvingProduct || loadingPlans || loadingSession || cancelingBill;
  const money = (value: number) => value.toLocaleString(lang === "th" ? "th-TH" : "en-US", { style: "currency", currency: "THB" });
  const total = selectedPlan ? calculateBuffetPlanTotal(selectedPlan, quantity) : 0;
  const packageOptions: BuffetOption[] = activePlans.map((plan) => ({
    mode: plan.mode,
    plan,
    title: existingBuffet ? (lang === "th" ? `เพิ่ม ${plan.name}` : `Add ${plan.name}`) : plan.name,
    subtitle: existingBuffet
      ? plan.mode === "per_person"
        ? (lang === "th" ? `ปัจจุบัน ${sessionSummary.per_person_quantity} ท่าน` : `Current ${sessionSummary.per_person_quantity} guest(s)`)
        : (lang === "th" ? `ปัจจุบัน ${sessionSummary.set_quantity} ชุด` : `Current ${sessionSummary.set_quantity} set(s)`)
      : plan.description || (plan.mode === "per_person" ? (lang === "th" ? "คิดราคาตามจำนวนลูกค้า" : "Charge by guest count") : (lang === "th" ? "คิดราคาตามจำนวนชุด" : "Charge by set count")),
    unitLabel: plan.mode === "per_person" ? (lang === "th" ? "ท่าน" : "person") : (lang === "th" ? "ชุด" : "set"),
    icon: plan.mode === "per_person" ? <PerPersonIcon /> : <BuffetSetIcon />
  }));
  const selectedOption = packageOptions.find((option) => option.plan.id === selectedPlan?.id) ?? null;

  const closeModal = () => {
    if (actionBusy) return;
    setSelectedPlan(null);
    setQuantity(1);
    setResolveError(null);
    onClose();
  };

  const cancelNewBuffetBill = async () => {
    if (actionBusy) return;
    if (existingBuffet || tableContext.orderId) {
      setResolveError(
        lang === "th"
          ? "บิลนี้มีรายการที่บันทึกแล้ว เพื่อความปลอดภัยให้ใช้ปุ่ม “ยกเลิกบิล” ในหน้าขายซึ่งมีการตรวจสิทธิ์ผู้จัดการ"
          : "This bill already has saved items. Use Cancel Bill on the sales screen so manager approval remains enforced."
      );
      return;
    }
    if (!tableContext.tableId) {
      setResolveError(lang === "th" ? "ยังไม่พบข้อมูลโต๊ะสำหรับยกเลิก กรุณาลองอีกครั้ง" : "Table context is not ready yet. Please try again.");
      return;
    }

    setCancelingBill(true);
    setResolveError(null);
    try {
      const response = await fetch(`/api/pos/tables/${encodeURIComponent(tableContext.tableId)}/cancel-empty-bill`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } | null } | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "Failed to cancel buffet table bill.");
      clearCancelledTableStorage(tableContext.tableId);
      rememberBuffetMode();
      window.location.assign("/preview/pos?return_mode=buffet_table");
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : lang === "th" ? "ยกเลิกบิลไม่สำเร็จ" : "Failed to cancel bill.");
      setCancelingBill(false);
    }
  };

  const confirmQuantity = async () => {
    if (!selectedPlan || actionBusy || quantity <= 0) return;
    setResolvingProduct(true);
    setResolveError(null);
    try {
      const resolved = await resolveBuffetProduct(selectedPlan);
      if (!tableCode) throw new Error(lang === "th" ? "ไม่พบรหัสโต๊ะบุฟเฟ่ กรุณากลับไปเลือกโต๊ะใหม่" : "Buffet table code is missing. Please select the table again.");
      await lockBuffetPackageToTable(tableCode, resolved.productId);
      const effectivePlan: PosBuffetPricePlan = {
        ...selectedPlan,
        product_id: resolved.productId,
        name: resolved.name,
        price: resolved.price
      };
      rememberBuffetMode();
      const virtualItem = buildBuffetCartItem({ plan: effectivePlan, quantity, tableCode });
      onConfirm({ ...virtualItem, product_id: resolved.productId }, effectivePlan);
      setSessionSummary((current) => {
        const perPersonQuantity = current.per_person_quantity + (effectivePlan.mode === "per_person" ? quantity : 0);
        const setQuantity = current.set_quantity + (effectivePlan.mode === "set" ? quantity : 0);
        return {
          enabled: true,
          per_person_quantity: perPersonQuantity,
          set_quantity: setQuantity,
          total_quantity: perPersonQuantity + setQuantity,
          subtotal: Number((current.subtotal + resolved.price * quantity).toFixed(2)),
          updated_at: new Date().toISOString()
        };
      });
      setSelectedPlan(null);
      setQuantity(1);
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : "Failed to prepare buffet product.");
    } finally {
      setResolvingProduct(false);
    }
  };

  const handleCloseOrCancel = () => {
    if (existingBuffet) closeModal();
    else void cancelNewBuffetBill();
  };

  return (
    <div className="posui-modal-backdrop" role="presentation">
      <section className="posui-modal posui-modal--buffet w-[min(900px,94vw)]" role="dialog" aria-modal="true" aria-labelledby="pos-buffet-price-title">
        <header className="posui-modal__header items-start gap-5 pb-5">
          <div className="min-w-0">
            <p className="posui-modal__eyebrow">CpIPOS Buffet</p>
            <h2 id="pos-buffet-price-title">
              {selectedPlan
                ? (lang === "th" ? "เลือกจำนวน" : "Choose quantity")
                : loadingSession
                  ? (lang === "th" ? "กำลังตรวจสอบโต๊ะบุฟเฟ่" : "Checking buffet table")
                  : existingBuffet
                    ? (lang === "th" ? "โต๊ะนี้เปิดบุฟเฟ่แล้ว" : "Buffet is already open")
                    : (lang === "th" ? "เลือกชุดราคาบุฟเฟ่" : "Select buffet price")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm font-semibold text-slate-500">
              {selectedPlan
                ? (lang === "th" ? "กด 1–9 เพื่อเลือกจำนวนนั้นโดยตรง ถ้ามากกว่า 9 ให้ใช้ปุ่ม + เพิ่มทีละ 1" : "Tap 1–9 for the exact quantity. Use + to increase beyond 9.")
                : loadingPlans || loadingSession
                  ? (lang === "th" ? "กำลังโหลดข้อมูลบุฟเฟ่ของสาขา..." : "Loading branch buffet data...")
                  : existingBuffet
                    ? (lang === "th" ? "เปิดโต๊ะเดิมจะไม่คิดค่าบุฟเฟ่ซ้ำ เลือกรายการเฉพาะเมื่อต้องการเพิ่มจำนวน" : "Reopening the table does not double-charge buffet fees. Choose a plan only to add quantity.")
                    : (lang === "th" ? "ราคาที่เปิดใช้งานทั้งหมดจากเมนูตั้งค่าราคาบุฟเฟ่จะแสดงที่นี่" : "All active prices from Buffet Price Settings are shown here.")}
            </p>
          </div>
          <button type="button" className="posui-icon-button shrink-0" onClick={handleCloseOrCancel} disabled={actionBusy} aria-label={lang === "th" ? "ปิด" : "Close"}>×</button>
        </header>

        {!selectedPlan && existingBuffet ? (
          <section className="mb-5 grid gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 sm:grid-cols-3">
            <div><span className="block text-xs font-black text-emerald-700">{lang === "th" ? "ลูกค้าบุฟเฟ่" : "Guests"}</span><strong className="mt-1 block text-2xl font-black text-emerald-950">{sessionSummary.per_person_quantity} {lang === "th" ? "ท่าน" : "guest(s)"}</strong></div>
            <div><span className="block text-xs font-black text-emerald-700">{lang === "th" ? "บุฟเฟ่แบบชุด" : "Sets"}</span><strong className="mt-1 block text-2xl font-black text-emerald-950">{sessionSummary.set_quantity} {lang === "th" ? "ชุด" : "set(s)"}</strong></div>
            <div><span className="block text-xs font-black text-emerald-700">{lang === "th" ? "ยอดบุฟเฟ่ในบิล" : "Buffet subtotal"}</span><strong className="mt-1 block text-2xl font-black text-emerald-950">{money(sessionSummary.subtotal)}</strong></div>
          </section>
        ) : null}

        {!selectedPlan ? (
          <div className="mt-2 grid max-h-[55vh] gap-4 overflow-y-auto p-1 md:grid-cols-2" role="list">
            {packageOptions.map((option) => (
              <button
                key={option.plan.id}
                type="button"
                role="listitem"
                className="group rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/60 hover:shadow-lg"
                onClick={() => {
                  setSelectedPlan(option.plan);
                  setQuantity(1);
                  setResolveError(null);
                }}
                disabled={actionBusy}
              >
                <span className="mb-5 grid h-14 w-14 place-items-center rounded-3xl bg-blue-50 text-blue-700 transition group-hover:bg-blue-600 group-hover:text-white">{option.icon}</span>
                <span className="block text-xl font-black text-slate-950">{option.title}</span>
                <span className="mt-2 block text-sm font-semibold text-slate-500">{option.subtitle}</span>
                <span className="mt-6 flex items-end justify-between gap-3">
                  <strong className="text-3xl font-black text-orange-600">{money(option.plan.price)}</strong>
                  <small className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">/ {option.unitLabel}</small>
                </span>
              </button>
            ))}
            {activePlans.length === 0 && !loadingPlans ? <div className="posui-empty-state md:col-span-2">{lang === "th" ? "ยังไม่มีราคาบุฟเฟ่ที่เปิดใช้งาน" : "No active buffet price plan."}</div> : null}
          </div>
        ) : (
          <div className="mt-2 grid gap-6 lg:grid-cols-[minmax(0,1fr)_270px]">
            <section className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
              <div className="flex items-start gap-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-3xl bg-blue-600 text-white">{selectedOption?.icon ?? <QuantityIcon />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-500">{selectedPlan.mode === "per_person" ? (lang === "th" ? "บุฟเฟ่รายท่าน" : "Per-person") : (lang === "th" ? "บุฟเฟ่แบบชุด" : "Buffet set")}</p>
                  <h3 className="truncate text-2xl font-black text-slate-950">{selectedPlan.name}</h3>
                  <p className="mt-1 text-sm font-bold text-slate-500">{money(selectedPlan.price)} / {selectedOption?.unitLabel ?? (lang === "th" ? "หน่วย" : "unit")}</p>
                </div>
              </div>
              <div className="mt-7 rounded-3xl border border-dashed border-blue-200 bg-white p-6">
                <p className="text-sm font-black text-slate-500">{lang === "th" ? "จำนวนที่เพิ่ม" : "Additional quantity"}</p>
                <div className="mt-3 text-6xl font-black tracking-tight text-blue-700">{quantity}</div>
              </div>
              <div className="mt-6 flex items-center justify-between rounded-3xl bg-white p-6 shadow-sm">
                <span className="text-sm font-black text-slate-500">{lang === "th" ? "ยอดที่เพิ่ม" : "Additional total"}</span>
                <strong className="text-4xl font-black text-orange-600">{money(total)}</strong>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm" aria-label={lang === "th" ? "เลือกจำนวน" : "Quantity selector"}>
              <div className="mb-4 flex items-center gap-2 px-1 text-sm font-black text-slate-500"><QuantityIcon /><span>{lang === "th" ? "เลือกจำนวน" : "Quantity"}</span></div>
              <div className="grid grid-cols-3 gap-3">
                {[1,2,3,4,5,6,7,8,9].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`h-14 rounded-2xl border text-xl font-black transition ${quantity === value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-slate-50 text-slate-950 hover:border-blue-300 hover:bg-blue-50"}`}
                    onClick={() => setQuantity(selectBuffetQuickQuantity(value))}
                    disabled={actionBusy}
                  >{value}</button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button type="button" className="h-14 rounded-2xl border border-slate-200 bg-white text-2xl font-black text-slate-700 hover:bg-slate-50" onClick={() => setQuantity((current) => adjustBuffetQuantity(current, -1))} disabled={actionBusy || quantity <= 1}>−</button>
                <button type="button" className="h-14 rounded-2xl border border-blue-200 bg-blue-50 text-2xl font-black text-blue-700 hover:bg-blue-100" onClick={() => setQuantity((current) => adjustBuffetQuantity(current, 1))} disabled={actionBusy || quantity >= 999}>+</button>
              </div>
              <p className="mt-3 text-center text-xs font-bold text-slate-400">{lang === "th" ? "มากกว่า 9 กด + เพิ่มทีละ 1" : "Above 9, use +1"}</p>
            </section>
          </div>
        )}

        {resolveError ? <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-700">{resolveError}</p> : null}

        <footer className="posui-modal__actions mt-7 flex flex-wrap justify-end gap-4 pt-2">
          {selectedPlan ? <button type="button" className="posui-btn posui-btn--ghost min-w-28" onClick={() => { setSelectedPlan(null); setQuantity(1); }} disabled={actionBusy}>{lang === "th" ? "ย้อนกลับ" : "Back"}</button> : null}
          <button type="button" className="posui-btn posui-btn--ghost min-w-28" onClick={handleCloseOrCancel} disabled={actionBusy}>
            {cancelingBill
              ? (lang === "th" ? "กำลังยกเลิกบิล..." : "Cancelling...")
              : existingBuffet
                ? (lang === "th" ? "เข้าหน้าขายต่อ" : "Continue sale")
                : (lang === "th" ? "ยกเลิกบิล" : "Cancel bill")}
          </button>
          {selectedPlan ? (
            <button type="button" className="posui-btn posui-btn--primary min-w-28" disabled={actionBusy || quantity <= 0} onClick={() => void confirmQuantity()}>
              {resolvingProduct ? (lang === "th" ? "กำลังเตรียม..." : "Preparing...") : existingBuffet ? (lang === "th" ? "ยืนยันเพิ่ม" : "Add") : (lang === "th" ? "ยืนยัน" : "Confirm")}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
