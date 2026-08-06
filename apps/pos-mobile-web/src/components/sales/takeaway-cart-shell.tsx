"use client";

import { Banknote, CheckCircle2, ChevronLeft, ChevronRight, Landmark, Minus, Percent, Plus, Trash2, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MemberLauncher, type SalesMember } from "@/components/sales/member-launcher";

export type TakeawayCategory = {
  id: string;
  name: string;
};

export type TakeawayProduct = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  price: number;
  sellUnit: string | null;
  ingredients?: ProductIngredientOption[];
};

type CartLine = TakeawayProduct & {
  quantity: number;
  selectedIngredients?: ProductIngredientOption[];
};

type ProductIngredientOption = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  selected: boolean;
};

type HeldOrder = {
  id: string;
  orderNo: string;
  total: number;
  discount: number;
  itemCount: number;
  updatedAt: string | null;
  items: Array<{
    productId: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
};

type ReceiptLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

type ReceiptSnapshot = {
  orderNo: string;
  paymentMethod: "cash" | "transfer";
  total: number;
  subtotal: number;
  discount: number;
  cashReceived: number | null;
  change: number;
  paidAt: string;
  lines: ReceiptLine[];
};

export type ReceiptStoreProfile = {
  displayName: string;
  logoUrl: string;
  companyAddress: string;
  contactPhone: string;
  branchName: string;
};

export type TakeawayCartShellMode = {
  saleLabel?: string;
  backHref?: string;
  returnHref?: string;
  checkoutEndpoint?: string;
  holdEndpoint?: string;
  cancelEndpoint?: string;
  restoreEndpoint?: string;
  restoreHref?: string;
  cancelSuccessMessage?: string;
};

type TransferQrPayload = {
  manual: {
    accountId: string;
    bankName: string;
    accountName: string;
    accountNumber: string;
    promptPayPhone: string;
    qrMode: "promptpay_link" | "qr_image";
    qrUrl: string | null;
  } | null;
  inet: {
    enabled: boolean;
    environment: "production" | "uat" | null;
  };
};

const PAGE_SIZE = 5;
const BAHT = "\u0e3f";
const SYSTEM_RECEIPT_LOGO_PATH = "/brand/cpipos-logo.png";
const LABELS = {
  all: "\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14",
  takeaway: "\u0e01\u0e25\u0e31\u0e1a\u0e1a\u0e49\u0e32\u0e19",
  itemCount: "\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23",
  amount: "\u0e08\u0e33\u0e19\u0e27\u0e19\u0e40\u0e07\u0e34\u0e19",
  billNo: "\u0e40\u0e25\u0e02\u0e17\u0e35\u0e48\u0e1a\u0e34\u0e25",
  back: "\u0e01\u0e25\u0e31\u0e1a",
  member: "\u0e2a\u0e21\u0e32\u0e0a\u0e34\u0e01",
  addProduct: "\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32",
  added: "\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e41\u0e25\u0e49\u0e27",
  discount: "\u0e2a\u0e48\u0e27\u0e19\u0e25\u0e14",
  cancelBill: "\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01\u0e1a\u0e34\u0e25",
  holdBill: "\u0e1e\u0e31\u0e01\u0e1a\u0e34\u0e25",
  heldOrders: "\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e1e\u0e31\u0e01",
  noHeldOrders: "\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e1a\u0e34\u0e25\u0e17\u0e35\u0e48\u0e1e\u0e31\u0e01",
  restoreHeld: "\u0e40\u0e23\u0e35\u0e22\u0e01\u0e01\u0e25\u0e31\u0e1a",
  restoreHeldFailed: "\u0e40\u0e23\u0e35\u0e22\u0e01\u0e1a\u0e34\u0e25\u0e1e\u0e31\u0e01\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08",
  pay: "\u0e0a\u0e33\u0e23\u0e30\u0e40\u0e07\u0e34\u0e19",
  cash: "\u0e40\u0e07\u0e34\u0e19\u0e2a\u0e14",
  transfer: "\u0e40\u0e07\u0e34\u0e19\u0e42\u0e2d\u0e19",
  payCash: "\u0e0a\u0e33\u0e23\u0e30\u0e40\u0e07\u0e34\u0e19\u0e2a\u0e14",
  payTransfer: "\u0e0a\u0e33\u0e23\u0e30\u0e40\u0e07\u0e34\u0e19\u0e42\u0e2d\u0e19",
  cashPaymentTitle: "\u0e23\u0e31\u0e1a\u0e0a\u0e33\u0e23\u0e30\u0e40\u0e07\u0e34\u0e19\u0e2a\u0e14",
  transferPaymentTitle: "\u0e23\u0e31\u0e1a\u0e0a\u0e33\u0e23\u0e30\u0e40\u0e07\u0e34\u0e19\u0e42\u0e2d\u0e19",
  receiptTitle: "\u0e43\u0e1a\u0e40\u0e2a\u0e23\u0e47\u0e08 58 mm",
  amountDue: "\u0e22\u0e2d\u0e14\u0e17\u0e35\u0e48\u0e15\u0e49\u0e2d\u0e07\u0e0a\u0e33\u0e23\u0e30",
  scanQrToPay: "\u0e2a\u0e41\u0e01\u0e19 QR \u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e0a\u0e33\u0e23\u0e30\u0e40\u0e07\u0e34\u0e19",
  manualTransfer: "\u0e42\u0e2d\u0e19\u0e41\u0e1a\u0e1a\u0e40\u0e14\u0e34\u0e21",
  inetQr: "INET QR",
  scanWithBankApp: "\u0e2a\u0e41\u0e01\u0e19 QR \u0e14\u0e49\u0e27\u0e22\u0e41\u0e2d\u0e1b\u0e18\u0e19\u0e32\u0e04\u0e32\u0e23\u0e02\u0e2d\u0e07\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32",
  loadingQr: "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e42\u0e2b\u0e25\u0e14 QR...",
  qrNotConfigured: "\u0e01\u0e23\u0e38\u0e13\u0e32\u0e15\u0e31\u0e49\u0e07\u0e04\u0e48\u0e32\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e40\u0e1e\u0e22\u0e4c\u0e2b\u0e23\u0e37\u0e2d\u0e20\u0e32\u0e1e QR \u0e01\u0e48\u0e2d\u0e19",
  inetQrNotReady: "INET QR \u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e40\u0e1b\u0e34\u0e14\u0e43\u0e0a\u0e49\u0e43\u0e19 Mobile",
  savingTransfer: "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e01\u0e32\u0e23\u0e0a\u0e33\u0e23\u0e30\u0e40\u0e07\u0e34\u0e19...",
  paidFromCustomer: "\u0e23\u0e31\u0e1a\u0e40\u0e07\u0e34\u0e19\u0e21\u0e32\u0e08\u0e32\u0e01\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32",
  quickCash: "\u0e1a\u0e25\u0e47\u0e2d\u0e01\u0e40\u0e07\u0e34\u0e19\u0e14\u0e48\u0e27\u0e19",
  keypad: "\u0e41\u0e1b\u0e49\u0e19\u0e15\u0e31\u0e27\u0e40\u0e25\u0e02",
  confirmPayment: "\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19\u0e0a\u0e33\u0e23\u0e30",
  printReceipt: "\u0e1e\u0e34\u0e21\u0e1e\u0e4c\u0e43\u0e1a\u0e40\u0e2a\u0e23\u0e47\u0e08",
  closeWindow: "\u0e1b\u0e34\u0e14\u0e2b\u0e19\u0e49\u0e32\u0e15\u0e48\u0e32\u0e07",
  storeName: "\u0e23\u0e49\u0e32\u0e19\u0e01\u0e4b\u0e27\u0e22\u0e40\u0e15\u0e35\u0e4b\u0e22\u0e27 NDI",
  branchName: "\u0e2d\u0e48\u0e2d\u0e19\u0e19\u0e38\u0e0a",
  seller: "\u0e0a\u0e37\u0e48\u0e2d\u0e1c\u0e39\u0e49\u0e02\u0e32\u0e22",
  mode: "\u0e42\u0e2b\u0e21\u0e14",
  date: "\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48",
  productList: "\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32",
  quantity: "\u0e08\u0e33\u0e19\u0e27\u0e19",
  lineTotal: "\u0e23\u0e32\u0e04\u0e32\u0e23\u0e27\u0e21",
  clear: "\u0e25\u0e49\u0e32\u0e07",
  delete: "\u0e25\u0e1a",
  cashReceived: "\u0e23\u0e31\u0e1a\u0e40\u0e07\u0e34\u0e19\u0e2a\u0e14",
  change: "\u0e40\u0e07\u0e34\u0e19\u0e17\u0e2d\u0e19",
  referenceNo: "\u0e40\u0e25\u0e02\u0e2d\u0e49\u0e32\u0e07\u0e2d\u0e34\u0e07",
  confirmCash: "\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19\u0e40\u0e07\u0e34\u0e19\u0e2a\u0e14",
  confirmTransfer: "\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19\u0e40\u0e07\u0e34\u0e19\u0e42\u0e2d\u0e19",
  paymentFailed: "\u0e0a\u0e33\u0e23\u0e30\u0e40\u0e07\u0e34\u0e19\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08",
  choosePayment: "\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e27\u0e34\u0e18\u0e35\u0e0a\u0e33\u0e23\u0e30",
  discountType: "\u0e23\u0e39\u0e1b\u0e41\u0e1a\u0e1a\u0e2a\u0e48\u0e27\u0e19\u0e25\u0e14",
  percent: "\u0e40\u0e1b\u0e2d\u0e23\u0e4c\u0e40\u0e0b\u0e47\u0e19\u0e15\u0e4c",
  amountValue: "\u0e08\u0e33\u0e19\u0e27\u0e19\u0e40\u0e07\u0e34\u0e19",
  apply: "\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19",
  subtotal: "\u0e22\u0e2d\u0e14\u0e01\u0e48\u0e2d\u0e19\u0e25\u0e14",
  totalAfterDiscount: "\u0e2b\u0e25\u0e31\u0e07\u0e2b\u0e31\u0e01\u0e2a\u0e48\u0e27\u0e19\u0e25\u0e14",
  enterPin: "\u0e43\u0e2a\u0e48 PIN",
  cart: "\u0e15\u0e30\u0e01\u0e23\u0e49\u0e32\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32",
  clearAll: "\u0e25\u0e49\u0e32\u0e07\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14",
  emptyCart: "\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e43\u0e19\u0e15\u0e30\u0e01\u0e23\u0e49\u0e32",
  previous: "\u0e01\u0e48\u0e2d\u0e19\u0e2b\u0e19\u0e49\u0e32",
  next: "\u0e16\u0e31\u0e14\u0e44\u0e1b",
  chooseProduct: "\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32",
  close: "\u0e1b\u0e34\u0e14",
  deleteItem: "\u0e25\u0e1a\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23",
  noProducts: "\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e43\u0e19\u0e2b\u0e21\u0e27\u0e14\u0e19\u0e35\u0e49",
};

function money(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ReceiptLogoImage({ src, alt }: { src: string; alt: string }) {
  const [currentSrc, setCurrentSrc] = useState(src || SYSTEM_RECEIPT_LOGO_PATH);

  useEffect(() => {
    setCurrentSrc(src || SYSTEM_RECEIPT_LOGO_PATH);
  }, [src]);

  return (
    <Image
      src={currentSrc}
      alt={alt}
      width={144}
      height={58}
      unoptimized
      onError={() => {
        if (currentSrc !== SYSTEM_RECEIPT_LOGO_PATH) setCurrentSrc(SYSTEM_RECEIPT_LOGO_PATH);
      }}
      style={{ display: "block", width: "min(132px, 54%)", height: 48, objectFit: "contain", justifySelf: "center" }}
    />
  );
}

function normalizeSixDigitPin(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

function PinDigits({ value }: { value: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
      {Array.from({ length: 6 }).map((_, index) => (
        <span key={index} style={{ display: "grid", minHeight: 44, placeItems: "center", border: "1px solid #ffd7d7", borderRadius: 10, background: "#fff", color: "#0f2745", fontSize: 18, fontWeight: 950 }}>
          {value[index] ? "*" : ""}
        </span>
      ))}
    </div>
  );
}

export function TakeawayCartShell({
  categories,
  products,
  orderId,
  orderNo,
  receiptStoreProfile,
  initialCart = [],
  mode,
}: {
  categories: TakeawayCategory[];
  products: TakeawayProduct[];
  orderId: string;
  orderNo: string;
  receiptStoreProfile: ReceiptStoreProfile;
  initialCart?: CartLine[];
  mode?: TakeawayCartShellMode;
}) {
  const router = useRouter();
  const saleLabel = mode?.saleLabel ?? LABELS.takeaway;
  const backHref = mode?.backHref ?? "/sales";
  const returnHref = mode?.returnHref ?? "/sales";
  const checkoutEndpoint = mode?.checkoutEndpoint ?? "/api/mobile/sales/takeaway/checkout";
  const holdEndpoint = mode?.holdEndpoint ?? "/api/mobile/sales/takeaway/hold";
  const cancelEndpoint = mode?.cancelEndpoint ?? "/api/mobile/sales/takeaway/cancel";
  const restoreEndpoint = mode?.restoreEndpoint ?? "/api/mobile/sales/takeaway/held/restore";
  const restoreHref = mode?.restoreHref ?? "/sales/takeaway";
  const cancelSuccessMessage = mode?.cancelSuccessMessage ?? "ยกเลิกบิลสำเร็จ กำลังกลับเมนูขาย...";
  const [activeOrderId, setActiveOrderId] = useState(orderId);
  const [activeOrderNo, setActiveOrderNo] = useState(orderNo);
  const [cart, setCart] = useState<CartLine[]>(initialCart);
  const [page, setPage] = useState(0);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [ingredientProduct, setIngredientProduct] = useState<TakeawayProduct | null>(null);
  const [ingredientSelections, setIngredientSelections] = useState<Record<string, boolean>>({});
  const [discountOpen, setDiscountOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentView, setPaymentView] = useState<"choose" | "cash" | "transfer" | "receipt">("choose");
  const [paymentSubmitting, setPaymentSubmitting] = useState<"cash" | "transfer" | null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [cashReceivedInput, setCashReceivedInput] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [transferMode, setTransferMode] = useState<"manual" | "inet_nops">("manual");
  const [transferQr, setTransferQr] = useState<TransferQrPayload | null>(null);
  const [transferQrLoading, setTransferQrLoading] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptSnapshot | null>(null);
  const [, startReceiptCloseTransition] = useTransition();
  const [holdOpen, setHoldOpen] = useState(false);
  const [heldListOpen, setHeldListOpen] = useState(false);
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
  const [heldLoading] = useState(false);
  const [restoringHeldId, setRestoringHeldId] = useState<string | null>(null);
  const [heldError, setHeldError] = useState("");
  const [holdSubmitting, setHoldSubmitting] = useState(false);
  const [holdSubmitError, setHoldSubmitError] = useState("");
  const [discountMode, setDiscountMode] = useState<"percent" | "amount">("percent");
  const [discountInput, setDiscountInput] = useState("");
  const [redeemPointsInput, setRedeemPointsInput] = useState("");
  const [redeemStampsInput, setRedeemStampsInput] = useState("");
  const [holdPin, setHoldPin] = useState("");
  const [holdError, setHoldError] = useState("");
  const [holdLoading, setHoldLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState<SalesMember | null>(null);
  const [memberEarned, setMemberEarned] = useState({ points: 0, stamps: 0 });
  const [cancelSuccess, setCancelSuccess] = useState<{ orderNo: string; message: string } | null>(null);
  const [addedNotice, setAddedNotice] = useState("");
  const [activeCategory, setActiveCategory] = useState(categories[0]?.name ?? LABELS.all);
  const categoryScrollerRef = useRef<HTMLDivElement>(null);
  const addedNoticeTimerRef = useRef<number | null>(null);
  const cashButtonTapRef = useRef(0);
  const cancelRedirectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setActiveOrderId(orderId);
    setActiveOrderNo(orderNo);
    setCart(initialCart);
    setPage(0);
  }, [initialCart, orderId, orderNo]);

  useEffect(() => {
    return () => {
      if (addedNoticeTimerRef.current) window.clearTimeout(addedNoticeTimerRef.current);
      if (cancelRedirectTimerRef.current) window.clearTimeout(cancelRedirectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!paymentOpen || (paymentView !== "transfer" && paymentView !== "cash")) return;
    const bodyOverflow = document.body.style.overflow;
    const bodyScrollbarWidth = document.body.style.scrollbarWidth;
    const htmlOverflow = document.documentElement.style.overflow;
    const htmlScrollbarWidth = document.documentElement.style.scrollbarWidth;
    document.body.style.overflow = "hidden";
    document.body.style.scrollbarWidth = "none";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.scrollbarWidth = "none";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.body.style.scrollbarWidth = bodyScrollbarWidth;
      document.documentElement.style.overflow = htmlOverflow;
      document.documentElement.style.scrollbarWidth = htmlScrollbarWidth;
    };
  }, [paymentOpen, paymentView]);

  const visibleProducts = useMemo(() => {
    return products.filter((product) => activeCategory === LABELS.all || product.category === activeCategory);
  }, [activeCategory, products]);
  const renderedProducts = useMemo(() => visibleProducts.slice(0, 40), [visibleProducts]);

  const totalQuantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const hasCartItems = cart.length > 0;
  const subtotalAmount = cart.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const rawDiscountValue = Math.max(0, Number(discountInput || 0));
  const manualDiscountAmount = discountMode === "percent" ? Math.min(subtotalAmount, subtotalAmount * Math.min(rawDiscountValue, 100) / 100) : Math.min(subtotalAmount, rawDiscountValue);
  const redeemedPoints = selectedMember ? Math.min(selectedMember.points, Math.max(0, Number(redeemPointsInput || 0))) : 0;
  const redeemedStamps = selectedMember ? Math.min(selectedMember.stamps, Math.max(0, Number(redeemStampsInput || 0))) : 0;
  const rewardDiscountAmount = Math.min(Math.max(0, subtotalAmount - manualDiscountAmount), redeemedPoints + redeemedStamps);
  const discountAmount = Math.min(subtotalAmount, manualDiscountAmount + rewardDiscountAmount);
  const totalAmount = Math.max(0, subtotalAmount - discountAmount);
  const cashReceivedAmount = Number(cashReceivedInput || 0);
  const cashChangeAmount = Math.max(0, cashReceivedAmount - totalAmount);
  const cashUnderpaid = paymentView === "cash" && cashReceivedInput.trim() !== "" && cashReceivedAmount < totalAmount;
  const pageCount = Math.max(1, Math.ceil(cart.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleCart = useMemo(() => cart.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE), [cart, currentPage]);

  useEffect(() => {
    if (hasCartItems) return;
    setDiscountInput("");
    setRedeemPointsInput("");
    setRedeemStampsInput("");
    setSelectedMember(null);
    setMemberEarned({ points: 0, stamps: 0 });
    setDiscountOpen(false);
  }, [hasCartItems]);

  function addProduct(product: TakeawayProduct, selectedIngredients?: ProductIngredientOption[]) {
    setCart((current) => {
      const selectedKey = JSON.stringify((selectedIngredients ?? []).map((item) => [item.id, item.selected]));
      const existing = current.find((item) => item.id === product.id && JSON.stringify((item.selectedIngredients ?? []).map((entry) => [entry.id, entry.selected])) === selectedKey);
      if (existing) {
        return current.map((item) => (item === existing ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...current, { ...product, selectedIngredients, quantity: 1 }];
    });
    setAddedNotice(product.name);
    if (addedNoticeTimerRef.current) window.clearTimeout(addedNoticeTimerRef.current);
    addedNoticeTimerRef.current = window.setTimeout(() => setAddedNotice(""), 1200);
  }

  function chooseProduct(product: TakeawayProduct) {
    const ingredients = product.ingredients ?? [];
    if (!ingredients.length) {
      addProduct(product);
      return;
    }
    setIngredientProduct(product);
    setIngredientSelections(Object.fromEntries(ingredients.map((item) => [item.id, item.selected])));
  }

  function confirmIngredientProduct() {
    if (!ingredientProduct) return;
    const selected = (ingredientProduct.ingredients ?? []).map((item) => ({
      ...item,
      selected: ingredientSelections[item.id] ?? item.selected,
    }));
    addProduct(ingredientProduct, selected);
    setIngredientProduct(null);
    setIngredientSelections({});
  }

  function updateQuantity(productId: string, delta: number) {
    setCart((current) => {
      const next = current
        .map((item) => (item.id === productId ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0);
      const nextPageCount = Math.max(1, Math.ceil(next.length / PAGE_SIZE));
      setPage((value) => Math.min(value, nextPageCount - 1));
      return next;
    });
  }

  function removeProduct(productId: string) {
    setCart((current) => {
      const next = current.filter((item) => item.id !== productId);
      const nextPageCount = Math.max(1, Math.ceil(next.length / PAGE_SIZE));
      setPage((value) => Math.min(value, nextPageCount - 1));
      return next;
    });
  }

  function clearCart() {
    setCart([]);
    setPage(0);
  }

  function openPaymentChooser() {
    if (!cart.length) return;
    setPaymentOpen(true);
    setPaymentView("choose");
    setPaymentError("");
    setReceipt(null);
    setCashReceivedInput("");
    setTransferReference("");
  }

  function openCashPayment() {
    setPaymentView("cash");
    setPaymentError("");
    setCashReceivedInput(totalAmount.toFixed(2));
  }

  async function openTransferPayment() {
    setPaymentView("transfer");
    setPaymentError("");
    setTransferMode("manual");
    setTransferQrLoading(true);
    setTransferQr(null);
    try {
      const response = await fetch(`/api/mobile/payments/qr?amount=${encodeURIComponent(totalAmount.toFixed(2))}`);
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.error) {
        setPaymentError(json?.error?.message ?? LABELS.qrNotConfigured);
        return;
      }
      setTransferQr(json?.data ?? null);
    } finally {
      setTransferQrLoading(false);
    }
  }

  function appendCashInput(value: string) {
    setCashReceivedInput((current) => {
      if (value === "." && current.includes(".")) return current;
      const isAutoFilledAmount = current === totalAmount.toFixed(2);
      const base = isAutoFilledAmount && value !== "." ? "" : current;
      const next = base === "0" && value !== "." ? value : `${base}${value}`;
      return next.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 12);
    });
  }

  function deleteCashInput() {
    setCashReceivedInput((current) => current.slice(0, -1));
  }

  function runCashButton(action: () => void) {
    const now = Date.now();
    if (now - cashButtonTapRef.current < 90) return;
    cashButtonTapRef.current = now;
    action();
  }

  function clearPaidBillState() {
    setCart([]);
    setDiscountInput("");
    setRedeemPointsInput("");
    setRedeemStampsInput("");
    setCashReceivedInput("");
    setTransferReference("");
    setSelectedMember(null);
    setMemberEarned({ points: 0, stamps: 0 });
    setPage(0);
    setProductPickerOpen(false);
    setDiscountOpen(false);
    setHoldOpen(false);
  }

  function closeReceiptWindow() {
    clearPaidBillState();
    setPaymentOpen(false);
    setPaymentView("choose");
    setReceipt(null);
    startReceiptCloseTransition(() => {
      router.replace(returnHref);
      router.refresh();
    });
  }

  function printReceiptAndClose() {
    window.print();
    closeReceiptWindow();
  }

  function scrollCategories(direction: "left" | "right") {
    categoryScrollerRef.current?.scrollBy({
      left: direction === "left" ? -180 : 180,
      behavior: "smooth",
    });
  }

  function openCancelBillDialog() {
    setHoldPin("");
    setHoldError("");
    setCancelSuccess(null);
    setHoldOpen(true);
    window.setTimeout(() => document.getElementById("cancel-bill-pin")?.focus(), 80);
  }

  async function cancelBill(pin = holdPin) {
    if (holdLoading || pin.length !== 6) return;
    setHoldLoading(true);
    setHoldError("");
    try {
      const response = await fetch(cancelEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: activeOrderId, pin }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.error) {
        setHoldError(json?.error?.message ?? "ยกเลิกบิลไม่สำเร็จ");
        setHoldPin("");
        return;
      }
      const redirectTo = json?.data?.redirectTo ?? returnHref;
      const cancelledOrderNo = json?.data?.orderNo ?? activeOrderNo;
      clearPaidBillState();
      setPaymentOpen(false);
      setHeldListOpen(false);
      setHoldPin("");
      setHoldError("");
      setCancelSuccess({ orderNo: cancelledOrderNo, message: cancelSuccessMessage });
      if (cancelRedirectTimerRef.current) window.clearTimeout(cancelRedirectTimerRef.current);
      cancelRedirectTimerRef.current = window.setTimeout(() => {
        router.replace(redirectTo);
        router.refresh();
      }, 900);
    } finally {
      setHoldLoading(false);
    }
  }

  function handleCancelPinChange(value: string) {
    const nextPin = normalizeSixDigitPin(value);
    setHoldPin(nextPin);
    if (nextPin.length === 6 && !holdLoading && !cancelSuccess) {
      window.setTimeout(() => void cancelBill(nextPin), 0);
    }
  }

  async function holdCurrentBill() {
    if (holdSubmitting) return;
    setHoldSubmitting(true);
    setHoldSubmitError("");
    let holdSucceeded = false;
    try {
      const response = await fetch(holdEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: activeOrderId,
          discountMode: "amount",
          discountValue: discountAmount,
          memberId: selectedMember?.id,
          memberPoints: memberEarned.points - redeemedPoints,
          memberStamps: memberEarned.stamps - redeemedStamps,
          items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.error) {
        setHoldSubmitError(json?.error?.message ?? "พักบิลไม่สำเร็จ");
        return;
      }
      holdSucceeded = true;
      clearPaidBillState();
      setPaymentOpen(false);
      setPaymentView("choose");
      setReceipt(null);
      setHoldSubmitting(false);
      router.replace(json?.data?.redirectTo ?? returnHref);
      router.refresh();
    } finally {
      if (!holdSucceeded) setHoldSubmitting(false);
    }
  }

  async function restoreHeldOrder(order: HeldOrder) {
    if (restoringHeldId) return;
    setRestoringHeldId(order.id);
    setHeldError("");
    try {
      const response = await fetch(restoreEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.error) {
        setHeldError(json?.error?.message ?? LABELS.restoreHeldFailed);
        return;
      }
      setHeldOrders((current) => current.filter((entry) => entry.id !== order.id));
      setHeldListOpen(false);
      router.replace(restoreHref);
      router.refresh();
    } finally {
      setRestoringHeldId(null);
    }
  }

  async function checkout(paymentMethod: "cash" | "transfer") {
    if (!cart.length || paymentSubmitting) return;
    const cashReceivedForCheckout = paymentMethod === "cash" ? cashReceivedAmount : undefined;
    if (paymentMethod === "cash" && Number(cashReceivedForCheckout ?? 0) < totalAmount) {
      setPaymentError("\u0e23\u0e31\u0e1a\u0e40\u0e07\u0e34\u0e19\u0e2a\u0e14\u0e19\u0e49\u0e2d\u0e22\u0e01\u0e27\u0e48\u0e32\u0e22\u0e2d\u0e14\u0e23\u0e27\u0e21");
      return;
    }
    const receiptSnapshot: ReceiptSnapshot = {
      orderNo: activeOrderNo,
      paymentMethod,
      total: totalAmount,
      subtotal: subtotalAmount,
      discount: discountAmount,
      cashReceived: paymentMethod === "cash" ? Number(cashReceivedForCheckout ?? 0) : null,
      change: paymentMethod === "cash" ? Math.max(0, Number(cashReceivedForCheckout ?? 0) - totalAmount) : 0,
      paidAt: new Date().toISOString(),
      lines: cart.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        lineTotal: item.quantity * item.price,
      })),
    };
    setPaymentSubmitting(paymentMethod);
    setPaymentError("");
    try {
      const response = await fetch(checkoutEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: activeOrderId,
          paymentMethod,
          cashReceived: cashReceivedForCheckout,
          referenceNo: paymentMethod === "transfer" ? transferReference.trim() || null : undefined,
          discountMode: "amount",
          discountValue: discountAmount,
          memberId: selectedMember?.id,
          memberPoints: memberEarned.points - redeemedPoints,
          memberStamps: memberEarned.stamps - redeemedStamps,
          items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.error) {
        setPaymentError(json?.error?.message ?? LABELS.paymentFailed);
        return;
      }
      clearPaidBillState();
      setReceipt({ ...receiptSnapshot, orderNo: json?.data?.orderNo ?? receiptSnapshot.orderNo, total: Number(json?.data?.total ?? receiptSnapshot.total) });
      setPaymentView("receipt");
      router.refresh();
    } finally {
      setPaymentSubmitting(null);
    }
  }

  return (
    <section aria-label={saleLabel} style={{ position: "relative", zIndex: 1, display: "grid", gap: 12 }}>
      <div
        style={{
          display: "grid",
          gap: 12,
          border: "1px solid #cfe2f5",
          borderRadius: 16,
          background: "#fff",
          padding: 12,
          boxShadow: "0 8px 22px rgba(15,39,69,0.08)",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, color: "#7a8fa8", fontSize: 10, fontWeight: 800 }}>{LABELS.billNo}</p>
            <strong style={{ display: "block", marginTop: 2, overflow: "hidden", color: "#0f2745", fontSize: 13, fontWeight: 900, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeOrderNo}
            </strong>
          </div>
          <div style={{ minWidth: 0 }}>
            <MemberLauncher
              orderId={activeOrderId}
              selectedMember={selectedMember}
              compact
              disabled={!hasCartItems}
              onMemberLinked={(member, earned) => {
                setSelectedMember(member);
                setMemberEarned(earned);
              }}
            />
          </div>
          <Link href={backHref} style={{ display: "inline-flex", minHeight: 34, alignItems: "center", justifyContent: "center", gap: 3, border: "1px solid #d9e8f7", borderRadius: 999, background: "#fff", color: "#17416f", padding: "0 11px", fontSize: 12, fontWeight: 900, textDecoration: "none", boxShadow: "0 4px 12px rgba(15,39,69,0.06)" }}>
            <ChevronLeft size={14} />
            {LABELS.back}
          </Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, borderTop: "1px solid #eef4fb", paddingTop: 12 }}>
          <div>
            <p style={{ margin: 0, color: "#7a8fa8", fontSize: 11, fontWeight: 700 }}>{LABELS.itemCount}</p>
            <strong style={{ display: "block", marginTop: 4, color: "#0f2745", fontSize: 24, lineHeight: 1 }}>{totalQuantity}</strong>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, color: "#7a8fa8", fontSize: 11, fontWeight: 700 }}>{LABELS.amount}</p>
            <strong style={{ display: "block", marginTop: 4, color: "#1677d9", fontSize: 24, lineHeight: 1 }}>{money(totalAmount)} {BAHT}</strong>
          </div>
        </div>

        {discountAmount > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, borderTop: "1px solid #eef4fb", paddingTop: 10 }}>
            <span style={{ color: "#7a8fa8", fontSize: 11, fontWeight: 800 }}>{LABELS.subtotal}</span>
            <b style={{ color: "#17416f", fontSize: 12 }}>{money(subtotalAmount)} {BAHT}</b>
            <span style={{ color: "#d62929", fontSize: 11, fontWeight: 800 }}>{LABELS.discount}</span>
            <b style={{ color: "#d62929", fontSize: 12 }}>- {money(discountAmount)} {BAHT}</b>
            <span style={{ color: "#1677d9", fontSize: 12, fontWeight: 900 }}>{LABELS.totalAfterDiscount}</span>
            <b style={{ color: "#1677d9", fontSize: 14 }}>{money(totalAmount)} {BAHT}</b>
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 8, borderTop: "1px solid #eef4fb", paddingTop: 12 }}>
          <button type="button" onClick={() => setProductPickerOpen(true)} style={{ position: "relative", zIndex: 2, display: "flex", minHeight: 44, alignItems: "center", justifyContent: "center", gap: 6, border: 0, borderRadius: 13, background: "#1677d9", color: "#fff", fontSize: 12, fontWeight: 900, pointerEvents: "auto" }}>
            <Plus size={18} />
            {LABELS.addProduct}
          </button>
          <button type="button" disabled={!hasCartItems} onClick={() => setDiscountOpen(true)} style={{ display: "flex", minHeight: 44, alignItems: "center", justifyContent: "center", gap: 6, border: "1px solid #d9e8f7", borderRadius: 13, background: hasCartItems ? "#fff" : "#f1f6fb", color: hasCartItems ? "#17416f" : "#9aadc2", fontSize: 12, fontWeight: 900, opacity: hasCartItems ? 1 : 0.65 }}>
            <Percent size={16} />
            {LABELS.discount}
          </button>
        </div>
      </div>

      <div style={{ border: "1px solid #d9e8f7", borderRadius: 16, background: "#fff", padding: 12, boxShadow: "0 4px 12px rgba(15,39,69,0.06)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 48px", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0, color: "#0f2745", fontSize: 14, fontWeight: 900 }}>{LABELS.cart}</h2>
          {cart.length ? (
            <button type="button" onClick={clearCart} style={{ minHeight: 30, border: "1px solid #ffd7d7", borderRadius: 999, background: "#fff8f8", color: "#d62929", padding: "0 10px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }}>
              {LABELS.clearAll}
            </button>
          ) : (
            <span />
          )}
          <span style={{ color: "#7a8fa8", fontSize: 11, fontWeight: 800 }}>
            {cart.length ? `${currentPage + 1}/${pageCount}` : `0 ${LABELS.itemCount}`}
          </span>
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {visibleCart.map((item) => (
            <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 76px 72px 28px", gap: 8, alignItems: "center", borderRadius: 12, background: "#f7fbff", padding: 10 }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#0f2745", fontSize: 12 }}>{item.name}</strong>
                <span style={{ color: "#7a8fa8", fontSize: 10 }}>{money(item.price)} {BAHT}</span>
              </div>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                <button type="button" onClick={() => updateQuantity(item.id, -1)} style={{ display: "flex", width: 24, height: 24, minHeight: 24, alignItems: "center", justifyContent: "center", border: "1px solid #d9e8f7", borderRadius: 8, background: "#fff" }}>
                  <Minus size={12} />
                </button>
                <b style={{ minWidth: 16, color: "#0f2745", fontSize: 12, textAlign: "center" }}>{item.quantity}</b>
                <button type="button" onClick={() => updateQuantity(item.id, 1)} style={{ display: "flex", width: 24, height: 24, minHeight: 24, alignItems: "center", justifyContent: "center", border: "1px solid #d9e8f7", borderRadius: 8, background: "#fff" }}>
                  <Plus size={12} />
                </button>
              </span>
              <span style={{ color: "#1677d9", fontSize: 12, fontWeight: 900, textAlign: "right" }}>{money(item.quantity * item.price)} {BAHT}</span>
              <button type="button" onClick={() => removeProduct(item.id)} aria-label={LABELS.deleteItem} title={LABELS.deleteItem} style={{ display: "flex", width: 28, height: 28, minHeight: 28, alignItems: "center", justifyContent: "center", border: "1px solid #ffd7d7", borderRadius: 9, background: "#fff", color: "#d62929" }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          {cart.length === 0 ? (
            <div style={{ display: "grid", justifyItems: "center", padding: "20px 12px", color: "#7a8fa8", textAlign: "center" }}>
              <Image src="/brand/cpipos-logo.png" alt="CpIPOS" width={148} height={102} style={{ width: 148, maxWidth: "62%", height: "auto", objectFit: "contain" }} />
            </div>
          ) : null}
        </div>

        {cart.length > PAGE_SIZE ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 12 }}>
            <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0} style={{ display: "flex", minHeight: 34, alignItems: "center", gap: 4, border: "1px solid #d9e8f7", borderRadius: 999, background: "#fff", color: currentPage === 0 ? "#aac0d6" : "#17416f", padding: "0 10px", fontSize: 12, fontWeight: 800 }}>
              <ChevronLeft size={14} /> {LABELS.previous}
            </button>
            <button type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage >= pageCount - 1} style={{ display: "flex", minHeight: 34, alignItems: "center", gap: 4, border: "1px solid #d9e8f7", borderRadius: 999, background: "#fff", color: currentPage >= pageCount - 1 ? "#aac0d6" : "#17416f", padding: "0 10px", fontSize: 12, fontWeight: 800 }}>
              {LABELS.next} <ChevronRight size={14} />
            </button>
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "0.9fr 0.9fr 1.35fr", gap: 7, marginTop: 12, borderTop: "1px solid #eef4fb", paddingTop: 12 }}>
          <button type="button" onClick={openCancelBillDialog} style={{ display: "flex", minHeight: 44, alignItems: "center", justifyContent: "center", border: "1px solid #ffd7d7", borderRadius: 13, background: "#fff8f8", color: "#d62929", fontSize: 12, fontWeight: 900 }}>
            {LABELS.cancelBill}
          </button>
          <button type="button" onClick={holdCurrentBill} disabled={holdSubmitting} style={{ display: "flex", minHeight: 44, alignItems: "center", justifyContent: "center", border: "1px solid #ffdca8", borderRadius: 13, background: holdSubmitting ? "#fff4e1" : "#fffaf2", color: holdSubmitting ? "#d6a96f" : "#b65f00", fontSize: 12, fontWeight: 900 }}>
            {holdSubmitting ? "..." : LABELS.holdBill}
          </button>
          <button type="button" onClick={openPaymentChooser} disabled={!cart.length} style={{ display: "flex", minHeight: 44, alignItems: "center", justifyContent: "center", border: 0, borderRadius: 13, background: totalQuantity ? "#1677d9" : "#a8cdf2", color: "#fff", fontSize: 12, fontWeight: 900 }}>
            {LABELS.pay} {money(totalAmount)} {BAHT}
          </button>
        </div>
        {holdSubmitError ? (
          <p style={{ margin: "8px 0 0", color: "#d62929", fontSize: 12, fontWeight: 800 }}>
            {holdSubmitError}
          </p>
        ) : null}
      </div>

      {productPickerOpen ? (
        <div role="dialog" aria-modal="true" aria-label={LABELS.chooseProduct} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,39,69,0.35)", padding: "14px 10px max(14px, env(safe-area-inset-bottom))" }}>
          <section style={{ width: "min(94vw, 462px)", maxHeight: "78dvh", overflow: "hidden", border: "1px solid #d9e8f7", borderRadius: 20, background: "#f5f8fb", boxShadow: "0 18px 48px rgba(15,39,69,0.22)" }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottom: "1px solid #d9e8f7", background: "#fff", padding: 14 }}>
              <div>
                <h2 style={{ margin: 0, color: "#0f2745", fontSize: 16, fontWeight: 900 }}>{LABELS.chooseProduct}</h2>
                <p style={{ margin: "2px 0 0", color: "#7a8fa8", fontSize: 11 }}>{products.length} {LABELS.itemCount}</p>
              </div>
              {addedNotice ? (
                <div style={{ maxWidth: 140, overflow: "hidden", border: "1px solid #bcefd0", borderRadius: 999, background: "#e9fff1", color: "#0f8d46", padding: "7px 10px", fontSize: 11, fontWeight: 900, textOverflow: "ellipsis", whiteSpace: "nowrap", boxShadow: "0 6px 18px rgba(15,141,70,0.16)", animation: "fadeAddedNotice 1.2s ease forwards" }}>
                  {LABELS.added}
                </div>
              ) : null}
              <button type="button" onClick={() => setProductPickerOpen(false)} aria-label={LABELS.close} style={{ display: "flex", width: 36, height: 36, minHeight: 36, alignItems: "center", justifyContent: "center", border: "1px solid #d9e8f7", borderRadius: 999, background: "#fff", color: "#17416f" }}>
                <X size={18} />
              </button>
            </header>

            <div style={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) 32px", gap: 6, alignItems: "center", padding: "12px 12px 8px" }}>
              <button type="button" onClick={() => scrollCategories("left")} aria-label={LABELS.previous} style={{ display: "flex", width: 32, height: 32, minHeight: 32, alignItems: "center", justifyContent: "center", border: "1px solid #d9e8f7", borderRadius: 999, background: "#fff", color: "#17416f" }}>
                <ChevronLeft size={16} />
              </button>
              <div ref={categoryScrollerRef} style={{ display: "flex", gap: 8, overflowX: "auto", scrollBehavior: "smooth", scrollbarWidth: "none" }}>
                {categories.map((category) => {
                  const active = category.name === activeCategory;
                  return (
                    <button key={category.id} type="button" onClick={() => setActiveCategory(category.name)} style={{ minHeight: 36, flex: "0 0 auto", border: `1px solid ${active ? "#1677d9" : "#d9e8f7"}`, borderRadius: 999, background: active ? "#1677d9" : "#fff", color: active ? "#fff" : "#17416f", padding: "0 14px", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                      {category.name}
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={() => scrollCategories("right")} aria-label={LABELS.next} style={{ display: "flex", width: 32, height: 32, minHeight: 32, alignItems: "center", justifyContent: "center", border: "1px solid #d9e8f7", borderRadius: 999, background: "#fff", color: "#17416f" }}>
                <ChevronRight size={16} />
              </button>
            </div>

            <div style={{ maxHeight: "calc(78dvh - 116px)", overflowY: "auto", padding: "4px 12px 14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                {renderedProducts.map((product) => (
                  <button key={product.id} type="button" onClick={() => chooseProduct(product)} style={{ minHeight: 110, border: "1px solid #d9e8f7", borderRadius: 14, background: "#fff", padding: 12, textAlign: "left", boxShadow: "0 4px 12px rgba(15,39,69,0.06)", touchAction: "manipulation" }}>
                    <strong style={{ display: "block", minHeight: 34, color: "#0f2745", fontSize: 13, fontWeight: 900, lineHeight: 1.25 }}>{product.name}</strong>
                    <span style={{ display: "block", marginTop: 6, color: "#7a8fa8", fontSize: 10, lineHeight: 1.25 }}>{product.sku ?? product.category}</span>
                    {product.ingredients?.length ? <span style={{ display: "inline-flex", marginTop: 7, borderRadius: 999, background: "#eef6ff", color: "#1677d9", padding: "3px 7px", fontSize: 10, fontWeight: 900 }}>มีวัตถุดิบ {product.ingredients.length}</span> : null}
                    <span style={{ display: "block", marginTop: 10, color: "#1677d9", fontSize: 15, fontWeight: 900 }}>{money(product.price)} {BAHT}</span>
                  </button>
                ))}
              </div>

              {visibleProducts.length > renderedProducts.length ? (
                <div style={{ marginTop: 10, border: "1px solid #d9e8f7", borderRadius: 14, background: "#fff", padding: 12, color: "#587398", fontSize: 12, fontWeight: 800, textAlign: "center" }}>
                  แสดง {renderedProducts.length} จาก {visibleProducts.length} รายการ กรุณาเลือกหมวดให้แคบลง
                </div>
              ) : null}

              {visibleProducts.length === 0 ? (
                <div style={{ border: "1px solid #d9e8f7", borderRadius: 14, background: "#fff", padding: 16, color: "#7a8fa8", fontSize: 13, textAlign: "center" }}>
                  {LABELS.noProducts}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {ingredientProduct ? (
        <div role="dialog" aria-modal="true" aria-label="เลือกวัตถุดิบ" style={{ position: "fixed", inset: 0, zIndex: 65, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,39,69,0.38)", padding: 16 }}>
          <section style={{ width: "min(92vw, 390px)", maxHeight: "72dvh", overflow: "hidden", border: "1px solid #d9e8f7", borderRadius: 18, background: "#fff", boxShadow: "0 18px 48px rgba(15,39,69,0.24)" }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottom: "1px solid #eef4fb", padding: 14 }}>
              <div>
                <h2 style={{ margin: 0, color: "#0f2745", fontSize: 16, fontWeight: 900 }}>เลือกวัตถุดิบ</h2>
                <p style={{ margin: "2px 0 0", color: "#7a8fa8", fontSize: 11, fontWeight: 800 }}>{ingredientProduct.name}</p>
              </div>
              <button type="button" onClick={() => setIngredientProduct(null)} aria-label={LABELS.close} style={{ display: "flex", width: 34, height: 34, minHeight: 34, alignItems: "center", justifyContent: "center", border: "1px solid #d9e8f7", borderRadius: 999, background: "#fff", color: "#17416f" }}>
                <X size={17} />
              </button>
            </header>
            <div style={{ display: "grid", gap: 8, maxHeight: "calc(72dvh - 132px)", overflowY: "auto", padding: 12 }}>
              {(ingredientProduct.ingredients ?? []).map((ingredient) => {
                const checked = ingredientSelections[ingredient.id] ?? ingredient.selected;
                return (
                  <label key={ingredient.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 8, alignItems: "center", border: "1px solid #d9e8f7", borderRadius: 12, background: checked ? "#f5fbff" : "#fff", padding: "10px 12px" }}>
                    <input type="checkbox" checked={checked} onChange={(event) => setIngredientSelections((current) => ({ ...current, [ingredient.id]: event.target.checked }))} style={{ width: 18, height: 18 }} />
                    <span style={{ minWidth: 0, color: "#0f2745", fontSize: 13, fontWeight: 900 }}>{ingredient.name}</span>
                    <b style={{ color: "#1677d9", fontSize: 12 }}>{ingredient.quantity} {ingredient.unit}</b>
                  </label>
                );
              })}
            </div>
            <footer style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 8, borderTop: "1px solid #eef4fb", padding: 12 }}>
              <button type="button" onClick={() => setIngredientProduct(null)} style={{ minHeight: 42, border: "1px solid #d9e8f7", borderRadius: 12, background: "#fff", color: "#17416f", fontSize: 13, fontWeight: 900 }}>ยกเลิก</button>
              <button type="button" onClick={confirmIngredientProduct} style={{ minHeight: 42, border: 0, borderRadius: 12, background: "#1677d9", color: "#fff", fontSize: 13, fontWeight: 950 }}>เพิ่มสินค้า</button>
            </footer>
          </section>
        </div>
      ) : null}

      {discountOpen ? (
        <div role="dialog" aria-modal="true" aria-label={LABELS.discount} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,39,69,0.35)", padding: 16 }}>
          <section style={{ width: "min(92vw, 390px)", border: "1px solid #d9e8f7", borderRadius: 18, background: "#fff", padding: 14, boxShadow: "0 18px 48px rgba(15,39,69,0.22)" }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <h2 style={{ margin: 0, color: "#0f2745", fontSize: 16, fontWeight: 900 }}>{LABELS.discount}</h2>
              <button type="button" onClick={() => setDiscountOpen(false)} aria-label={LABELS.close} style={{ display: "flex", width: 34, height: 34, minHeight: 34, alignItems: "center", justifyContent: "center", border: "1px solid #d9e8f7", borderRadius: 999, background: "#fff", color: "#17416f" }}>
                <X size={17} />
              </button>
            </header>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setDiscountMode("percent")} style={{ minHeight: 42, border: `1px solid ${discountMode === "percent" ? "#1677d9" : "#d9e8f7"}`, borderRadius: 12, background: discountMode === "percent" ? "#1677d9" : "#fff", color: discountMode === "percent" ? "#fff" : "#17416f", fontSize: 13, fontWeight: 900 }}>{LABELS.percent}</button>
              <button type="button" onClick={() => setDiscountMode("amount")} style={{ minHeight: 42, border: `1px solid ${discountMode === "amount" ? "#1677d9" : "#d9e8f7"}`, borderRadius: 12, background: discountMode === "amount" ? "#1677d9" : "#fff", color: discountMode === "amount" ? "#fff" : "#17416f", fontSize: 13, fontWeight: 900 }}>{LABELS.amountValue}</button>
            </div>
            <label style={{ display: "grid", gap: 6, marginTop: 12, color: "#7a8fa8", fontSize: 11, fontWeight: 800 }}>
              {LABELS.discountType}
              <input value={discountInput} onChange={(event) => setDiscountInput(event.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder={discountMode === "percent" ? "0%" : `0.00 ${BAHT}`} style={{ minHeight: 46, border: "1px solid #d9e8f7", borderRadius: 12, padding: "0 12px", color: "#0f2745", fontSize: 16, fontWeight: 900, outline: "none" }} />
            </label>
            {selectedMember ? (
              <div style={{ display: "grid", gap: 8, marginTop: 12, border: "1px solid #d9e8f7", borderRadius: 14, background: "#f8fbff", padding: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                  <span style={{ minWidth: 0, color: "#0f2745", fontSize: 12, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedMember.name}</span>
                  <span style={{ color: "#587398", fontSize: 11, fontWeight: 800 }}>{selectedMember.points} คะแนน / {selectedMember.stamps} แต้ม</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
                  <label style={{ display: "grid", minWidth: 0, gap: 5, color: "#587398", fontSize: 11, fontWeight: 900 }}>
                    ใช้คะแนน
                    <input value={redeemPointsInput} onChange={(event) => setRedeemPointsInput(event.target.value.replace(/\D/g, "").slice(0, 7))} inputMode="numeric" placeholder="0" style={{ boxSizing: "border-box", width: "100%", minWidth: 0, minHeight: 42, border: "1px solid #d9e8f7", borderRadius: 12, padding: "0 10px", color: "#0f2745", fontSize: 15, fontWeight: 900, outline: "none" }} />
                  </label>
                  <label style={{ display: "grid", minWidth: 0, gap: 5, color: "#587398", fontSize: 11, fontWeight: 900 }}>
                    ใช้แต้ม
                    <input value={redeemStampsInput} onChange={(event) => setRedeemStampsInput(event.target.value.replace(/\D/g, "").slice(0, 7))} inputMode="numeric" placeholder="0" style={{ boxSizing: "border-box", width: "100%", minWidth: 0, minHeight: 42, border: "1px solid #d9e8f7", borderRadius: 12, padding: "0 10px", color: "#0f2745", fontSize: 15, fontWeight: 900, outline: "none" }} />
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, color: "#587398", fontSize: 11, fontWeight: 800 }}>
                  <span>ส่วนลดจากสมาชิก</span>
                  <b style={{ color: "#d62929" }}>- {money(rewardDiscountAmount)} {BAHT}</b>
                  <span>คงเหลือหลังใช้</span>
                  <b style={{ color: "#0f2745" }}>{selectedMember.points - redeemedPoints} คะแนน / {selectedMember.stamps - redeemedStamps} แต้ม</b>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 12, border: "1px solid #d9e8f7", borderRadius: 14, background: "#f8fbff", padding: 10, color: "#587398", fontSize: 12, fontWeight: 800 }}>
                เลือกสมาชิกก่อน หากต้องการใช้คะแนนหรือแต้มเป็นส่วนลด
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 12, borderRadius: 12, background: "#f7fbff", padding: 10 }}>
              <span style={{ color: "#7a8fa8", fontSize: 11, fontWeight: 800 }}>{LABELS.subtotal}</span>
              <b style={{ color: "#17416f", fontSize: 12 }}>{money(subtotalAmount)} {BAHT}</b>
              <span style={{ color: "#d62929", fontSize: 11, fontWeight: 800 }}>ส่วนลดทั่วไป</span>
              <b style={{ color: "#d62929", fontSize: 12 }}>- {money(manualDiscountAmount)} {BAHT}</b>
              {rewardDiscountAmount > 0 ? (
                <>
                  <span style={{ color: "#d62929", fontSize: 11, fontWeight: 800 }}>ส่วนลดสมาชิก</span>
                  <b style={{ color: "#d62929", fontSize: 12 }}>- {money(rewardDiscountAmount)} {BAHT}</b>
                </>
              ) : null}
              <span style={{ color: "#d62929", fontSize: 11, fontWeight: 800 }}>{LABELS.discount}</span>
              <b style={{ color: "#d62929", fontSize: 12 }}>- {money(discountAmount)} {BAHT}</b>
              <span style={{ color: "#1677d9", fontSize: 12, fontWeight: 900 }}>{LABELS.totalAfterDiscount}</span>
              <b style={{ color: "#1677d9", fontSize: 14 }}>{money(totalAmount)} {BAHT}</b>
            </div>
            <button type="button" onClick={() => setDiscountOpen(false)} style={{ width: "100%", minHeight: 46, marginTop: 12, border: 0, borderRadius: 13, background: "#1677d9", color: "#fff", fontSize: 14, fontWeight: 900 }}>
              {LABELS.apply}
            </button>
          </section>
        </div>
      ) : null}

      {heldListOpen ? (
        <div role="dialog" aria-modal="true" aria-label={LABELS.heldOrders} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,39,69,0.35)", padding: 16 }}>
          <section style={{ width: "min(94vw, 430px)", maxHeight: "86dvh", overflow: "hidden", border: "1px solid #d9e8f7", borderRadius: 18, background: "#f5f8fb", boxShadow: "0 18px 48px rgba(15,39,69,0.22)" }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottom: "1px solid #d9e8f7", background: "#fff", padding: 14 }}>
              <div>
                <h2 style={{ margin: 0, color: "#0f2745", fontSize: 16, fontWeight: 900 }}>{LABELS.heldOrders}</h2>
                <p style={{ margin: "2px 0 0", color: "#7a8fa8", fontSize: 11 }}>{heldOrders.length} {LABELS.itemCount}</p>
              </div>
              <button type="button" onClick={() => setHeldListOpen(false)} aria-label={LABELS.close} style={{ display: "flex", width: 36, height: 36, minHeight: 36, alignItems: "center", justifyContent: "center", border: "1px solid #d9e8f7", borderRadius: 999, background: "#fff", color: "#17416f" }}>
                <X size={18} />
              </button>
            </header>
            <div style={{ maxHeight: "calc(86dvh - 66px)", overflowY: "auto", padding: 12 }}>
              {heldLoading ? (
                <div style={{ border: "1px solid #d9e8f7", borderRadius: 14, background: "#fff", padding: 16, color: "#7a8fa8", fontSize: 13, fontWeight: 800, textAlign: "center" }}>...</div>
              ) : null}
              {heldError ? (
                <div style={{ border: "1px solid #ffd7d7", borderRadius: 14, background: "#fff8f8", padding: 12, color: "#d62929", fontSize: 12, fontWeight: 800 }}>{heldError}</div>
              ) : null}
              {!heldLoading && !heldOrders.length && !heldError ? (
                <div style={{ border: "1px solid #d9e8f7", borderRadius: 14, background: "#fff", padding: 16, color: "#7a8fa8", fontSize: 13, fontWeight: 800, textAlign: "center" }}>{LABELS.noHeldOrders}</div>
              ) : null}
              <div style={{ display: "grid", gap: 10 }}>
                {heldOrders.map((order) => (
                  <article key={order.id} style={{ border: "1px solid #d9e8f7", borderRadius: 14, background: "#fff", padding: 12, boxShadow: "0 4px 12px rgba(15,39,69,0.06)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start" }}>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ display: "block", overflow: "hidden", color: "#0f2745", fontSize: 13, fontWeight: 900, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.orderNo}</strong>
                        <span style={{ color: "#7a8fa8", fontSize: 10 }}>{order.itemCount} {LABELS.itemCount}</span>
                      </div>
                      <b style={{ color: "#1677d9", fontSize: 14 }}>{money(order.total)} {BAHT}</b>
                    </div>
                    <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                      {order.items.slice(0, 5).map((item, index) => (
                        <div key={`${order.id}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, borderRadius: 10, background: "#f7fbff", padding: "8px 10px" }}>
                          <span style={{ overflow: "hidden", color: "#0f2745", fontSize: 11, fontWeight: 800, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name} x{item.quantity}</span>
                          <b style={{ color: "#17416f", fontSize: 11 }}>{money(item.lineTotal)} {BAHT}</b>
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={() => restoreHeldOrder(order)} disabled={Boolean(restoringHeldId)} style={{ width: "100%", minHeight: 38, marginTop: 10, border: 0, borderRadius: 12, background: "#1677d9", color: "#fff", fontSize: 12, fontWeight: 900 }}>
                      {restoringHeldId === order.id ? "..." : LABELS.restoreHeld}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {paymentOpen ? (
        <div role="dialog" aria-modal="true" aria-label={paymentView === "receipt" ? LABELS.receiptTitle : LABELS.choosePayment} style={{ position: "fixed", inset: 0, zIndex: 180, overflowY: paymentView === "transfer" || paymentView === "cash" ? "hidden" : "auto", scrollbarWidth: "none", background: paymentView === "choose" ? "rgba(15,39,69,0.35)" : "#fff", padding: paymentView === "choose" ? 10 : paymentView === "cash" ? "10px 8px max(10px, env(safe-area-inset-bottom))" : "14px 8px max(18px, env(safe-area-inset-bottom))", pointerEvents: "auto", touchAction: "manipulation" }}>
          {paymentView === "choose" ? (
            <section style={{ width: "min(95vw, 430px)", margin: "42dvh auto 0", transform: "translateY(-50%)", border: "1px solid #d9e8f7", borderRadius: 18, background: "#fff", padding: 14, boxShadow: "0 18px 48px rgba(15,39,69,0.22)" }}>
              <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <h2 style={{ margin: 0, color: "#0f2745", fontSize: 16, fontWeight: 900 }}>{LABELS.choosePayment}</h2>
                  <p style={{ margin: "2px 0 0", color: "#1677d9", fontSize: 14, fontWeight: 900 }}>{money(totalAmount)} {BAHT}</p>
                </div>
                <button type="button" onClick={() => setPaymentOpen(false)} aria-label={LABELS.close} style={{ display: "flex", width: 38, height: 38, minHeight: 38, alignItems: "center", justifyContent: "center", border: "1px solid #d9e8f7", borderRadius: 999, background: "#fff", color: "#17416f" }}>
                  <X size={18} />
                </button>
              </header>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
                <button type="button" onClick={openCashPayment} disabled={Boolean(paymentSubmitting)} style={{ display: "grid", minHeight: 112, alignContent: "center", justifyItems: "center", gap: 10, border: "1px solid #cfe2f5", borderRadius: 15, background: "#f7fbff", color: "#0f2745", padding: 12, fontSize: 14, fontWeight: 900, textAlign: "center" }}>
                  <span style={{ display: "flex", width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14, background: "#eaf5ff", color: "#1677d9" }}>
                    <Banknote size={25} />
                  </span>
                  {LABELS.payCash}
                </button>
                <button type="button" onClick={() => void openTransferPayment()} disabled={Boolean(paymentSubmitting)} style={{ display: "grid", minHeight: 112, alignContent: "center", justifyItems: "center", gap: 10, border: "1px solid #cfe2f5", borderRadius: 15, background: paymentSubmitting ? "#eef4fb" : "#f7fbff", color: "#0f2745", padding: 12, fontSize: 14, fontWeight: 900, textAlign: "center" }}>
                  <span style={{ display: "flex", width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14, background: "#eaf5ff", color: "#1677d9" }}>
                    <Landmark size={25} />
                  </span>
                  {LABELS.payTransfer}
                </button>
              </div>
              {paymentError ? <p style={{ margin: "10px 0 0", color: "#d62929", fontSize: 12, fontWeight: 800 }}>{paymentError}</p> : null}
            </section>
          ) : null}

          {paymentView === "cash" ? (
            <section style={{ position: "relative", minHeight: "100dvh", display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", gap: 7, maxWidth: 430, margin: "0 auto", paddingBottom: "max(92px, env(safe-area-inset-bottom) + 86px)", pointerEvents: "auto", touchAction: "manipulation" }}>
              <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <h2 style={{ margin: 0, color: "#1d2430", fontSize: 20, fontWeight: 900, lineHeight: 1.12 }}>{LABELS.cashPaymentTitle}</h2>
                  <p style={{ margin: "3px 0 0", color: "#667085", fontSize: 10 }}>{LABELS.paidFromCustomer}</p>
                </div>
                <button type="button" onClick={() => setPaymentView("choose")} style={{ minWidth: 38, minHeight: 38, border: "1px solid #d9e8f7", borderRadius: 9, background: "#fff", color: "#0f2745", fontSize: 12, fontWeight: 800 }}>{LABELS.close}</button>
              </header>

              <div style={{ minHeight: 0, overflowY: "auto", scrollbarWidth: "none", display: "grid", alignContent: "start", gap: 5, paddingBottom: 8 }}>
                <div style={{ display: "grid", gap: 8, border: "1px solid #d9e8f7", borderRadius: 13, background: "#f8fbff", padding: "10px 12px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
                    <span style={{ color: "#334155", fontSize: 13, fontWeight: 900 }}>{LABELS.amountDue}</span>
                    <b style={{ color: "#16a34a", fontSize: 30, fontWeight: 950, lineHeight: 1 }}>{BAHT}{money(totalAmount)}</b>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", borderTop: "1px dashed #c9dbf2", paddingTop: 8 }}>
                    <span style={{ color: "#334155", fontSize: 13, fontWeight: 900 }}>{LABELS.cashReceived}</span>
                    <b style={{ color: "#1d4ed8", fontSize: 29, fontWeight: 950, lineHeight: 1 }}>{money(cashReceivedAmount)}</b>
                  </div>
                </div>

                <div style={{ border: "1px solid #d9e8f7", borderRadius: 12, background: "#fff", padding: 9, marginTop: 5 }}>
                  <p style={{ margin: "0 0 7px", color: "#334155", fontSize: 12, fontWeight: 900 }}>{LABELS.keypad}</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 64px", gap: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "00", "."].map((key) => (
                        <button key={key} type="button" onPointerUp={() => runCashButton(() => appendCashInput(key))} onClick={(event) => { if (event.detail === 0) runCashButton(() => appendCashInput(key)); }} style={{ minHeight: 48, border: "1px solid #d9e8f7", borderRadius: 9, background: "#f8fbff", color: "#111827", fontSize: 21, fontWeight: 900, pointerEvents: "auto", touchAction: "manipulation", WebkitTapHighlightColor: "transparent", cursor: "pointer", userSelect: "none" }}>{key}</button>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 8 }}>
                      <button type="button" onPointerUp={() => runCashButton(deleteCashInput)} onClick={(event) => { if (event.detail === 0) runCashButton(deleteCashInput); }} style={{ minHeight: 48, border: "1px solid #d9e8f7", borderRadius: 9, background: "#eef6ff", color: "#0f2745", fontSize: 11, fontWeight: 900, pointerEvents: "auto", touchAction: "manipulation", WebkitTapHighlightColor: "transparent", cursor: "pointer", userSelect: "none" }}>{LABELS.delete}</button>
                      <button type="button" onPointerUp={() => runCashButton(() => setCashReceivedInput(""))} onClick={(event) => { if (event.detail === 0) runCashButton(() => setCashReceivedInput("")); }} style={{ minHeight: 48, border: 0, borderRadius: 9, background: "#164aa6", color: "#fff", fontSize: 11, fontWeight: 900, pointerEvents: "auto", touchAction: "manipulation", WebkitTapHighlightColor: "transparent", cursor: "pointer", userSelect: "none" }}>{LABELS.clear}</button>
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 7, justifyItems: "center" }}>
                  <span style={{ color: "#334155", fontSize: 12, fontWeight: 900 }}>{LABELS.quickCash}</span>
                  <div style={{ display: "grid", width: "min(100%, 372px)", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", justifyContent: "center", gap: 8 }}>
                    {[500, 1000, 1500].map((amount) => (
                      <button key={amount} type="button" onPointerUp={() => runCashButton(() => setCashReceivedInput(String(amount)))} onClick={(event) => { if (event.detail === 0) runCashButton(() => setCashReceivedInput(String(amount))); }} style={{ minHeight: 38, border: "1px solid #b9d7ff", borderRadius: 8, background: "#eaf4ff", color: "#1d4ed8", fontSize: 10, fontWeight: 900, pointerEvents: "auto", touchAction: "manipulation", WebkitTapHighlightColor: "transparent", cursor: "pointer", userSelect: "none" }}>{BAHT}{amount.toLocaleString("th-TH")}.00</button>
                    ))}
                  </div>
                  <div style={{ display: "grid", width: "min(100%, 414px)", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", border: "1px solid #d9e8f7", borderRadius: 12, background: "#f8fbff", padding: "8px 12px" }}>
                    <span style={{ color: "#334155", fontSize: 13, fontWeight: 900 }}>{LABELS.change}</span>
                    <b style={{ color: "#16a34a", fontSize: 26, fontWeight: 950, lineHeight: 1 }}>{BAHT}{money(cashChangeAmount)}</b>
                  </div>
                  {cashUnderpaid ? (
                    <p role="alert" style={{ width: "min(100%, 414px)", margin: 0, border: "1px solid #fecaca", borderRadius: 10, background: "#fff1f1", color: "#d62929", padding: "8px 10px", textAlign: "center", fontSize: 12, fontWeight: 900 }}>
                      รับเงินสดต้องไม่น้อยกว่ายอดที่ต้องชำระ
                    </p>
                  ) : null}
                </div>
              </div>

              <footer style={{ position: "fixed", right: 0, bottom: "max(104px, env(safe-area-inset-bottom) + 100px)", left: 0, zIndex: 210, display: "grid", gridTemplateColumns: "88px minmax(0, 232px)", justifyContent: "center", gap: 10, alignItems: "center", padding: "0 14px", pointerEvents: "auto" }}>
                <button type="button" onClick={() => setPaymentView("choose")} style={{ minHeight: 44, border: "1px solid #fecaca", borderRadius: 9, background: "#fff1f1", color: "#b91c1c", fontSize: 11, fontWeight: 900 }}>{LABELS.cancelBill}</button>
                <button type="button" onClick={() => checkout("cash")} disabled={Boolean(paymentSubmitting) || cashUnderpaid} style={{ display: "flex", minHeight: 44, alignItems: "center", justifyContent: "center", gap: 9, border: 0, borderRadius: 9, background: Boolean(paymentSubmitting) || cashUnderpaid ? "#7aa3e8" : "#164aa6", color: "#fff", fontSize: 13, fontWeight: 950 }}>{paymentSubmitting === "cash" ? "..." : <><span>{LABELS.confirmPayment}</span><CheckCircle2 size={15} /></>}</button>
              </footer>
              {paymentError ? <p style={{ margin: 0, color: "#d62929", fontSize: 12, fontWeight: 800 }}>{paymentError}</p> : null}
              {paymentSubmitting === "cash" ? (
                <div style={{ position: "fixed", inset: 0, zIndex: 2, display: "grid", placeItems: "center", background: "rgba(15,23,42,0.35)", backdropFilter: "blur(4px)", padding: 24 }}>
                  <div style={{ display: "grid", justifyItems: "center", gap: 14, width: "min(360px, 100%)", borderRadius: 12, background: "#fff", padding: "28px 22px", color: "#0f2745", fontSize: 15, fontWeight: 900, boxShadow: "0 18px 48px rgba(15,39,69,0.22)" }}>
                    <span style={{ width: 36, height: 36, border: "3px solid #d9e8f7", borderTopColor: "#2563eb", borderRadius: 999, animation: "posSpin 0.8s linear infinite" }} />
                    {LABELS.savingTransfer}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {paymentView === "transfer" ? (
            <section style={{ position: "relative", display: "grid", gridTemplateRows: "auto auto auto", gap: 6, maxWidth: 500, margin: "0 auto", paddingBottom: 4 }}>
              <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <h2 style={{ margin: 0, color: "#1d2430", fontSize: "clamp(18px, 4.8vw, 22px)", fontWeight: 900, lineHeight: 1.15 }}>{LABELS.transferPaymentTitle}</h2>
                <button type="button" onClick={() => setPaymentView("choose")} style={{ minWidth: 40, minHeight: 40, border: "1px solid #d9e8f7", borderRadius: 9, background: "#fff", color: "#0f2745", fontSize: 17, fontWeight: 800 }}>x</button>
              </header>

              <div style={{ display: "grid", alignContent: "start", gap: 7, minHeight: 0, overflowY: "hidden", scrollbarWidth: "none", border: "1px solid #d9e8f7", borderRadius: 8, background: "#fff", padding: "10px 14px 9px" }}>
                <div style={{ display: "grid", justifyItems: "center", gap: 2, borderBottom: "1px solid #d9e8f7", paddingBottom: 6 }}>
                  <span style={{ color: "#334155", fontSize: 12, fontWeight: 800 }}>{LABELS.amountDue}</span>
                  <b style={{ color: "#2563eb", fontSize: "clamp(34px, 9.5vw, 42px)", fontWeight: 950, lineHeight: 1 }}>{BAHT}{money(totalAmount)}</b>
                </div>
                <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
                  <h3 style={{ margin: 0, color: "#334155", fontSize: 14, fontWeight: 900 }}>{LABELS.scanQrToPay}</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", width: "min(276px, 100%)", border: "1px solid #d9e8f7", borderRadius: 8, overflow: "hidden" }}>
                    <button type="button" onClick={() => setTransferMode("manual")} style={{ minHeight: 34, border: 0, background: transferMode === "manual" ? "#ff681f" : "#fff", color: transferMode === "manual" ? "#fff" : "#334155", fontSize: 12, fontWeight: 900 }}>{LABELS.manualTransfer}</button>
                    <button type="button" onClick={() => setTransferMode("inet_nops")} style={{ minHeight: 34, border: 0, borderLeft: "1px solid #d9e8f7", background: transferMode === "inet_nops" ? "#ff681f" : "#fff", color: transferMode === "inet_nops" ? "#fff" : "#334155", fontSize: 12, fontWeight: 900 }}>{LABELS.inetQr}</button>
                  </div>
                  {transferQrLoading ? (
                    <div style={{ display: "grid", minHeight: "min(50vw, 202px)", width: "min(252px, 66vw)", placeItems: "center", border: "1px solid #d9e8f7", borderRadius: 8, background: "#f8fbff", color: "#64748b", fontSize: 13, fontWeight: 800 }}>
                      <span style={{ width: 30, height: 30, marginBottom: 8, border: "3px solid #d9e8f7", borderTopColor: "#2563eb", borderRadius: 999, animation: "posSpin 0.8s linear infinite" }} />
                      {LABELS.loadingQr}
                    </div>
                  ) : transferMode === "inet_nops" ? (
                    <div style={{ display: "grid", minHeight: "min(56vw, 224px)", width: "min(270px, 70vw)", placeItems: "center", border: "1px solid #d9e8f7", borderRadius: 8, background: "#f8fbff", color: "#64748b", padding: 12, textAlign: "center", fontSize: 13, fontWeight: 800 }}>
                      {transferQr?.inet.enabled ? LABELS.inetQrNotReady : LABELS.inetQrNotReady}
                    </div>
                  ) : transferQr?.manual?.qrUrl ? (
                    <div style={{ display: "grid", width: "min(270px, 70vw)", placeItems: "center", border: "1px solid #d9e8f7", borderRadius: 8, background: "#fff", padding: 8 }}>
                      <Image src={transferQr.manual.qrUrl} alt={LABELS.scanQrToPay} width={220} height={220} unoptimized style={{ display: "block", width: "100%", maxWidth: 220, aspectRatio: "1 / 1", objectFit: "contain" }} />
                    </div>
                  ) : (
                    <div style={{ display: "grid", minHeight: "min(56vw, 224px)", width: "min(270px, 70vw)", placeItems: "center", border: "1px solid #d9e8f7", borderRadius: 8, background: "#f8fbff", color: "#b91c1c", padding: 12, textAlign: "center", fontSize: 13, fontWeight: 800 }}>{LABELS.qrNotConfigured}</div>
                  )}
                  <p style={{ margin: 0, color: "#64748b", fontSize: 11, fontWeight: 800 }}>{LABELS.scanWithBankApp}</p>
                  {transferQr?.manual?.accountName ? (
                    <p style={{ margin: 0, color: "#64748b", fontSize: 10, textAlign: "center" }}>{[transferQr.manual.bankName, transferQr.manual.accountName, transferQr.manual.accountNumber].filter(Boolean).join(" / ")}</p>
                  ) : null}
                </div>
              </div>

              <button type="button" onClick={() => void checkout("transfer")} disabled={Boolean(paymentSubmitting) || transferQrLoading || transferMode !== "manual" || !transferQr?.manual?.qrUrl} style={{ width: "min(280px, 78vw)", justifySelf: "center", minHeight: 44, border: 0, borderRadius: 10, background: Boolean(paymentSubmitting) || transferQrLoading || transferMode !== "manual" || !transferQr?.manual?.qrUrl ? "#fda77a" : "#ff681f", color: "#fff", fontSize: 15, fontWeight: 950 }}>{LABELS.confirmTransfer}</button>
              {paymentError ? <p style={{ margin: 0, color: "#d62929", fontSize: 12, fontWeight: 800 }}>{paymentError}</p> : null}
              {paymentSubmitting === "transfer" ? (
                <div style={{ position: "fixed", inset: 0, zIndex: 2, display: "grid", placeItems: "center", background: "rgba(15,23,42,0.35)", backdropFilter: "blur(4px)", padding: 24 }}>
                  <div style={{ display: "grid", justifyItems: "center", gap: 14, width: "min(360px, 100%)", borderRadius: 12, background: "#fff", padding: "28px 22px", color: "#0f2745", fontSize: 15, fontWeight: 900, boxShadow: "0 18px 48px rgba(15,39,69,0.22)" }}>
                    <span style={{ width: 36, height: 36, border: "3px solid #d9e8f7", borderTopColor: "#2563eb", borderRadius: 999, animation: "posSpin 0.8s linear infinite" }} />
                    {LABELS.savingTransfer}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {paymentView === "receipt" && receipt ? (
            <section style={{ height: "calc(100dvh - max(18px, env(safe-area-inset-bottom)))", display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", gap: 7, maxWidth: 430, margin: "0 auto" }}>
              <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <h2 style={{ margin: 0, color: "#1d2430", fontSize: 19, fontWeight: 900 }}>{LABELS.receiptTitle}</h2>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" onClick={printReceiptAndClose} style={{ minWidth: 96, minHeight: 38, border: 0, borderRadius: 9, background: "#ff681f", color: "#fff", fontSize: 12, fontWeight: 950, boxShadow: "0 8px 18px rgba(255,104,31,0.18)" }}>{LABELS.printReceipt}</button>
                  <button type="button" onClick={closeReceiptWindow} style={{ minWidth: 72, minHeight: 38, border: "1px solid #d9e8f7", borderRadius: 9, background: "#fff", color: "#0f2745", fontSize: 12, fontWeight: 800 }}>{LABELS.closeWindow}</button>
                </div>
              </header>
              <div style={{ minHeight: 0, maxHeight: "calc(100dvh - 134px)", overflowY: "auto", scrollbarWidth: "none", border: "1px solid #d9e8f7", borderRadius: 10, background: "#fff", padding: 8 }}>
                <div style={{ display: "grid", justifyItems: "center", textAlign: "center", borderBottom: "1px dashed #c9dbf2", paddingBottom: 7 }}>
                  <ReceiptLogoImage src={receiptStoreProfile.logoUrl} alt={receiptStoreProfile.displayName || "CpIPOS"} />
                  <h3 style={{ margin: "4px 0 0", color: "#111827", fontSize: 15, fontWeight: 950 }}>{receiptStoreProfile.displayName || LABELS.storeName}</h3>
                  {receiptStoreProfile.companyAddress ? <p style={{ margin: "1px 0 0", color: "#334155", fontSize: 10, fontWeight: 700 }}>{receiptStoreProfile.companyAddress}</p> : null}
                  {receiptStoreProfile.contactPhone ? <p style={{ margin: "1px 0 0", color: "#334155", fontSize: 10, fontWeight: 700 }}>{receiptStoreProfile.contactPhone}</p> : null}
                  <p style={{ margin: "1px 0 0", color: "#334155", fontSize: 11, fontWeight: 800 }}>{receiptStoreProfile.branchName || LABELS.branchName}</p>
                </div>
                <div style={{ display: "grid", gap: 4, borderBottom: "1px dashed #c9dbf2", padding: "6px 0", fontSize: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}><span>{LABELS.seller} :</span><b>sst182536</b></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}><span>{LABELS.mode} :</span><b>{LABELS.takeaway}</b></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}><span>{LABELS.billNo} :</span><b>{receipt.orderNo}</b></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}><span>{LABELS.date} :</span><b>{new Date(receipt.paidAt).toLocaleString("th-TH")}</b></div>
                </div>
                <div style={{ borderBottom: "1px dashed #c9dbf2", padding: "6px 0" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 38px 68px", gap: 5, color: "#64748b", fontSize: 10, fontWeight: 800 }}>
                    <span>{LABELS.productList}</span><span style={{ textAlign: "right" }}>{LABELS.quantity}</span><span style={{ textAlign: "right" }}>{LABELS.lineTotal}</span>
                  </div>
                  {receipt.lines.map((line, index) => (
                    <div key={`${line.name}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr 38px 68px", gap: 5, marginTop: 6, color: "#111827", fontSize: 11 }}>
                      <div><b>{line.name}</b><br /><span style={{ color: "#64748b", fontSize: 10 }}>x {BAHT}{money(line.unitPrice)}</span></div>
                      <b style={{ textAlign: "right" }}>{line.quantity}</b>
                      <b style={{ textAlign: "right" }}>{BAHT}{money(line.lineTotal)}</b>
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gap: 5, paddingTop: 6, fontSize: 11 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto" }}><span>{LABELS.subtotal}</span><b>{BAHT}{money(receipt.subtotal)}</b></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto" }}><span>{LABELS.discount}</span><b>- {BAHT}{money(receipt.discount)}</b></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", fontSize: 13 }}><b>{LABELS.totalAfterDiscount}</b><b>{BAHT}{money(receipt.total)}</b></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto" }}><span>{receipt.paymentMethod === "cash" ? LABELS.cashReceived : LABELS.transfer}</span><b>{receipt.cashReceived === null ? LABELS.transfer : `${BAHT}${money(receipt.cashReceived)}`}</b></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto" }}><span>{LABELS.change}</span><b>{BAHT}{money(receipt.change)}</b></div>
                </div>
              </div>
              <footer style={{ minHeight: 1 }} />
            </section>
          ) : null}
        </div>
      ) : null}

      {holdSubmitting ? (
        <div role="alertdialog" aria-modal="true" aria-label="กำลังพักบิล" style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", background: "rgba(15,23,42,0.35)", backdropFilter: "blur(4px)", padding: 24 }}>
          <div style={{ display: "grid", justifyItems: "center", gap: 14, width: "min(360px, 100%)", borderRadius: 12, background: "#fff", padding: "28px 22px", color: "#0f2745", fontSize: 15, fontWeight: 900, boxShadow: "0 18px 48px rgba(15,39,69,0.22)" }}>
            <span style={{ width: 36, height: 36, border: "3px solid #d9e8f7", borderTopColor: "#f59e0b", borderRadius: 999, animation: "posSpin 0.8s linear infinite" }} />
            กำลังพักบิล...
          </div>
        </div>
      ) : null}

      {cancelSuccess ? (
        <div role="alertdialog" aria-modal="true" aria-label="ยกเลิกบิลสำเร็จ" style={{ position: "fixed", inset: 0, zIndex: 95, display: "grid", placeItems: "center", background: "rgba(15,39,69,0.35)", backdropFilter: "blur(4px)", padding: 24 }}>
          <div style={{ display: "grid", justifyItems: "center", gap: 12, width: "min(360px, 100%)", borderRadius: 18, background: "#fff", padding: "26px 22px", color: "#0f2745", textAlign: "center", boxShadow: "0 18px 48px rgba(15,39,69,0.22)" }}>
            <span style={{ display: "grid", width: 52, height: 52, placeItems: "center", borderRadius: 999, background: "#e8fff2", color: "#16a34a" }}>
              <CheckCircle2 size={30} />
            </span>
            <h2 style={{ margin: 0, color: "#0f2745", fontSize: 20, fontWeight: 950 }}>ยกเลิกบิลสำเร็จ</h2>
            <p style={{ margin: 0, color: "#587398", fontSize: 13, fontWeight: 800 }}>{cancelSuccess.orderNo}</p>
            <p style={{ margin: 0, color: "#587398", fontSize: 13, fontWeight: 800 }}>{cancelSuccess.message}</p>
          </div>
        </div>
      ) : null}

      {holdOpen ? (
        <div role="dialog" aria-modal="true" aria-label={LABELS.cancelBill} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,39,69,0.35)", padding: 16 }}>
          <section style={{ width: "min(92vw, 380px)", border: "1px solid #ffd7d7", borderRadius: 18, background: "#fff", padding: 14, boxShadow: "0 18px 48px rgba(15,39,69,0.22)" }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <h2 style={{ margin: 0, color: "#d62929", fontSize: 16, fontWeight: 900 }}>{LABELS.cancelBill}</h2>
              <button type="button" onClick={() => { if (!holdLoading) setHoldOpen(false); }} disabled={holdLoading} aria-label={LABELS.close} style={{ display: "flex", width: 34, height: 34, minHeight: 34, alignItems: "center", justifyContent: "center", border: "1px solid #ffd7d7", borderRadius: 999, background: "#fff", color: "#d62929", opacity: holdLoading ? 0.5 : 1 }}>
                <X size={17} />
              </button>
            </header>
            <p style={{ margin: "8px 0 0", color: "#7a8fa8", fontSize: 12, fontWeight: 700 }}>{activeOrderNo}</p>
            <label style={{ display: "grid", gap: 6, marginTop: 12, color: "#7a8fa8", fontSize: 11, fontWeight: 800 }}>
              {LABELS.enterPin}
              <input id="cancel-bill-pin" value={holdPin} onChange={(event) => handleCancelPinChange(event.target.value)} type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="one-time-code" style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
              <button type="button" onClick={() => document.getElementById("cancel-bill-pin")?.focus()} style={{ border: 0, background: "transparent", padding: 0, textAlign: "initial" }}>
                <PinDigits value={holdPin} />
              </button>
            </label>
            {holdError ? <p style={{ margin: "8px 0 0", color: "#d62929", fontSize: 12, fontWeight: 800 }}>{holdError}</p> : null}
            <button type="button" onClick={() => void cancelBill()} disabled={holdPin.length !== 6 || holdLoading} style={{ width: "100%", minHeight: 50, marginTop: 12, border: 0, borderRadius: 13, background: holdPin.length !== 6 || holdLoading ? "#f2a6a6" : "#d62929", color: "#fff", fontSize: 14, fontWeight: 900 }}>
              {holdLoading ? "กำลังยืนยันและลบบิล..." : holdPin.length === 6 ? "กำลังยืนยันอัตโนมัติ..." : LABELS.cancelBill}
            </button>
          </section>
        </div>
      ) : null}
    </section>
  );
}
