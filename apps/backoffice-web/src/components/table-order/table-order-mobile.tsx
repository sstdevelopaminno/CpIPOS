"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./table-order-mobile.module.css";

type MenuProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
};

type MenuResponse = {
  data?: {
    store_name: string;
    branch_name: string;
    table_code: string;
    table_name: string | null;
    expires_at: string;
    categories: string[];
    products: MenuProduct[];
    can_order?: boolean;
    order_status?: string | null;
    bill_status?: string | null;
    has_submitted_food_order?: boolean;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

type SubmitResponse = {
  data?: {
    submission_id?: string;
    order_no?: string;
    table_code?: string;
    grand_total?: number;
    action?: "call_staff" | "request_checkout";
  };
  error?: {
    code?: string;
    message?: string;
  };
};

type ServiceRequestAction = "call_staff" | "request_checkout";

type ToastMessage = {
  kind: "success" | "warning" | "error";
  title: string;
  detail?: string;
};

type SubmitItem = {
  product_id: string;
  quantity: number;
};

const MENU_LOAD_TIMEOUT_MS = 45000;
const SUBMIT_TIMEOUT_MS = 20000;

function money(value: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(value);
}

function productMark(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "M";
}

function publicOrderErrorMessage(response: Response, body: SubmitResponse | MenuResponse | null, fallback: string) {
  const code = body?.error?.code;
  const message = body?.error?.message?.trim();

  if (code === "table_order_not_available") {
    return message || "โต๊ะนี้ไม่สามารถสั่งอาหารเพิ่มได้แล้ว อาจกำลังรอชำระเงินหรือปิดบิลแล้ว กรุณาติดต่อพนักงาน";
  }

  if (code === "invalid_payload" || code === "invalid_items" || code === "invalid_order_items") {
    return message || "รายการอาหารไม่ถูกต้อง กรุณาตรวจสอบตะกร้าแล้วลองใหม่อีกครั้ง";
  }

  if (code === "invalid_token" || code === "expired_token" || code === "qr_expired" || response.status === 401 || response.status === 403) {
    return message || "ลิงก์ QR นี้หมดอายุหรือไม่สามารถใช้งานได้ กรุณาขอ QR ใหม่จากพนักงาน";
  }

  if (response.status === 409) {
    return message || "โต๊ะนี้ไม่พร้อมรับรายการเพิ่ม กรุณาติดต่อพนักงาน";
  }

  if (response.status >= 500) {
    return message || "ระบบสั่งอาหารขัดข้องชั่วคราว กรุณาลองใหม่หรือติดต่อพนักงาน";
  }

  return message || fallback;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ response: Response; body: T | null }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const body = await readJson<T>(response);
    return { response, body };
  } finally {
    window.clearTimeout(timeout);
  }
}

function buildRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildSubmitItems(cartItems: Array<MenuProduct & { quantity: number }>): SubmitItem[] {
  return cartItems
    .map((item) => ({
      product_id: String(item.id ?? "").trim(),
      quantity: Number(item.quantity)
    }))
    .filter((item) => item.product_id && Number.isFinite(item.quantity) && item.quantity > 0)
    .map((item) => ({
      product_id: item.product_id,
      quantity: Math.max(1, Math.min(99, Math.trunc(item.quantity)))
    }));
}

function hasExistingSubmittedFoodOrder(menu: MenuResponse["data"] | null) {
  if (!menu) return false;
  if (menu.has_submitted_food_order) return true;
  const orderStatus = String(menu.order_status ?? "").toLowerCase();
  return ["queued", "preparing", "completed", "served"].includes(orderStatus);
}

export function TableOrderMobile({ token }: { token: string }) {
  const [menu, setMenu] = useState<MenuResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("ทั้งหมด");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serviceSubmitting, setServiceSubmitting] = useState<ServiceRequestAction | null>(null);
  const [successOrderNo, setSuccessOrderNo] = useState<string | null>(null);
  const [hasSubmittedFoodOrder, setHasSubmittedFoodOrder] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const apiUrl = useMemo(() => `/api/table-order/${encodeURIComponent(token)}`, [token]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), MENU_LOAD_TIMEOUT_MS);

    setLoading(true);
    setError(null);

    void fetch(apiUrl, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        const body = (await readJson<MenuResponse>(response)) ?? {};
        if (!response.ok || !body.data) {
          console.error("[table-order-mobile] menu load failed", {
            status: response.status,
            code: body.error?.code,
            message: body.error?.message
          });
          throw new Error(publicOrderErrorMessage(response, body, "ไม่สามารถโหลดเมนูได้"));
        }
        setMenu(body.data);
        setHasSubmittedFoodOrder(hasExistingSubmittedFoodOrder(body.data));
        setError(null);
      })
      .catch((loadError) => {
        if ((loadError as { name?: string }).name === "AbortError") {
          setError("โหลดเมนูไม่สำเร็จ เนื่องจากระบบใช้เวลานานเกินไป กรุณาสแกน QR ใหม่หรือติดต่อพนักงาน");
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "ไม่สามารถโหลดเมนูได้");
      })
      .finally(() => {
        window.clearTimeout(timeout);
        setLoading(false);
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [apiUrl]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const canOrder = menu?.can_order !== false;

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (menu?.products ?? []).filter((product) => {
      const matchesCategory = activeCategory === "ทั้งหมด" || product.category === activeCategory;
      const matchesSearch = !normalizedSearch || product.name.toLowerCase().includes(normalizedSearch);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, menu?.products, search]);

  const cartItems = useMemo(
    () =>
      (menu?.products ?? [])
        .map((product) => ({ ...product, quantity: cart[product.id] ?? 0 }))
        .filter((product) => product.quantity > 0),
    [cart, menu?.products]
  );

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cartItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const canRequestCheckout = hasSubmittedFoodOrder || Boolean(successOrderNo) || hasExistingSubmittedFoodOrder(menu);

  function changeQuantity(productId: string, delta: number) {
    if (submitting || serviceSubmitting || !canOrder) return;
    setCart((current) => {
      const nextQuantity = Math.max(0, Math.min(99, (current[productId] ?? 0) + delta));
      const next = { ...current };
      if (nextQuantity === 0) delete next[productId];
      else next[productId] = nextQuantity;
      return next;
    });
  }

  function removeItem(productId: string) {
    if (submitting || serviceSubmitting) return;
    setCart((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
  }

  const submitPost = useCallback(
    async (payload: unknown, requestId: string) =>
      fetchJsonWithTimeout<SubmitResponse>(
        apiUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-idempotency-key": requestId
          },
          body: JSON.stringify(payload)
        },
        SUBMIT_TIMEOUT_MS
      ),
    [apiUrl]
  );

  async function submitOrder() {
    if (!menu || cartItems.length === 0 || submitting || serviceSubmitting) return;

    if (!canOrder) {
      setError("โต๊ะนี้ไม่สามารถสั่งอาหารเพิ่มได้แล้ว อาจกำลังรอชำระเงินหรือปิดบิลแล้ว กรุณาติดต่อพนักงาน");
      return;
    }

    const items = buildSubmitItems(cartItems);
    if (!items.length) {
      setError("กรุณาเลือกจำนวนอาหารอย่างน้อย 1 รายการ");
      return;
    }

    setSubmitting(true);
    setError(null);
    setToast(null);

    const requestId = buildRequestId();

    try {
      const primaryPayload = {
        request_id: requestId,
        items
      };

      let { response, body } = await submitPost(primaryPayload, requestId);

      if (!response.ok || !body?.data) {
        const shouldRetryWithAction =
          response.status === 400 &&
          (body?.error?.code === "invalid_action" ||
            body?.error?.code === "invalid_payload" ||
            String(body?.error?.message ?? "").toLowerCase().includes("action"));

        if (shouldRetryWithAction) {
          const retry = await submitPost(
            {
              action: "order",
              request_id: requestId,
              note: null,
              items
            },
            requestId
          );
          response = retry.response;
          body = retry.body;
        }
      }

      if (!response.ok || !body?.data) {
        console.error("[table-order-mobile] submit order failed", {
          status: response.status,
          code: body?.error?.code,
          message: body?.error?.message,
          itemCount: items.length,
          requestId
        });

        throw new Error(publicOrderErrorMessage(response, body, "ไม่สามารถส่งรายการได้ กรุณาลองใหม่หรือติดต่อพนักงาน"));
      }

      const orderNo = body.data.order_no ?? "-";
      setSuccessOrderNo(orderNo);
      setHasSubmittedFoodOrder(true);
      setToast({
        kind: "success",
        title: "ส่งรายการเข้าครัวแล้ว",
        detail: `เลขบิล ${orderNo}`
      });
      setCart({});
      setCartOpen(false);
    } catch (submitError) {
      if ((submitError as { name?: string }).name === "AbortError") {
        setError("ส่งรายการไม่สำเร็จ เนื่องจากระบบใช้เวลานานเกินไป กรุณาลองใหม่หรือติดต่อพนักงาน");
      } else {
        setError(submitError instanceof Error ? submitError.message : "ส่งรายการไม่สำเร็จ");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitServiceRequest(action: ServiceRequestAction) {
    if (!menu || submitting || serviceSubmitting) return;
    if (action === "request_checkout" && !canRequestCheckout) {
      setToast({
        kind: "warning",
        title: "กรุณาส่งรายการอาหารก่อน",
        detail: "เมื่อส่งอาหารเข้าครัวแล้วจึงแจ้งชำระบิลได้"
      });
      return;
    }

    setServiceSubmitting(action);
    setError(null);
    setToast(null);

    const requestId = buildRequestId();

    try {
      let { response, body } = await submitPost(
        {
          action,
          request_id: requestId,
          note: null
        },
        requestId
      );

      if (!response.ok || !body?.data) {
        const shouldRetryWithEventType =
          response.status === 400 &&
          (body?.error?.code === "invalid_action" ||
            body?.error?.code === "invalid_payload" ||
            String(body?.error?.message ?? "").toLowerCase().includes("event"));

        if (shouldRetryWithEventType) {
          const retry = await submitPost(
            {
              event_type: action,
              request_id: requestId,
              note: null
            },
            requestId
          );
          response = retry.response;
          body = retry.body;
        }
      }

      if (!response.ok || !body?.data) {
        console.error("[table-order-mobile] service request failed", {
          status: response.status,
          code: body?.error?.code,
          message: body?.error?.message,
          action,
          requestId
        });

        throw new Error(publicOrderErrorMessage(response, body, "ส่งคำขอไม่สำเร็จ"));
      }

      const nextMessage = action === "call_staff" ? "เรียกพนักงานแล้ว กรุณารอสักครู่" : "แจ้งต้องการชำระบิลแล้ว";
      setToast({
        kind: "success",
        title: nextMessage,
        detail: `โต๊ะ ${menu.table_code}`
      });
    } catch (submitError) {
      if ((submitError as { name?: string }).name === "AbortError") {
        setError("ส่งคำขอไม่สำเร็จ เนื่องจากระบบใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง");
      } else {
        setError(submitError instanceof Error ? submitError.message : "ส่งคำขอไม่สำเร็จ");
      }
    } finally {
      setServiceSubmitting(null);
    }
  }

  if (loading) {
    return (
      <main className={styles.statePage}>
        <span className={styles.spinner} />
        <p>กำลังเปิดเมนูของโต๊ะ...</p>
      </main>
    );
  }

  if (!menu) {
    return (
      <main className={styles.statePage}>
        <strong>ไม่สามารถสั่งอาหารผ่านลิงก์นี้ได้</strong>
        <p>{error || "QR อาจหมดอายุหรือโต๊ะปิดบิลแล้ว กรุณาติดต่อพนักงาน"}</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.brand}>{menu.store_name}</p>
          <h1>สั่งอาหารที่โต๊ะ {menu.table_code}</h1>
          <p>
            {menu.branch_name}
            {menu.table_name ? ` · ${menu.table_name}` : ""}
          </p>
        </div>
        <span className={styles.tableBadge}>{menu.table_code}</span>
      </header>

      <section className={styles.controls}>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ค้นหาเมนู"
          aria-label="ค้นหาเมนูอาหาร"
        />
        <nav className={styles.categories} aria-label="ประเภทอาหาร">
          {["ทั้งหมด", ...menu.categories].map((category) => (
            <button
              key={category}
              type="button"
              className={activeCategory === category ? styles.activeCategory : ""}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </nav>
      </section>

      {!canOrder ? (
        <div className={styles.alert}>
          โต๊ะนี้ไม่สามารถสั่งอาหารเพิ่มได้แล้ว อาจกำลังรอชำระเงินหรือปิดบิลแล้ว กรุณาติดต่อพนักงาน
        </div>
      ) : null}
      {error ? <div className={styles.alert}>{error}</div> : null}
      {toast ? (
        <div className={`${styles.toast} ${styles[`toast${toast.kind}`]}`} role="status" aria-live="polite">
          <strong>{toast.title}</strong>
          {toast.detail ? <span>{toast.detail}</span> : null}
        </div>
      ) : null}

      <section className={styles.menuGrid} aria-label="รายการอาหาร">
        {filteredProducts.map((product, index) => {
          const quantity = cart[product.id] ?? 0;
          return (
            <article className={styles.productCard} key={product.id}>
              <button
                type="button"
                className={styles.productPickButton}
                onClick={() => changeQuantity(product.id, 1)}
                disabled={submitting || Boolean(serviceSubmitting) || !canOrder}
                aria-label={`เพิ่ม ${product.name} ลงตะกร้า`}
              >
                <div className={`${styles.productVisual} ${styles[`tone${index % 5}`]}`}>
                  <span>{productMark(product.name)}</span>
                </div>
                <div className={styles.productBody}>
                  <p className={styles.productCategory}>{product.category}</p>
                  <h2>{product.name}</h2>
                  <strong>{money(product.price)}</strong>
                </div>
              </button>
              <div className={styles.productActions}>
                <div className={styles.stepper}>
                  <button type="button" aria-label={`ลดจำนวน ${product.name}`} onClick={() => changeQuantity(product.id, -1)} disabled={quantity === 0 || submitting || Boolean(serviceSubmitting)}>
                    −
                  </button>
                  <span>{quantity}</span>
                  <button type="button" aria-label={`เพิ่มจำนวน ${product.name}`} onClick={() => changeQuantity(product.id, 1)} disabled={submitting || Boolean(serviceSubmitting) || !canOrder}>
                    +
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {filteredProducts.length === 0 ? <p className={styles.empty}>ไม่พบเมนูที่ค้นหา</p> : null}

      <section className={styles.cartSheet} aria-label="ตะกร้าสั่งอาหาร">
        <div className={styles.cartSummary}>
          <span>{cartCount} รายการในตะกร้า</span>
          <strong>ยอดชำระ {money(cartTotal)}</strong>
        </div>
        <div className={styles.serviceActions}>
          <button type="button" onClick={() => void submitServiceRequest("call_staff")} disabled={submitting || Boolean(serviceSubmitting)}>
            {serviceSubmitting === "call_staff" ? "กำลังเรียก..." : "เรียกพนักงาน"}
          </button>
          <button type="button" onClick={() => void submitServiceRequest("request_checkout")} disabled={submitting || Boolean(serviceSubmitting) || !canRequestCheckout}>
            {serviceSubmitting === "request_checkout" ? "กำลังแจ้ง..." : "ต้องการชำระบิล"}
          </button>
        </div>
        <button
          type="button"
          className={styles.cartOpenButton}
          onClick={() => setCartOpen(true)}
          disabled={cartCount === 0 || submitting || Boolean(serviceSubmitting)}
        >
          ดูรายการตะกร้า ({cartCount})
        </button>
      </section>

      {cartOpen ? (
        <div className={styles.cartModalBackdrop} role="presentation" onMouseDown={() => setCartOpen(false)}>
          <section
            className={styles.cartModal}
            role="dialog"
            aria-modal="true"
            aria-label="รายการในตะกร้า"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className={styles.cartModalHead}>
              <div>
                <strong>รายการในตะกร้า</strong>
                <span>{cartCount} รายการ</span>
              </div>
              <button type="button" onClick={() => setCartOpen(false)} aria-label="ปิดรายการตะกร้า">
                ×
              </button>
            </header>
            <div className={styles.cartRows}>
              {cartItems.map((item) => (
                <article className={styles.cartRow} key={item.id}>
                  <div className={styles.cartRowMeta}>
                    <strong>{item.name}</strong>
                    <span>{money(item.price * item.quantity)}</span>
                  </div>
                  <div className={styles.cartRowControls}>
                    <div className={styles.stepper}>
                      <button type="button" onClick={() => changeQuantity(item.id, -1)} aria-label={`ลดจำนวน ${item.name}`} disabled={submitting || Boolean(serviceSubmitting)}>
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => changeQuantity(item.id, 1)} aria-label={`เพิ่มจำนวน ${item.name}`} disabled={submitting || Boolean(serviceSubmitting) || !canOrder}>
                        +
                      </button>
                    </div>
                    <button type="button" className={styles.deleteItemButton} onClick={() => removeItem(item.id)} disabled={submitting || Boolean(serviceSubmitting)}>
                      ลบ
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <footer className={styles.cartModalFooter}>
              <span>ยอดชำระ</span>
              <strong>{money(cartTotal)}</strong>
              <button type="button" className={styles.submitButton} onClick={() => void submitOrder()} disabled={submitting || cartCount === 0 || !canOrder}>
                {submitting ? "กำลังส่งรายการ..." : "ยืนยันสั่งอาหาร"}
              </button>
              <button type="button" className={styles.keepShoppingButton} onClick={() => setCartOpen(false)} disabled={submitting}>
                เลือกเมนูต่อ
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {submitting ? (
        <div className={styles.processing} role="status" aria-live="polite">
          <div>
            <span className={styles.spinner} />
            <strong>กำลังส่งรายการเข้าระบบ POS</strong>
            <p>กรุณาอย่าปิดหน้านี้</p>
          </div>
        </div>
      ) : null}
      {serviceSubmitting ? (
        <div className={styles.processing} role="status" aria-live="polite">
          <div>
            <span className={styles.spinner} />
            <strong>{serviceSubmitting === "call_staff" ? "กำลังเรียกพนักงาน" : "กำลังแจ้งต้องการชำระบิล"}</strong>
            <p>กรุณารอสักครู่</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
