"use client";

import { useEffect, useState } from "react";
import {PosOpticalDepositDialog, type OpticalBankVerification} from "@/components/pos/pos-optical-deposit-dialog";
import type {OpticalDepositMethod} from "@/lib/optical-deposit-amount";

type PaymentText = {
  subtotal: string;
  total: string;
  checkout: string;
  retry: string;
  managerOverride: string;
  cancelBill: string;
  holdBill: string;
  member?: string;
  promotion: string;
  billNo: string;
  status: string;
  statusValue: string;
  mode?: string;
  tax?: string;
  paymentMethod?: string;
};

type Props = {
  subtotal: number;
  total: number;
  taxAmount?: number;
  taxLines?: Array<{ id: string; label: string; amount: number }>;
  onCheckout: () => void;
  onRetry?: () => void;
  onManagerOverride?: () => void;
  onCancelBill?: () => void;
  onHoldBill?: () => void;
  onOpenHeldBills?: () => void;
  opticalRetail?: boolean;
  opticalCurrencyCode?: "THB" | "LAK" | "USD";
  opticalLanguage?: "th" | "en" | "lo";
  onOpticalCustomer?: () => void;
  /** Only supplied when the authenticated Optical ledger transaction is live. */
  onOpticalDeposit?: (amount: number, method: OpticalDepositMethod, customerId: string, evidence?: OpticalBankVerification) => Promise<void> | void;
  onOpticalDepositReceipt?:(paperWidthMm:58|80)=>void;
  onMember?: () => void;
  onTableQrOrder?: () => void;
  onPromotion?: () => void;
  onOpenCashDrawer?: () => void;
  showHoldBill?: boolean;
  showTableQrOrder?: boolean;
  tableQrOrderLabel?: string;
  checkoutLabel?: string;
  checkoutDisabled?: boolean;
  retryDisabled?: boolean;
  retryLabel?: string;
  submitting?: boolean;
  submittingLabel?: string;
  pendingLabel?: string;
  message?: string | null;
  pending?: boolean;
  billNo?: string;
  showBillNo?: boolean;
  showPaymentMethod?: boolean;
  showModeStatus?: boolean;
  showStatus?: boolean;
  showDiscount?: boolean;
  showTax?: boolean;
  actionsDisabled?: boolean;
  cancelBillDisabled?: boolean;
  cancelLabel?: string;
  transferVerificationLabel?: string;
  openCashDrawerLabel?: string;
  openingCashDrawerLabel?: string;
  openCashDrawerDisabled?: boolean;
  openingCashDrawer?: boolean;
  transferVerificationBadge?: {
    label: string;
    tone: "pass" | "fail" | "warn";
  } | null;
  paymentMethodValue?: string;
  modeStatusValue?: string;
  memberSummary?: {
    name: string;
    code?: string | null;
    phone?: string | null;
    points?: number | null;
    stamps?: number | null;
  } | null;
  text: PaymentText;
};

type SecondaryAction = {
  key: string;
  className: string;
  onClick?: () => void;
  disabled: boolean;
  label: string;
};

type LocalBridgeRuntimePayload = {
  bridge_health_url?: string;
  bridge_print_url?: string;
  bridge_token?: string;
  bridge_token_header?: string;
  windows_printer?: string;
};

type LocalBridgeHealthBody = {
  ok?: boolean;
  data?: {
    resolved_printer?: string | null;
    system_default_printer?: string | null;
  } | null;
};

type LocalBridgeCommandBody = {
  ok?: boolean;
  error?: unknown;
};

const ACTIVE_SALES_MODE_LABEL_KEY = "cpipos_active_sales_mode_label";

function formatMoney(value: number, currencyCode: "THB" | "LAK" | "USD" = "THB"): string {
  const symbol = currencyCode === "LAK" ? "₭" : currencyCode === "USD" ? "$" : "฿";
  const fractionDigits = currencyCode === "LAK" ? 0 : 2;
  return symbol + new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits
  }).format(Number.isFinite(value) ? value : 0);
}

function readWindowsRuntimePayload(): LocalBridgeRuntimePayload | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { CpIPOSWindowsRuntime?: LocalBridgeRuntimePayload }).CpIPOSWindowsRuntime ?? null;
}

function readActiveSalesModeLabel(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(ACTIVE_SALES_MODE_LABEL_KEY);
}

function isDineInModeLabel(value: string | null | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "นั่งโต๊ะ" || normalized === "dine in" || normalized === "dine-in" || normalized === "dine_in";
}

function resolveDisplayModeStatusValue(args: {
  modeStatusValue?: string;
  fallbackStatusValue: string;
  activeSalesModeLabel: string | null;
  modeLabel?: string;
}): string {
  const currentValue = args.modeStatusValue ?? args.fallbackStatusValue;
  if (args.activeSalesModeLabel === "buffet_table" && isDineInModeLabel(currentValue)) {
    return args.modeLabel === "โหมด" ? "โต๊ะบุฟเฟ่" : "Buffet table";
  }
  return currentValue;
}

function buildCashDrawerBridgeUrl(printUrl: string): string {
  try {
    const url = new URL(printUrl);
    if (url.pathname.endsWith("/print/test")) {
      url.pathname = url.pathname.replace(/\/print\/test$/u, "/cash-drawer/open");
      return url.toString();
    }
    if (url.pathname.endsWith("/print")) {
      url.pathname = url.pathname.replace(/\/print$/u, "/cash-drawer/open");
      return url.toString();
    }
    url.pathname = "/cash-drawer/open";
    return url.toString();
  } catch {
    return printUrl.replace(/\/print(?:\/test)?\/?$/u, "/cash-drawer/open");
  }
}

async function resolveLocalBridgePrinterName(args: {
  healthUrl: string;
  runtimePrinter?: string | null;
}): Promise<string | undefined> {
  const runtimePrinter = String(args.runtimePrinter ?? "").trim();
  if (runtimePrinter) return runtimePrinter;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(args.healthUrl, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return undefined;
    const body = (await response.json().catch(() => null)) as LocalBridgeHealthBody | null;
    const resolvedPrinter = String(body?.data?.resolved_printer ?? "").trim();
    if (resolvedPrinter) return resolvedPrinter;
    const systemDefaultPrinter = String(body?.data?.system_default_printer ?? "").trim();
    return systemDefaultPrinter || undefined;
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function tryOpenLocalBridgeCashDrawer(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const runtime = readWindowsRuntimePayload();
  const token = String(
    window.sessionStorage.getItem("cpi_local_bridge_token_v1") ?? runtime?.bridge_token ?? ""
  ).trim();
  const tokenHeader = String(
    window.sessionStorage.getItem("cpi_local_bridge_token_header_v1") ?? runtime?.bridge_token_header ?? "X-CpIPOS-Bridge-Token"
  ).trim();
  const printUrl = String(
    window.localStorage.getItem("cpi_local_bridge_print_url_v1") ?? runtime?.bridge_print_url ?? ""
  ).trim();
  const healthUrl = String(
    window.localStorage.getItem("cpi_local_bridge_health_url_v1") ?? runtime?.bridge_health_url ?? ""
  ).trim();

  if (!token || !tokenHeader || !printUrl || !healthUrl) return false;

  const printerName = await resolveLocalBridgePrinterName({
    healthUrl,
    runtimePrinter: runtime?.windows_printer
  });
  const body: Record<string, unknown> = {
    drawer_connection_mode: "printer-kick",
    drawer_kick_pin: 0,
    drawer_pulse_on_ms: 80,
    drawer_pulse_off_ms: 250,
    metadata: {
      source: "pos_payment_panel",
      trigger: "manual_cash_drawer_button",
      drawer_connection_mode: "printer-kick",
      drawer_kick_pin: 0,
      drawer_pulse_on_ms: 80,
      drawer_pulse_off_ms: 250
    }
  };
  if (printerName) {
    body.printer_name = printerName;
  }

  try {
    const response = await fetch(buildCashDrawerBridgeUrl(printUrl), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        [tokenHeader]: token
      },
      body: JSON.stringify(body)
    });
    const result = (await response.json().catch(() => null)) as LocalBridgeCommandBody | null;
    return response.ok && result?.ok !== false && !result?.error;
  } catch {
    return false;
  }
}

export function PosPaymentPanel({
  subtotal,
  total,
  taxAmount,
  taxLines = [],
  onCheckout,
  onRetry,
  onManagerOverride,
  onCancelBill,
  onHoldBill,
  onOpenHeldBills,
  opticalRetail = false,
  opticalCurrencyCode = "THB",
  opticalLanguage = "th",
  onOpticalCustomer,
  onOpticalDeposit,
  onOpticalDepositReceipt,
  onMember,
  onTableQrOrder,
  onPromotion,
  onOpenCashDrawer,
  showHoldBill = true,
  showTableQrOrder = false,
  tableQrOrderLabel = "QR สั่งอาหาร",
  checkoutLabel,
  checkoutDisabled,
  retryDisabled,
  retryLabel,
  submitting,
  submittingLabel = "Submitting...",
  billNo = "BILL-2026-0001",
  showBillNo = true,
  showPaymentMethod = true,
  showModeStatus = false,
  showStatus = true,
  showDiscount = true,
  showTax = true,
  actionsDisabled = false,
  cancelBillDisabled = false,
  cancelLabel,
  transferVerificationLabel,
  openCashDrawerLabel = "เปิดลิ้นชักเก็บเงิน",
  openingCashDrawerLabel = "กำลังส่งคำสั่ง...",
  openCashDrawerDisabled = false,
  openingCashDrawer = false,
  transferVerificationBadge,
  paymentMethodValue,
  modeStatusValue,
  memberSummary,
  text
}: Props) {
  const [localCashDrawerOpening, setLocalCashDrawerOpening] = useState(false);
  const [opticalDepositOpen, setOpticalDepositOpen] = useState(false);
  useEffect(() => { if (!opticalRetail) setOpticalDepositOpen(false); }, [opticalRetail]);
  const [activeSalesModeLabel, setActiveSalesModeLabel] = useState<string | null>(() => readActiveSalesModeLabel());
  const cashDrawerBusy = openingCashDrawer || localCashDrawerOpening;
  const displayModeStatusValue = resolveDisplayModeStatusValue({
    modeStatusValue,
    fallbackStatusValue: text.statusValue,
    activeSalesModeLabel,
    modeLabel: text.mode
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncActiveSalesModeLabel = () => setActiveSalesModeLabel(readActiveSalesModeLabel());
    window.addEventListener("cpipos:sales-mode-label-change", syncActiveSalesModeLabel);
    window.addEventListener("storage", syncActiveSalesModeLabel);
    syncActiveSalesModeLabel();
    return () => {
      window.removeEventListener("cpipos:sales-mode-label-change", syncActiveSalesModeLabel);
      window.removeEventListener("storage", syncActiveSalesModeLabel);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeSalesModeLabel && modeStatusValue && !isDineInModeLabel(modeStatusValue)) {
      window.sessionStorage.removeItem(ACTIVE_SALES_MODE_LABEL_KEY);
      setActiveSalesModeLabel(null);
    }
  }, [activeSalesModeLabel, modeStatusValue]);

  async function handleOpenCashDrawerClick() {
    if (!onOpenCashDrawer || openCashDrawerDisabled || cashDrawerBusy || submitting) return;
    setLocalCashDrawerOpening(true);
    try {
      const openedViaLocalBridge = await tryOpenLocalBridgeCashDrawer();
      if (openedViaLocalBridge) return;
      onOpenCashDrawer();
    } finally {
      setLocalCashDrawerOpening(false);
    }
  }

  if (opticalRetail) {
    const localized = (thai: string, english: string) => opticalLanguage === "lo" ? ({
      "แผงชำระเงินร้านแว่นตา": "ໜ້າຊຳລະເງິນຮ້ານແວ່ນຕາ",
      "ยอดสินค้า": "ຍອດສິນຄ້າ",
      "ยอดชำระ": "ຍອດຕ້ອງຊຳລະ",
      "สกุลเงินหน้าขาย": "ສະກຸນເງິນໜ້າຂາຍ",
      "พักบิล": "ພັກບິນ",
      "บิลพัก": "ບິນທີ່ພັກ",
      "สมาชิก": "ສະມາຊິກ",
      "ส่วนลด": "ສ່ວນຫຼຸດ",
      "เปิดลิ้นชัก": "ເປີດລິ້ນຊັກ",
      "รอระบบบัญชีมัดจำและสต๊อก": "ລໍຖ້າລະບົບເງິນມັດຈຳ ແລະສະຕັອກ",
      "ชำระเงินมัดจำ": "ຊຳລະເງິນມັດຈຳ",
      "ยังไม่เปิดใช้งาน": "ຍັງບໍ່ເປີດໃຊ້ງານ",
      "เพิ่มประวัติลูกค้า": "ເພີ່ມປະຫວັດລູກຄ້າ",
      "บันทึกค่าสายตา": "ບັນທຶກຄ່າສາຍຕາ",
      "ชำระเงิน": "ຊຳລະເງິນ",
      "ยกเลิกบิล": "ຍົກເລີກບິນ",
    } as Record<string,string>)[thai] ?? thai : opticalLanguage === "th" ? thai : english;
    const buttonClass = "flex min-h-[56px] w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-center text-[clamp(11px,1vw,13px)] font-bold leading-tight text-slate-700 shadow-sm transition-colors enabled:hover:border-emerald-400 enabled:hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60";
    return (
      <section
        className="posui-payment-panel"
        data-testid="pos-optical-payment-panel"
        aria-label={localized("แผงชำระเงินร้านแว่นตา", "Optical checkout controls")}
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", rowGap: 8, padding: 8, maxHeight: "100%", overflowY: "auto", overscrollBehavior: "contain" }}
      >
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <p className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
            <span>{localized("ยอดสินค้า", "Items total")}</span>
            <strong className="text-lg font-extrabold tabular-nums text-slate-800">{formatMoney(Math.max(0, subtotal), opticalCurrencyCode)}</strong>
          </p>
          <p className="flex items-center justify-between px-3 py-2 text-xs font-bold text-slate-700">
            <span>{localized("ยอดชำระ", "Amount due")}</span>
            <strong className="text-xl font-black tabular-nums text-orange-600">{formatMoney(total, opticalCurrencyCode)}</strong>
          </p>
        </div>
        <p data-testid="pos-optical-sales-currency" className="text-center text-xs font-bold text-slate-500">
          {localized("สกุลเงินหน้าขาย", "Sales currency")}: {opticalCurrencyCode}
        </p>
        <div className="grid grid-cols-2 gap-2" data-testid="pos-optical-bill-actions">
          <button type="button" className={buttonClass} onClick={onHoldBill} disabled={!onHoldBill || !showHoldBill || actionsDisabled}>
            <span aria-hidden="true" className="text-lg">▣</span>{localized("พักบิล", "Hold bill")}
          </button>
          <button type="button" className={buttonClass} onClick={onOpenHeldBills} disabled={!onOpenHeldBills || actionsDisabled}>
            <span aria-hidden="true" className="text-lg">☷</span>{localized("บิลพัก", "Held bills")}
          </button>
          <button type="button" className={buttonClass} onClick={onMember} disabled={!onMember || actionsDisabled}>
            <span aria-hidden="true" className="text-lg">♙</span>{localized("สมาชิก", "Member")}
          </button>
          <button type="button" className={buttonClass} onClick={onPromotion} disabled={!onPromotion || actionsDisabled}>
            <span aria-hidden="true" className="text-lg">%</span>{localized("ส่วนลด", "Discount")}
          </button>
          <button
            type="button"
            className={`${buttonClass} col-span-2`}
            onClick={() => void handleOpenCashDrawerClick()}
            disabled={!onOpenCashDrawer || openCashDrawerDisabled || cashDrawerBusy || submitting}
          >
            <span aria-hidden="true" className="text-lg">▤</span>
            {cashDrawerBusy ? openingCashDrawerLabel : localized("เปิดลิ้นชัก", "Open drawer")}
          </button>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2" data-testid="pos-optical-pending-actions">
          <button
            type="button"
            onClick={()=>setOpticalDepositOpen(true)}
            disabled={total<=0 || actionsDisabled || submitting}
            title={localized("ชำระเงินมัดจำ", "Enter deposit amount")}
            className={`${buttonClass} border-emerald-200 bg-emerald-50 text-emerald-900`}
          >
            <span aria-hidden="true" className="text-lg leading-none">▣</span>
            <span className="break-words leading-tight">{localized("ชำระเงินมัดจำ", "Deposit")}</span>

          </button>
          <button
            type="button"
            onClick={onOpticalCustomer}
            disabled={!onOpticalCustomer || actionsDisabled}
            className={`${buttonClass} border-emerald-300 bg-emerald-100 text-emerald-900 enabled:hover:bg-emerald-200`}
          >
            <span aria-hidden="true" className="text-lg leading-none">♙</span>
            <span className="break-words leading-tight">{localized("เพิ่มประวัติลูกค้า", "Customer history")}</span>
            <span className="text-[11px] font-semibold">{localized("บันทึกค่าสายตา", "Examination records")}</span>
          </button>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 pt-0.5" data-testid="pos-optical-primary-actions">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-orange-500 px-3 py-2 text-center text-base font-black text-white transition-colors enabled:hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-45"
            onClick={onCheckout}
            disabled={checkoutDisabled || submitting}
            data-testid="pos-optical-checkout"
          >
            {submitting ? submittingLabel : localized("ชำระเงิน", "Checkout")}
          </button>
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-base font-bold text-rose-700 enabled:hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45"
            onClick={onCancelBill}
            disabled={!onCancelBill || actionsDisabled || cancelBillDisabled}
          >
            {localized("ยกเลิกบิล", "Cancel bill")}
          </button>
        </div>
        {onOpticalDepositReceipt?<div className="grid grid-cols-2 gap-2" aria-label={opticalLanguage==="th"?"เลือกขนาดใบเสร็จมัดจำ":opticalLanguage==="lo"?"ເລືອກຂະໜາດໃບມັດຈຳ":"Deposit receipt paper size"}>
          {([58,80] as const).map(paper=><button key={paper} type="button"
            className="min-h-10 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900"
            onClick={()=>onOpticalDepositReceipt(paper)} data-testid={`optical-last-deposit-receipt-${paper}`}>
            {opticalLanguage==="lo"?`ໃບມັດຈຳ ${paper}mm`:opticalLanguage==="en"?`Deposit receipt ${paper}mm`:`ใบเสร็จมัดจำ ${paper} มม.`}
          </button>)}
        </div>:null}
        {onRetry ? <button type="button" className="posui-btn posui-btn--retry-emergency" onClick={onRetry} disabled={retryDisabled || submitting}>{retryLabel ?? text.retry}</button> : null}
        {opticalDepositOpen ? <PosOpticalDepositDialog total={total} currency={opticalCurrencyCode} language={opticalLanguage}
          onClose={()=>setOpticalDepositOpen(false)} onSubmit={onOpticalDeposit}/> : null}
      </section>
    );
  }

  const secondaryActions = ([
    showHoldBill
      ? {
          key: "hold",
          className: "posui-btn",
          onClick: onHoldBill,
          disabled: actionsDisabled,
          label: text.holdBill
        }
      : null,
    showTableQrOrder
      ? {
          key: "table-qr",
          className: "posui-btn posui-btn--table-qr",
          onClick: onTableQrOrder,
          disabled: actionsDisabled,
          label: tableQrOrderLabel
        }
      : null,
    onMember
      ? {
          key: "member",
          className: "posui-btn posui-btn--member",
          onClick: onMember,
          disabled: actionsDisabled,
          label: text.member ?? "Member"
        }
      : null,
    {
      key: "promotion",
      className: "posui-btn posui-btn--promo",
      onClick: onPromotion,
      disabled: actionsDisabled,
      label: text.promotion
    },
    onCancelBill
      ? {
          key: "cancel",
          className: "posui-btn posui-btn--cancel-near-checkout",
          onClick: onCancelBill,
          disabled: actionsDisabled || cancelBillDisabled,
          label: cancelLabel ?? text.cancelBill
        }
      : null
  ] as Array<SecondaryAction | null>).filter((action): action is SecondaryAction => Boolean(action));

  return (
    <section className="posui-payment-panel">
      <div className="posui-bill-summary-card">
        {showBillNo ? (
          <p>
            <span>{text.billNo}</span>
            <strong>{billNo}</strong>
          </p>
        ) : null}
        {showPaymentMethod && text.paymentMethod ? (
          <p>
            <span>{text.paymentMethod}</span>
            <strong>{paymentMethodValue ?? "-"}</strong>
          </p>
        ) : null}
        {showModeStatus && text.mode ? (
          <p>
            <span>{text.mode}</span>
            <strong>{displayModeStatusValue}</strong>
          </p>
        ) : null}
        {showStatus ? (
          <p>
            <span>{text.status}</span>
            <strong>{text.statusValue}</strong>
          </p>
        ) : null}
        {memberSummary ? (
          <div className="posui-bill-member-card">
            <span>{text.member ?? "Member"}</span>
            <strong>{memberSummary.name}</strong>
            <small>
              {[memberSummary.code ? `#${memberSummary.code}` : "", memberSummary.phone].filter(Boolean).join(" / ")}
            </small>
            <em>
              {Number(memberSummary.points ?? 0)} คะแนน / {Number(memberSummary.stamps ?? 0)} แต้ม
            </em>
          </div>
        ) : null}
        {transferVerificationBadge && transferVerificationLabel ? (
          <p>
            <span>{transferVerificationLabel}</span>
            <strong className={`posui-transfer-badge is-${transferVerificationBadge.tone}`}>{transferVerificationBadge.label}</strong>
          </p>
        ) : null}
        {showDiscount ? (
          <p>
            <span>{text.subtotal}</span>
            <strong>{formatMoney(Math.max(0, subtotal), opticalCurrencyCode)}</strong>
          </p>
        ) : null}
        {showTax && taxLines.length > 0 ? taxLines.map((line) => (
          <p key={line.id}>
            <span>{line.label}</span>
            <strong>{line.amount < 0 ? "-" : "+"}{formatMoney(Math.abs(line.amount), opticalCurrencyCode)}</strong>
          </p>
        )) : showTax && text.tax ? (
          <p>
            <span>{text.tax}</span>
            <strong>{formatMoney(Math.max(0, taxAmount ?? 0), opticalCurrencyCode)}</strong>
          </p>
        ) : null}
        <p className="is-total">
          <span>{text.total}</span>
          <strong>{formatMoney(total, opticalCurrencyCode)}</strong>
        </p>
      </div>

      <div
        className={`posui-bill-actions posui-bill-actions--${secondaryActions.length}`}
        style={{ display: "grid", gridTemplateColumns: `repeat(${secondaryActions.length}, minmax(0, 1fr))`, gap: 8 }}
      >
        {secondaryActions.map((action) => (
          <button key={action.key} type="button" className={action.className} onClick={action.onClick} disabled={action.disabled}>
            {action.label}
          </button>
        ))}
      </div>

      <div className="posui-payment-actions posui-payment-actions--single" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        {onOpenCashDrawer ? (
          <button
            type="button"
            onClick={handleOpenCashDrawerClick}
            disabled={openCashDrawerDisabled || cashDrawerBusy || submitting}
            className="posui-btn posui-btn--cash-drawer"
          >
            {cashDrawerBusy ? openingCashDrawerLabel : openCashDrawerLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCheckout}
          disabled={checkoutDisabled || submitting}
          className="posui-btn posui-btn--primary posui-btn--checkout"
        >
          {submitting ? submittingLabel : checkoutLabel ?? text.checkout}
        </button>
        {onRetry ? (
          <button type="button" onClick={onRetry} disabled={retryDisabled || submitting} className="posui-btn posui-btn--retry-emergency">
            {retryLabel ?? text.retry}
          </button>
        ) : null}
        {onManagerOverride ? (
          <button type="button" onClick={onManagerOverride} className="posui-btn">
            {text.managerOverride}
          </button>
        ) : null}
      </div>
    </section>
  );
}
