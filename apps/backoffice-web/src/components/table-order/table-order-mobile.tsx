"use client";

import { type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./table-order-mobile.module.css";

type MenuProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  stock_on_hand_units?: number | null;
  allow_negative_stock?: boolean;
  is_available?: boolean;
  is_low_stock?: boolean;
};

type SubmittedSummaryItem = {
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type MenuResponse = {
  data?: {
    store_name: string;
    branch_name: string;
    table_code: string;
    table_name: string | null;
    expires_at: string;
    categories?: string[];
    products?: MenuProduct[];
    can_order?: boolean;
    order_status?: string | null;
    bill_status?: string | null;
    has_submitted_food_order?: boolean;
    submitted_summary?: {
      item_count: number;
      total_amount: number;
      items: SubmittedSummaryItem[];
    };
  };
  error?: { code?: string; message?: string };
};

type SubmitResponse = {
  data?: {
    submission_id?: string;
    order_no?: string;
    table_code?: string;
    grand_total?: number;
    action?: "call_staff" | "request_checkout";
  };
  error?: { code?: string; message?: string };
};

type ServiceRequestAction = "call_staff" | "request_checkout";
type ToastMessage = { kind: "success" | "warning" | "error"; title: string; detail?: string };
type SubmitItem = { product_id: string; quantity: number };

const MENU_LOAD_TIMEOUT_MS = 45_000;
const SUBMIT_TIMEOUT_MS = 20_000;
const MENU_STATUS_POLL_MS = 5_000;
const ALL_CATEGORY = "ทั้งหมด";
const LINK_CLOSED_MESSAGE = "ลิงก์สั่งอาหารหมดอายุหรือปิดบิลแล้ว";
const LINK_PAID_DETAIL = "ถูกชำระเงินแล้ว";
const TABLE_ORDER_CLIENT_ID_STORAGE_PREFIX = "cpipos_table_order_client_id_v1:";

function money(value: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(value);
}

function productMark(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "M";
}

function productAvailable(product: MenuProduct) {
  if (product.allow_negative_stock === true) return true;
  if (product.is_available === false || product.is_low_stock === true) return false;
  const stock = product.stock_on_hand_units;
  if (stock === null || stock === undefined || !Number.isFinite(stock)) return true;
  return Math.floor(stock) > 0;
}

function productMaxQuantity(product: MenuProduct) {
  if (product.allow_negative_stock === true) return 99;
  const stock = product.stock_on_hand_units;
  if (stock === null || stock === undefined || !Number.isFinite(stock)) return 99;
  return Math.max(0, Math.min(99, Math.floor(stock)));
}

function publicOrderErrorMessage(response: Response, body: SubmitResponse | MenuResponse | null, fallback: string) {
  const code = body?.error?.code;
  const message = body?.error?.message?.trim();
  if (code === "table_order_not_available") return message || "โต๊ะนี้ไม่สามารถสั่งอาหารเพิ่มได้แล้ว กรุณาติดต่อพนักงาน";
  if (code === "product_unavailable" || code === "insufficient_stock") return message || "มีเมนูที่สต๊อกไม่เพียงพอ กรุณาโหลดเมนูใหม่";
  if (code === "invalid_payload" || code === "invalid_items" || code === "invalid_order_items") return message || "รายการอาหารไม่ถูกต้อง กรุณาตรวจสอบตะกร้าแล้วลองใหม่อีกครั้ง";
  if (code === "invalid_token" || code === "expired_token" || code === "qr_expired" || response.status === 401 || response.status === 403) return message || "ลิงก์ QR นี้หมดอายุหรือไม่สามารถใช้งานได้ กรุณาขอ QR ใหม่จากพนักงาน";
  if (response.status === 409) return message || "โต๊ะนี้ไม่พร้อมรับรายการเพิ่ม กรุณาติดต่อพนักงาน";
  if (response.status >= 500) return message || "ระบบสั่งอาหารขัดข้องชั่วคราว กรุณาลองใหม่หรือติดต่อพนักงาน";
  return message || fallback;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try { return (await response.json()) as T; } catch { return null; }
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, body: await readJson<T>(response) };
  } finally {
    window.clearTimeout(timeout);
  }
}

function buildRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getTableOrderClientId(token: string) {
  const fallback = `client_${buildRequestId().replace(/[^a-z0-9_-]/gi, "_")}`.slice(0, 80).toLowerCase();
  if (typeof window === "undefined") return fallback;
  const key = `${TABLE_ORDER_CLIENT_ID_STORAGE_PREFIX}${token.slice(0, 64)}`;
  const existing = window.localStorage.getItem(key);
  if (existing && /^[a-z0-9_-]{8,80}$/.test(existing)) return existing;
  window.localStorage.setItem(key, fallback);
  return fallback;
}

function buildSubmitItems(cartItems: Array<MenuProduct & { quantity: number }>): SubmitItem[] {
  return cartItems
    .map((item) => ({ product_id: String(item.id ?? "").trim(), quantity: Number(item.quantity) }))
    .filter((item) => item.product_id && Number.isFinite(item.quantity) && item.quantity > 0)
    .map((item) => ({ product_id: item.product_id, quantity: Math.max(1, Math.min(99, Math.trunc(item.quantity))) }));
}

function hasExistingSubmittedFoodOrder(menu: MenuResponse["data"] | null) {
  if (!menu) return false;
  if (menu.has_submitted_food_order) return true;
  return ["queued", "preparing", "completed", "served"].includes(String(menu.order_status ?? "").toLowerCase());
}

function isClosedMenu(menu: MenuResponse["data"] | null) {
  if (!menu) return false;
  const bill = String(menu.bill_status ?? "").toLowerCase();
  const order = String(menu.order_status ?? "").toLowerCase();
  return ["paid", "closed", "cleared", "cancelled"].includes(bill) || ["paid", "closed", "cleared", "cancelled"].includes(order);
}

function isClosedOrderResponse(response: Response, body: MenuResponse | SubmitResponse | null) {
  const code = body?.error?.code;
  return code === "table_order_link_expired" || code === "table_order_not_available" || code === "expired_token" || code === "qr_expired" || response.status === 410;
}

export function TableOrderMobile({ token }: { token: string }) {
  const [menu, setMenu] = useState<MenuResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORY);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serviceSubmitting, setServiceSubmitting] = useState<ServiceRequestAction | null>(null);
  const [successOrderNo, setSuccessOrderNo] = useState<string | null>(null);
  const [hasSubmittedFoodOrder, setHasSubmittedFoodOrder] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [linkClosed, setLinkClosed] = useState(false);
  const categoriesRef = useRef<HTMLElement | null>(null);
  const linkClosedToastShownRef = useRef(false);
  const clientIdRef = useRef<string | null>(null);
  const apiUrl = useMemo(() => `/api/table-order/${encodeURIComponent(token)}`, [token]);
  const statusUrl = useMemo(() => `${apiUrl}?view=status`, [apiUrl]);

  useEffect(() => { clientIdRef.current = getTableOrderClientId(token); }, [token]);

  const tableOrderHeaders = useCallback((headers?: HeadersInit): HeadersInit => ({
    ...(headers ?? {}),
    "x-table-order-client-id": clientIdRef.current ?? "anonymous"
  }), []);

  const showLinkClosedPopup = useCallback((detail = LINK_PAID_DETAIL) => {
    setLinkClosed(true);
    setCart({});
    setCartOpen(false);
    setError(null);
    if (linkClosedToastShownRef.current) return;
    linkClosedToastShownRef.current = true;
    setToast({ kind: "error", title: LINK_CLOSED_MESSAGE, detail });
  }, []);

  const applyMenuData = useCallback((nextMenu: NonNullable<MenuResponse["data"]>) => {
    setMenu(nextMenu);
    setHasSubmittedFoodOrder(hasExistingSubmittedFoodOrder(nextMenu));
    setError(null);
    if (isClosedMenu(nextMenu)) {
      showLinkClosedPopup(LINK_PAID_DETAIL);
      return;
    }
    setLinkClosed(false);
    linkClosedToastShownRef.current = false;
  }, [showLinkClosedPopup]);

  const applyStatusData = useCallback((nextState: NonNullable<MenuResponse["data"]>) => {
    setMenu((current) => {
      const merged = current ? { ...current, ...nextState, categories: current.categories ?? [], products: current.products ?? [] } : nextState;
      setHasSubmittedFoodOrder(hasExistingSubmittedFoodOrder(merged));
      if (isClosedMenu(merged)) showLinkClosedPopup(LINK_PAID_DETAIL);
      else {
        setError(null);
        setLinkClosed(false);
        linkClosedToastShownRef.current = false;
      }
      return merged;
    });
  }, [showLinkClosedPopup]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), MENU_LOAD_TIMEOUT_MS);
    setLoading(true);
    setError(null);
    setLinkClosed(false);
    linkClosedToastShownRef.current = false;
    void fetch(apiUrl, { cache: "no-store", headers: tableOrderHeaders(), signal: controller.signal })
      .then(async (response) => {
        const body = (await readJson<MenuResponse>(response)) ?? {};
        if (!response.ok || !body.data) {
          if (isClosedOrderResponse(response, body)) showLinkClosedPopup();
          throw new Error(publicOrderErrorMessage(response, body, "ไม่สามารถโหลดเมนูได้"));
        }
        applyMenuData(body.data);
      })
      .catch((loadError) => {
        if ((loadError as { name?: string }).name === "AbortError") setError("โหลดเมนูไม่สำเร็จ ระบบใช้เวลานานเกินไป กรุณาสแกน QR ใหม่");
        else setError(loadError instanceof Error ? loadError.message : "ไม่สามารถโหลดเมนูได้");
      })
      .finally(() => { window.clearTimeout(timeout); setLoading(false); });
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [apiUrl, applyMenuData, showLinkClosedPopup, tableOrderHeaders]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!menu || linkClosed) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight || document.visibilityState === "hidden" || submitting || serviceSubmitting) return;
      inFlight = true;
      try {
        const result = await fetchJsonWithTimeout<MenuResponse>(statusUrl, { cache: "no-store", headers: tableOrderHeaders() }, MENU_LOAD_TIMEOUT_MS);
        if (!cancelled && result.response.ok && result.body?.data) applyStatusData(result.body.data);
        else if (!cancelled && isClosedOrderResponse(result.response, result.body)) showLinkClosedPopup();
      } catch (refreshError) {
        if ((refreshError as { name?: string }).name !== "AbortError") console.warn("[table-order-mobile] refresh failed", refreshError);
      } finally { inFlight = false; }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(() => void refresh(), MENU_STATUS_POLL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applyStatusData, linkClosed, menu, serviceSubmitting, showLinkClosedPopup, statusUrl, submitting, tableOrderHeaders]);

  const canOrder = menu?.can_order !== false && !linkClosed;
  const orderingLocked = menu?.can_order === false && !linkClosed;
  const submittedItems = useMemo(() => menu?.submitted_summary?.items ?? [], [menu?.submitted_summary?.items]);
  const categoryOptions = useMemo(() => [ALL_CATEGORY, ...Array.from(new Set((menu?.categories ?? []).map((value) => String(value).trim()).filter(Boolean)))], [menu?.categories]);

  useEffect(() => {
    if (menu && !categoryOptions.includes(activeCategory)) setActiveCategory(ALL_CATEGORY);
  }, [activeCategory, categoryOptions, menu]);

  const selectCategory = useCallback((category: string, button?: HTMLButtonElement | null) => {
    setActiveCategory(category);
    button?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, []);

  const handleCategoryWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    const container = categoriesRef.current;
    if (!container || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    container.scrollLeft += event.deltaY;
  }, []);

  const filteredProducts = useMemo(() => {
    const text = search.trim().toLowerCase();
    return (menu?.products ?? []).filter((product) =>
      (activeCategory === ALL_CATEGORY || product.category === activeCategory) && (!text || product.name.toLowerCase().includes(text))
    );
  }, [activeCategory, menu?.products, search]);

  const catalog = useMemo(() => new Map((menu?.products ?? []).map((product) => [product.id, product])), [menu?.products]);
  const cartItems = useMemo(() => Object.entries(cart).flatMap(([productId, quantity]) => {
    const product = catalog.get(productId);
    return product && quantity > 0 ? [{ ...product, quantity }] : [];
  }), [cart, catalog]);

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cartItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const canRequestCheckout = hasSubmittedFoodOrder || Boolean(successOrderNo) || hasExistingSubmittedFoodOrder(menu);

  function changeQuantity(productId: string, delta: number) {
    if (submitting || serviceSubmitting || !canOrder) return;
    const product = catalog.get(productId);
    if (!product) return;
    if (delta > 0 && !productAvailable(product)) {
      setToast({ kind: "warning", title: "เมนูนี้สต๊อกไม่เพียงพอ", detail: product.name });
      return;
    }
    setCart((current) => {
      const maximum = productMaxQuantity(product);
      const nextQuantity = Math.max(0, Math.min(maximum, (current[productId] ?? 0) + delta));
      const next = { ...current };
      if (nextQuantity === 0) delete next[productId];
      else next[productId] = nextQuantity;
      return next;
    });
  }

  function removeItem(productId: string) {
    if (submitting || serviceSubmitting) return;
    setCart((current) => { const next = { ...current }; delete next[productId]; return next; });
  }

  const submitPost = useCallback((payload: unknown, requestId: string) => fetchJsonWithTimeout<SubmitResponse>(apiUrl, {
    method: "POST",
    headers: tableOrderHeaders({ "Content-Type": "application/json", "x-idempotency-key": requestId }),
    body: JSON.stringify(payload)
  }, SUBMIT_TIMEOUT_MS), [apiUrl, tableOrderHeaders]);

  async function submitOrder() {
    if (!menu || submitting || serviceSubmitting || cartItems.length === 0) return;
    if (!canOrder) return showLinkClosedPopup();
    const unavailable = cartItems.find((item) => !productAvailable(item) || item.quantity > productMaxQuantity(item));
    if (unavailable) {
      setToast({ kind: "warning", title: "สต๊อกเมนูเปลี่ยนแปลง", detail: `${unavailable.name} กรุณาเลือกใหม่` });
      return;
    }
    const items = buildSubmitItems(cartItems);
    if (!items.length) return setError("กรุณาเลือกจำนวนอาหารอย่างน้อย 1 รายการ");
    setSubmitting(true);
    setError(null);
    setToast(null);
    const requestId = buildRequestId();
    try {
      const { response, body } = await submitPost({ action: "order", request_id: requestId, note: null, items }, requestId);
      if (!response.ok || !body?.data) {
        if (isClosedOrderResponse(response, body)) return showLinkClosedPopup();
        throw new Error(publicOrderErrorMessage(response, body, "ไม่สามารถส่งรายการได้ กรุณาลองใหม่หรือติดต่อพนักงาน"));
      }
      const orderNo = body.data.order_no ?? "-";
      setSuccessOrderNo(orderNo);
      setHasSubmittedFoodOrder(true);
      setCart({});
      setCartOpen(false);
      setToast({ kind: "success", title: "ส่งรายการเข้าครัวแล้ว", detail: `เลขบิล ${orderNo} · หากต้องการแก้ไขรายการที่ส่งแล้ว กรุณาเรียกพนักงาน` });
      const refreshed = await fetchJsonWithTimeout<MenuResponse>(statusUrl, { cache: "no-store", headers: tableOrderHeaders() }, MENU_LOAD_TIMEOUT_MS).catch(() => null);
      if (refreshed?.response.ok && refreshed.body?.data) applyStatusData(refreshed.body.data);
    } catch (submitError) {
      if ((submitError as { name?: string }).name === "AbortError") setError("ส่งรายการไม่สำเร็จ เนื่องจากระบบใช้เวลานานเกินไป กรุณาลองใหม่");
      else setError(submitError instanceof Error ? submitError.message : "ส่งรายการไม่สำเร็จ");
    } finally { setSubmitting(false); }
  }

  async function submitServiceRequest(action: ServiceRequestAction) {
    if (!menu || submitting || serviceSubmitting) return;
    if (action === "request_checkout" && !canRequestCheckout) {
      setToast({ kind: "warning", title: "กรุณาส่งรายการอาหารก่อน", detail: "เมื่อส่งอาหารแล้วจึงแจ้งชำระบิลได้" });
      return;
    }
    setServiceSubmitting(action);
    setError(null);
    setToast(null);
    const requestId = buildRequestId();
    try {
      const { response, body } = await submitPost({ action, request_id: requestId, note: null }, requestId);
      if (!response.ok || !body?.data) {
        if (isClosedOrderResponse(response, body)) return showLinkClosedPopup();
        throw new Error(publicOrderErrorMessage(response, body, "ส่งคำขอไม่สำเร็จ"));
      }
      setToast({ kind: "success", title: action === "call_staff" ? "เรียกพนักงานแล้ว กรุณารอสักครู่" : "แจ้งต้องการชำระบิลแล้ว", detail: `โต๊ะ ${menu.table_code}` });
    } catch (submitError) {
      if ((submitError as { name?: string }).name === "AbortError") setError("ส่งคำขอไม่สำเร็จ ระบบใช้เวลานานเกินไป");
      else setError(submitError instanceof Error ? submitError.message : "ส่งคำขอไม่สำเร็จ");
    } finally { setServiceSubmitting(null); }
  }

  if (loading) return <main className={styles.statePage}><span className={styles.spinner} /><p>กำลังเปิดเมนูของโต๊ะ...</p></main>;
  if (!menu) return <main className={styles.statePage}>{toast ? <div className={`${styles.toast} ${styles[`toast${toast.kind}`]}`}><strong>{toast.title}</strong>{toast.detail ? <span>{toast.detail}</span> : null}</div> : null}<strong>ไม่สามารถสั่งอาหารผ่านลิงก์นี้ได้</strong>{!linkClosed ? <p>{error || "QR อาจหมดอายุหรือโต๊ะปิดบิลแล้ว กรุณาติดต่อพนักงาน"}</p> : null}</main>;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div><p className={styles.brand}>{menu.store_name}</p><h1>สั่งอาหารที่โต๊ะ {menu.table_code}</h1><p>{menu.branch_name}{menu.table_name ? ` · ${menu.table_name}` : ""}</p></div>
        <span className={styles.tableBadge}>{menu.table_code}</span>
      </header>

      <section className={styles.controls}>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาเมนู" aria-label="ค้นหาเมนูอาหาร" />
        <nav ref={categoriesRef} className={styles.categories} aria-label="ประเภทอาหาร" onWheel={handleCategoryWheel}>
          {categoryOptions.map((category) => <button key={category} type="button" className={activeCategory === category ? styles.activeCategory : ""} aria-pressed={activeCategory === category} onClick={(event) => selectCategory(category, event.currentTarget)}>{category}</button>)}
        </nav>
      </section>

      {orderingLocked ? <div className={styles.lockedNotice}><strong>โต๊ะนี้กำลังชำระเงิน</strong><span>ระบบล็อกการสั่งเพิ่มแล้ว กรุณาติดต่อพนักงาน</span></div> : null}
      {submittedItems.length > 0 ? (
        <section className={styles.submittedSummary} aria-label="รายการที่ส่งแล้ว">
          <div className={styles.submittedSummaryHead}><div><strong>รายการที่ส่งแล้ว</strong><span> {menu.submitted_summary?.item_count ?? 0} รายการ</span></div><strong>{money(menu.submitted_summary?.total_amount ?? 0)}</strong></div>
          <div className={styles.submittedRows}>{submittedItems.map((item, index) => <div className={styles.submittedRow} key={`${item.product_id}-${index}`}><span>{item.name} × {item.quantity}</span><strong>{money(item.line_total)}</strong></div>)}</div>
          <p className={styles.submittedLockedNote}>รายการที่ยืนยันแล้วแก้ไขหรือลบจากมือถือไม่ได้ หากต้องการแก้ไขกรุณาเรียกพนักงาน</p>
        </section>
      ) : null}
      {error && !linkClosed ? <div className={styles.alert}>{error}</div> : null}
      {toast ? <div className={`${styles.toast} ${styles[`toast${toast.kind}`]}`} role="status"><strong>{toast.title}</strong>{toast.detail ? <span>{toast.detail}</span> : null}</div> : null}

      <section className={styles.menuGrid} aria-label="รายการอาหาร">
        {filteredProducts.map((product, index) => {
          const quantity = cart[product.id] ?? 0;
          const available = productAvailable(product);
          return <article className={`${styles.productCard} ${!available ? styles.productCardUnavailable : ""}`} key={product.id}>
            <button type="button" className={styles.productPickButton} onClick={() => changeQuantity(product.id, 1)} disabled={submitting || Boolean(serviceSubmitting) || !canOrder || !available} aria-label={available ? `เพิ่ม ${product.name} ลงตะกร้า` : `${product.name} สต๊อกไม่เพียงพอ`}>
              <div className={`${styles.productVisual} ${styles[`tone${index % 5}`]}`}><span>{productMark(product.name)}</span></div>
              <div className={styles.productBody}><p className={styles.productCategory}>{product.category}</p><h2>{product.name}</h2><strong>{money(product.price)}</strong>{!available ? <small className={styles.stockNotice}>สต๊อกไม่เพียงพอ</small> : null}</div>
            </button>
            <div className={styles.productActions}><div className={styles.stepper}>
              <button type="button" onClick={() => changeQuantity(product.id, -1)} disabled={quantity === 0 || submitting || Boolean(serviceSubmitting)}>−</button>
              <span>{quantity}</span>
              <button type="button" onClick={() => changeQuantity(product.id, 1)} disabled={submitting || Boolean(serviceSubmitting) || !canOrder || !available || quantity >= productMaxQuantity(product)}>+</button>
            </div></div>
          </article>;
        })}
      </section>
      {filteredProducts.length === 0 ? <p className={styles.empty}>ไม่พบเมนูที่ค้นหา</p> : null}

      <section className={styles.cartSheet} aria-label="ตะกร้าสั่งอาหาร">
        <div className={styles.cartSummary}><span>{cartCount} รายการในตะกร้า</span><strong>ยอดชำระ {money(cartTotal)}</strong></div>
        <div className={styles.serviceActions}>
          <button type="button" onClick={() => void submitServiceRequest("call_staff")} disabled={submitting || Boolean(serviceSubmitting) || !canOrder}>{serviceSubmitting === "call_staff" ? "กำลังเรียก..." : "เรียกพนักงาน"}</button>
          <button type="button" onClick={() => void submitServiceRequest("request_checkout")} disabled={submitting || Boolean(serviceSubmitting) || !canOrder || !canRequestCheckout}>{serviceSubmitting === "request_checkout" ? "กำลังแจ้ง..." : "ต้องการชำระบิล"}</button>
        </div>
        <button type="button" className={styles.cartOpenButton} onClick={() => setCartOpen(true)} disabled={cartCount === 0 || submitting || Boolean(serviceSubmitting)}>ดูรายการตะกร้า ({cartCount})</button>
      </section>

      {cartOpen ? <div className={styles.cartModalBackdrop} role="presentation" onMouseDown={() => setCartOpen(false)}><section className={styles.cartModal} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.cartModalHead}><div><strong>รายการก่อนส่งเข้าครัว</strong><span>{cartCount} รายการ</span></div><button type="button" onClick={() => setCartOpen(false)}>×</button></header>
        <div className={styles.cartRows}>{cartItems.map((item) => <article className={styles.cartRow} key={item.id}><div className={styles.cartRowMeta}><strong>{item.name}</strong><span>{money(item.price * item.quantity)}</span></div><div className={styles.cartRowControls}><div className={styles.stepper}><button type="button" onClick={() => changeQuantity(item.id, -1)}>−</button><span>{item.quantity}</span><button type="button" onClick={() => changeQuantity(item.id, 1)} disabled={!productAvailable(item) || item.quantity >= productMaxQuantity(item)}>+</button></div><button type="button" className={styles.deleteItemButton} onClick={() => removeItem(item.id)}>ลบ</button></div></article>)}</div>
        <footer className={styles.cartModalFooter}><span>ยอดชำระ</span><strong>{money(cartTotal)}</strong><button type="button" className={styles.submitButton} onClick={() => void submitOrder()} disabled={submitting || cartCount === 0 || !canOrder}>{submitting ? "กำลังส่งรายการ..." : "ยืนยันสั่งอาหาร"}</button><button type="button" className={styles.keepShoppingButton} onClick={() => setCartOpen(false)} disabled={submitting}>เลือกเมนูต่อ</button></footer>
      </section></div> : null}

      {submitting ? <div className={styles.processing}><div><span className={styles.spinner} /><strong>กำลังส่งรายการเข้าระบบ POS</strong><p>กรุณาอย่าปิดหน้านี้</p></div></div> : null}
      {serviceSubmitting ? <div className={styles.processing}><div><span className={styles.spinner} /><strong>{serviceSubmitting === "call_staff" ? "กำลังเรียกพนักงาน" : "กำลังแจ้งต้องการชำระบิล"}</strong><p>กรุณารอสักครู่</p></div></div> : null}
    </main>
  );
}
