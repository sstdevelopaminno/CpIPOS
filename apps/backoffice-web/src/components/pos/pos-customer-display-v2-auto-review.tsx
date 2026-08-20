"use client";

import { useEffect, useState } from "react";
import { PosCustomerDisplayV2Screen, type CustomerDisplayV2Phase, type CustomerDisplayV2ScreenState } from "@/components/pos/pos-customer-display-v2-screen";
import type { Language } from "@/lib/i18n";

const STEPS: Array<{ phase: CustomerDisplayV2Phase; durationMs: number }> = [
  { phase: "idle", durationMs: 7_000 },
  { phase: "cart", durationMs: 8_000 },
  { phase: "cash", durationMs: 7_000 },
  { phase: "qr", durationMs: 8_000 },
  { phase: "paid", durationMs: 7_000 }
];

const ITEMS = [
  { product_id: "coffee", name: "ลาเต้เย็น", quantity: 2, price: 75 },
  { product_id: "toast", name: "ขนมปังปิ้งเนยนม", quantity: 1, price: 65 },
  { product_id: "water", name: "น้ำดื่ม", quantity: 2, price: 20 }
];

export function PosCustomerDisplayV2AutoReview({ lang }: { lang: Language }) {
  const [stepIndex, setStepIndex] = useState(0);
  const phase = STEPS[stepIndex]?.phase ?? "idle";

  useEffect(() => {
    const current = STEPS[stepIndex] ?? STEPS[0];
    const timer = window.setTimeout(() => setStepIndex((index) => (index + 1) % STEPS.length), current.durationMs);
    return () => window.clearTimeout(timer);
  }, [stepIndex]);

  const state: CustomerDisplayV2ScreenState = {
    phase,
    store_name: lang === "th" ? "ร้านทดสอบ 900001" : "Test Store 900001",
    store_logo_url: null,
    branch_name: lang === "th" ? "สาขาทดสอบ Preview" : "Preview Test Branch",
    device_name: "POS-01",
    order_no: "#PV-20260820-001",
    items: ITEMS,
    total_amount: 255,
    cash_received: phase === "cash" || phase === "paid" ? 500 : null,
    change_amount: phase === "cash" || phase === "paid" ? 245 : null,
    payment_qr_url: null,
    media_urls: []
  };

  return <PosCustomerDisplayV2Screen lang={lang} state={state} />;
}
