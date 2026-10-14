import type { ReceiptTemplate } from "@pos/shared-types";
import { renderReceiptTemplate } from "@/lib/printing/print-service";

export type ReceiptLanguage = "th" | "en" | "lo";
export type ReceiptCurrency = "THB" | "LAK";

const caption = {
  th: { branch: "สาขา", bill: "เลขที่บิล", date: "วันที่", seller: "ผู้ขาย", mode: "โหมด", items: "รายการ",
    subtotal: "ยอดก่อนลด", discount: "ส่วนลด", tax: "ภาษี", total: "ยอดสุทธิ",
    payment: "ชำระเงิน", cash: "รับเงิน", change: "เงินทอน", thanks: "ขอบคุณที่ใช้บริการ", copy: "สำเนาใบเสร็จ" },
  en: { branch: "Branch", bill: "Bill no.", date: "Date", seller: "Seller", mode: "Mode", items: "Items",
    subtotal: "Subtotal", discount: "Discount", tax: "Tax", total: "Net total",
    payment: "Payment", cash: "Cash received", change: "Change", thanks: "Thank you", copy: "Receipt copy" },
  lo: { branch: "ສາຂາ", bill: "ເລກໃບບິນ", date: "ວັນທີ", seller: "ຜູ້ຂາຍ", mode: "ໂໝດ", items: "ລາຍການ",
    subtotal: "ຍອດກ່ອນຫຼຸດ", discount: "ສ່ວນຫຼຸດ", tax: "ພາສີ", total: "ຍອດສຸດທິ",
    payment: "ການຊຳລະ", cash: "ຮັບເງິນ", change: "ເງິນທອນ", thanks: "ຂອບໃຈທີ່ໃຊ້ບໍລິການ", copy: "ສຳເນົາໃບຮັບເງິນ" }
} as const;

export function renderLocalizedReceiptText(template: ReceiptTemplate, paper: 58 | 80, language: ReceiptLanguage, currency: ReceiptCurrency) {
  // Preserve established Thai THB output on ordinary packages.
  if (language === "th" && currency === "THB") return renderReceiptTemplate(template, paper);
  const L = caption[language];
  const symbol = currency === "LAK" ? "₭" : "฿";
  const fmt = (value: unknown) => {
    const number = Number(value ?? 0);
    return symbol + (Number.isFinite(number) ? number : 0).toLocaleString("en-US", {
      minimumFractionDigits: currency === "LAK" ? 0 : 2,
      maximumFractionDigits: currency === "LAK" ? 0 : 2
    });
  };
  const store = template as unknown as Record<string, unknown>;
  const label = (name: string, value: string) => name + ": " + value;
  const date = new Date(template.paid_at_iso);
  const when = Number.isNaN(date.getTime()) ? template.paid_at_iso : new Intl.DateTimeFormat(
    language === "lo" ? "lo-LA" : language === "en" ? "en-US" : "th-TH",
    { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }
  ).format(date);
  const method: Record<string, Record<ReceiptLanguage, string>> = {
    cash: { th: "เงินสด", en: "Cash", lo: "ເງິນສົດ" },
    bank_transfer: { th: "โอนเงิน", en: "Bank transfer", lo: "ໂອນເງິນ" },
    card: { th: "บัตร", en: "Card", lo: "ບັດ" }
  };
  const mode = String(template.mode_label ?? "");
  const displayMode = mode === "หน้าขาย" || mode === ""
    ? language === "lo" ? "ໜ້າຂາຍ" : language === "en" ? "Sales" : "หน้าขาย"
    : mode === "ใบเสร็จย้อนหลัง"
      ? L.copy
      : mode;
  const storeName = String(store.business_name || store.store_name || store.company_name || store.display_name || "CpIPOS");
  const divider = "-".repeat(paper === 58 ? 32 : 42);
  const lines = [
    storeName,
    divider,
    label(L.branch, template.branch_name),
    label(L.bill, template.order_no),
    label(L.date, when),
    label(L.seller, String(template.cashier_name ?? "-")),
    label(L.mode, displayMode),
    divider,
    L.items
  ];
  for (const item of template.items) {
    lines.push(String(item.name));
    lines.push(String(item.qty) + " x " + fmt(item.unit_price) + " = " + fmt(item.line_total));
  }
  lines.push(divider);
  lines.push(label(L.subtotal, fmt(template.subtotal)));
  lines.push(label(L.discount, fmt(template.discount_amount)));
  if (Number(template.tax_amount ?? 0)) lines.push(label(L.tax, fmt(template.tax_amount)));
  lines.push(label(L.total, fmt(template.total_amount)));
  lines.push(label(L.payment, method[String(template.payment_method)]?.[language] ?? String(template.payment_method)));
  if (template.payment_method === "cash") {
    lines.push(label(L.cash, fmt(template.cash_received ?? template.total_amount)));
    lines.push(label(L.change, fmt(template.change_amount ?? 0)));
  }
  if (template.note) lines.push(String(template.note));
  lines.push(divider, L.thanks, "");
  return lines.join("\n");
}
