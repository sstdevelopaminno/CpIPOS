"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_BUFFET_PRICE_PLANS,
  buildBuffetCartItem,
  calculateBuffetPlanTotal,
  normalizeBuffetQuantity,
  type PosBuffetCartItem,
  type PosBuffetPricePlan
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
  const [selectedPlanId, setSelectedPlanId] = useState(activePlans[0]?.id ?? "");
  const [quantityInput, setQuantityInput] = useState("1");

  if (!open) return null;

  const selectedPlan = activePlans.find((plan) => plan.id === selectedPlanId) ?? activePlans[0] ?? null;
  const quantity = normalizeBuffetQuantity(quantityInput);
  const total = selectedPlan ? calculateBuffetPlanTotal(selectedPlan, quantity) : 0;
  const money = (value: number) =>
    value.toLocaleString(lang === "th" ? "th-TH" : "en-US", { style: "currency", currency: "THB" });

  const title = lang === "th" ? "เลือกชุดราคาบุฟเฟ่" : "Select buffet price";
  const subtitle = lang === "th"
    ? "เลือกแบบรายท่านหรือแบบชุด ใส่จำนวน แล้วเพิ่มรายการเข้าตะกร้าโต๊ะ"
    : "Select a per-person or set buffet price, enter quantity, and add to the table cart.";

  return (
    <div className="posui-modal-backdrop" role="presentation">
      <section className="posui-modal posui-modal--buffet" role="dialog" aria-modal="true" aria-labelledby="pos-buffet-price-title">
        <header className="posui-modal__header">
          <div>
            <p className="posui-modal__eyebrow">CpIPOS Buffet</p>
            <h2 id="pos-buffet-price-title">{title}</h2>
            <p>{subtitle}</p>
            {tableCode ? <strong>{lang === "th" ? "โต๊ะ" : "Table"}: {tableCode}</strong> : null}
          </div>
          <button type="button" className="posui-icon-button" onClick={onClose} disabled={isBusy} aria-label={lang === "th" ? "ปิด" : "Close"}>
            ×
          </button>
        </header>

        <div className="posui-buffet-plan-list" role="radiogroup" aria-label={title}>
          {activePlans.length === 0 ? (
            <div className="posui-empty-state">
              {lang === "th" ? "ยังไม่มีชุดราคาบุฟเฟ่ที่เปิดใช้งาน" : "No active buffet price plan."}
            </div>
          ) : activePlans.map((plan) => {
            const isSelected = selectedPlan?.id === plan.id;
            return (
              <button
                key={plan.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`posui-buffet-plan-card ${isSelected ? "is-selected" : ""}`}
                onClick={() => setSelectedPlanId(plan.id)}
                disabled={isBusy}
              >
                <span className="posui-buffet-plan-card__mode">
                  {plan.mode === "per_person" ? (lang === "th" ? "รายท่าน" : "Per person") : (lang === "th" ? "แบบชุด" : "Set")}
                </span>
                <strong>{plan.name}</strong>
                <em>{money(plan.price)}</em>
                {plan.description ? <small>{plan.description}</small> : null}
              </button>
            );
          })}
        </div>

        <div className="posui-buffet-qty-panel">
          <label htmlFor="pos-buffet-qty">{lang === "th" ? "จำนวน" : "Quantity"}</label>
          <div className="posui-buffet-qty-row">
            <button type="button" onClick={() => setQuantityInput(String(Math.max(1, quantity - 1)))} disabled={isBusy}>−</button>
            <input
              id="pos-buffet-qty"
              inputMode="numeric"
              value={quantityInput}
              onChange={(event) => setQuantityInput(event.target.value.replace(/[^0-9]/g, ""))}
              disabled={isBusy}
            />
            <button type="button" onClick={() => setQuantityInput(String(quantity + 1))} disabled={isBusy}>+</button>
          </div>
          <div className="posui-buffet-total-row">
            <span>{lang === "th" ? "รวมรายการบุฟเฟ่" : "Buffet total"}</span>
            <strong>{money(total)}</strong>
          </div>
        </div>

        <footer className="posui-modal__actions">
          <button type="button" className="posui-btn posui-btn--ghost" onClick={onClose} disabled={isBusy}>
            {lang === "th" ? "ยกเลิก" : "Cancel"}
          </button>
          <button
            type="button"
            className="posui-btn posui-btn--primary"
            disabled={!selectedPlan || isBusy}
            onClick={() => {
              if (!selectedPlan) return;
              onConfirm(buildBuffetCartItem({ plan: selectedPlan, quantity, tableCode }), selectedPlan);
            }}
          >
            {lang === "th" ? "เพิ่มเข้าตะกร้า" : "Add to cart"}
          </button>
        </footer>
      </section>
    </div>
  );
}
