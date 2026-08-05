"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_BUFFET_PRICE_PLANS,
  buildBuffetCartItem,
  calculateBuffetPlanTotal,
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
  plan: PosBuffetPricePlan | null;
  title: string;
  subtitle: string;
  unitLabel: string;
  icon: ReactNode;
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
      <path d="M6.8 11.2c.7-1.9 2.6-3.2 5.2-3.2s4.5 1.3 5.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function QuantityKeypadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
      <path d="M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5Zm2 3v2h2v-2H7Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2Zm-8 4v2h2v-2H7Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2Zm-8 4v2h6v-2H7Zm8 0v2h2v-2h-2Z" fill="currentColor" />
    </svg>
  );
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
  const activePlans = useMemo(() => plans.filter((plan) => plan.is_active), [plans]);
  const [selectedPlan, setSelectedPlan] = useState<PosBuffetPricePlan | null>(null);
  const [quantityInput, setQuantityInput] = useState("1");

  useEffect(() => {
    if (!open) return;
    setSelectedPlan(null);
    setQuantityInput("1");
  }, [open]);

  if (!open) return null;

  const money = (value: number) =>
    value.toLocaleString(lang === "th" ? "th-TH" : "en-US", { style: "currency", currency: "THB" });

  const perPersonPlan = activePlans.find((plan) => plan.mode === "per_person") ?? null;
  const setPlan = activePlans.find((plan) => plan.mode === "set") ?? null;
  const packageOptions: BuffetOption[] = [
    {
      mode: "per_person",
      plan: perPersonPlan,
      title: lang === "th" ? "บุฟเฟ่รายท่าน" : "Per-person buffet",
      subtitle: lang === "th" ? "คิดราคาตามจำนวนลูกค้า" : "Charge by guest count",
      unitLabel: lang === "th" ? "ท่าน" : "person",
      icon: <PerPersonIcon />
    },
    {
      mode: "set",
      plan: setPlan,
      title: lang === "th" ? "บุฟเฟ่แบบชุด" : "Buffet set",
      subtitle: lang === "th" ? "คิดราคาตามจำนวนชุด" : "Charge by set count",
      unitLabel: lang === "th" ? "ชุด" : "set",
      icon: <BuffetSetIcon />
    }
  ];

  const selectedOption = packageOptions.find((option) => option.plan?.id === selectedPlan?.id) ?? null;
  const quantity = quantityInput.trim() ? Math.max(0, Math.trunc(Number(quantityInput))) : 0;
  const total = selectedPlan && quantity > 0 ? calculateBuffetPlanTotal(selectedPlan, quantity) : 0;
  const keypadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "00"];

  const closeModal = () => {
    if (isBusy) return;
    setSelectedPlan(null);
    setQuantityInput("1");
    onClose();
  };

  const appendKey = (key: string) => {
    if (isBusy) return;
    setQuantityInput((current) => {
      const next = `${current}${key}`.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/u, "");
      return next.slice(0, 3);
    });
  };

  const clearQuantity = () => {
    if (isBusy) return;
    setQuantityInput("");
  };

  const deleteQuantity = () => {
    if (isBusy) return;
    setQuantityInput((current) => current.slice(0, -1));
  };

  const confirmQuantity = () => {
    if (!selectedPlan || isBusy || quantity <= 0) return;
    onConfirm(buildBuffetCartItem({ plan: selectedPlan, quantity, tableCode }), selectedPlan);
    setSelectedPlan(null);
    setQuantityInput("1");
  };

  return (
    <div className="posui-modal-backdrop" role="presentation">
      <section className="posui-modal posui-modal--buffet w-[min(820px,94vw)]" role="dialog" aria-modal="true" aria-labelledby="pos-buffet-price-title">
        <header className="posui-modal__header">
          <div>
            <p className="posui-modal__eyebrow">CpIPOS Buffet</p>
            <h2 id="pos-buffet-price-title">
              {selectedPlan ? (lang === "th" ? "ใส่จำนวนบุฟเฟ่" : "Enter buffet quantity") : lang === "th" ? "เลือกชุดราคาบุฟเฟ่" : "Select buffet price"}
            </h2>
            <p>
              {selectedPlan
                ? lang === "th"
                  ? "ใช้แป้นตัวเลขเพื่อใส่จำนวน แล้วกดยืนยันเพื่อเพิ่มเข้าตะกร้า"
                  : "Use the keypad to enter quantity, then confirm to add it to the cart."
                : lang === "th"
                  ? "เลือกประเภทราคาบุฟเฟ่ก่อน แล้วระบบจะให้ใส่จำนวนในขั้นถัดไป"
                  : "Select a buffet price type first, then enter quantity in the next step."}
            </p>
            {tableCode ? <strong>{lang === "th" ? "โต๊ะ" : "Table"}: {tableCode}</strong> : null}
          </div>
          <button type="button" className="posui-icon-button" onClick={closeModal} disabled={isBusy} aria-label={lang === "th" ? "ปิด" : "Close"}>
            ×
          </button>
        </header>

        {!selectedPlan ? (
          <div className="grid gap-4 md:grid-cols-2" role="list" aria-label={lang === "th" ? "เลือกประเภทราคาบุฟเฟ่" : "Buffet price type"}>
            {packageOptions.map((option) => {
              const plan = option.plan;
              const disabled = !plan || isBusy;
              return (
                <button
                  key={option.mode}
                  type="button"
                  role="listitem"
                  className={`group rounded-3xl border p-5 text-left shadow-sm transition ${disabled ? "border-slate-200 bg-slate-50 opacity-60" : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/60 hover:shadow-lg"}`}
                  onClick={() => {
                    if (!plan) return;
                    setSelectedPlan(plan);
                    setQuantityInput("1");
                  }}
                  disabled={disabled}
                >
                  <span className="mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-blue-50 text-blue-700 transition group-hover:bg-blue-600 group-hover:text-white">
                    {option.icon}
                  </span>
                  <span className="block text-xl font-black text-slate-950">{option.title}</span>
                  <span className="mt-1 block text-sm font-semibold text-slate-500">{option.subtitle}</span>
                  <span className="mt-5 flex items-end justify-between gap-3">
                    <strong className="text-3xl font-black text-orange-600">{plan ? money(plan.price) : "-"}</strong>
                    <small className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                      / {option.unitLabel}
                    </small>
                  </span>
                  {plan?.description ? <span className="mt-3 block text-xs font-bold text-slate-400">{plan.description}</span> : null}
                </button>
              );
            })}
            {activePlans.length === 0 ? (
              <div className="posui-empty-state md:col-span-2">
                {lang === "th" ? "ยังไม่มีชุดราคาบุฟเฟ่ที่เปิดใช้งาน" : "No active buffet price plan."}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
            <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-start gap-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-3xl bg-blue-600 text-white">
                  {selectedOption?.icon ?? <QuantityKeypadIcon />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-500">{selectedOption?.title ?? selectedPlan.name}</p>
                  <h3 className="truncate text-2xl font-black text-slate-950">{selectedPlan.name}</h3>
                  <p className="mt-1 text-sm font-bold text-slate-500">
                    {money(selectedPlan.price)} / {selectedOption?.unitLabel ?? (lang === "th" ? "หน่วย" : "unit")}
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-3xl border border-dashed border-blue-200 bg-white p-5">
                <p className="text-sm font-black text-slate-500">{lang === "th" ? "จำนวน" : "Quantity"}</p>
                <div className="mt-2 text-6xl font-black tracking-tight text-blue-700">{quantityInput || "0"}</div>
              </div>

              <div className="mt-5 flex items-center justify-between rounded-3xl bg-white p-5 shadow-sm">
                <span className="text-sm font-black text-slate-500">{lang === "th" ? "รวมรายการบุฟเฟ่" : "Buffet total"}</span>
                <strong className="text-4xl font-black text-orange-600">{money(total)}</strong>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm" aria-label={lang === "th" ? "แป้นตัวเลข" : "Numeric keypad"}>
              <div className="mb-2 flex items-center gap-2 px-1 text-sm font-black text-slate-500">
                <QuantityKeypadIcon />
                <span>{lang === "th" ? "แป้นตัวเลข" : "Keypad"}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {keypadKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="h-14 rounded-2xl border border-slate-200 bg-slate-50 text-xl font-black text-slate-950 transition hover:border-blue-300 hover:bg-blue-50"
                    onClick={() => appendKey(key)}
                    disabled={isBusy}
                  >
                    {key}
                  </button>
                ))}
                <button
                  type="button"
                  className="h-14 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-700 transition hover:bg-slate-50"
                  onClick={clearQuantity}
                  disabled={isBusy}
                >
                  {lang === "th" ? "ล้าง" : "Clear"}
                </button>
                <button
                  type="button"
                  className="col-span-2 h-14 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-700 transition hover:bg-slate-50"
                  onClick={deleteQuantity}
                  disabled={isBusy}
                >
                  {lang === "th" ? "ลบ" : "Delete"}
                </button>
              </div>
            </section>
          </div>
        )}

        <footer className="posui-modal__actions">
          {selectedPlan ? (
            <button type="button" className="posui-btn posui-btn--ghost" onClick={() => setSelectedPlan(null)} disabled={isBusy}>
              {lang === "th" ? "ย้อนกลับ" : "Back"}
            </button>
          ) : null}
          <button type="button" className="posui-btn posui-btn--ghost" onClick={closeModal} disabled={isBusy}>
            {lang === "th" ? "ยกเลิก" : "Cancel"}
          </button>
          {selectedPlan ? (
            <button type="button" className="posui-btn posui-btn--primary" disabled={isBusy || quantity <= 0} onClick={confirmQuantity}>
              {lang === "th" ? "ยืนยัน" : "Confirm"}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
