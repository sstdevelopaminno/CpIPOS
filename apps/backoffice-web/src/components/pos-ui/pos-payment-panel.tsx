"use client";

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

function formatMoney(value: number): string {
  return `฿${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
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
            <strong>{modeStatusValue ?? text.statusValue}</strong>
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
            <strong>{formatMoney(Math.max(0, subtotal))}</strong>
          </p>
        ) : null}
        {showTax && taxLines.length > 0 ? taxLines.map((line) => (
          <p key={line.id}>
            <span>{line.label}</span>
            <strong>{line.amount < 0 ? "-" : "+"}{formatMoney(Math.abs(line.amount))}</strong>
          </p>
        )) : showTax && text.tax ? (
          <p>
            <span>{text.tax}</span>
            <strong>{formatMoney(Math.max(0, taxAmount ?? 0))}</strong>
          </p>
        ) : null}
        <p className="is-total">
          <span>{text.total}</span>
          <strong>{formatMoney(total)}</strong>
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
            onClick={onOpenCashDrawer}
            disabled={openCashDrawerDisabled || openingCashDrawer || submitting}
            className="posui-btn posui-btn--cash-drawer"
          >
            {openingCashDrawer ? openingCashDrawerLabel : openCashDrawerLabel}
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
