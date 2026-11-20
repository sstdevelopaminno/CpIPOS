"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { buildRecyclingBarcodeIndex, resolveRecyclingBarcode } from "@/lib/recycling-barcode-index";
import { calculateRecyclingLine, recyclingUnitLabel } from "@/lib/recycling-calculation";
import type { RecyclingCatalogItem, RecyclingUnit } from "@/lib/server/recycling-pos-service";
import { RecyclingSalesModeSwitcher } from "@/components/pos/recycling-sales-mode-switcher";

type Direction = "buy" | "sell";
type CartLine = {
  key: number;
  direction: Direction;
  product: RecyclingCatalogItem;
  quantity: number;
  unit: RecyclingUnit;
  basisQuantity: number;
  unitPrice: number;
  total: number;
};

const weightUnits: RecyclingUnit[] = ["kg", "khid", "g", "ton"];
const formatMoney = (amount: number) =>
  new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

function CatalogImage({ item }: { item: RecyclingCatalogItem }) {
  return item.imageUrl
    ? <Image src={item.imageUrl} alt={item.name} width={54} height={54} unoptimized
        className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-white object-cover" />
    : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xl" aria-hidden="true">♻️</div>;
}

export function RecyclingPosWorkspace({ products, branchName, storeName, deviceCode, sellerName, shiftStatus, generalSaleEnabled, transactionWritesEnabled }: {
  products: RecyclingCatalogItem[];
  branchName: string;
  storeName: string;
  deviceCode: string | null;
  sellerName: string;
  shiftStatus: string;
  generalSaleEnabled: boolean;
  transactionWritesEnabled: boolean;
}) {
  const [direction, setDirection] = useState<Direction>("buy");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<RecyclingCatalogItem | null>(null);
  const [unit, setUnit] = useState<RecyclingUnit>("kg");
  const [quantity, setQuantity] = useState("1");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [counterpartyName, setCounterpartyName] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [printNotice, setPrintNotice] = useState<{ok:boolean; message:string} | null>(null);
  const [printing, setPrinting] = useState(false);
  const [settlement, setSettlement] = useState<"cash" | "bank_transfer">("cash");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [posted, setPosted] = useState<{ id: string; receipt_no?: string; total_minor: number; printRequestId: string } | null>(null);
  const requestIdRef = useRef("");
  const nextKey = useRef(0);
  const scannerRef = useRef<HTMLInputElement>(null);

  const barcodeIndex = useMemo(() => buildRecyclingBarcodeIndex(products), [products]);
  const visibleLines = lines.filter(line => line.direction === direction);
  const total = visibleLines.reduce((sum, line) => sum + line.total, 0);
  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter(item => !needle || item.sku.toLowerCase().includes(needle) ||
      item.name.toLowerCase().includes(needle) || item.category.toLowerCase().includes(needle)).slice(0, 30);
  }, [products, search]);
  const selectedPrice = pending ? (direction === "buy" ? pending.buyPrice : pending.sellPrice) : null;
  const preview = pending && selectedPrice !== null && quantity.trim()
    ? calculateRecyclingLine(Number(quantity), unit, selectedPrice, pending.priceBasis) : null;

  function openQuantityPopup(item: RecyclingCatalogItem) {
    if (posting || checkoutOpen) return;
    const price = direction === "buy" ? item.buyPrice : item.sellPrice;
    if (price === null) {
      setError(`กรุณากำหนดราคา${direction === "buy" ? "รับซื้อ" : "ขายออก"}ของ "${item.name}" ในสต๊อกก่อน`);
      scannerRef.current?.focus();
      return;
    }
    setError("");
    setPending(item);
    setUnit(item.priceBasis === "piece" ? "piece" : "kg");
    // Never silently assume a 1kg weight. Only counted units can scan directly.
    setQuantity(item.priceBasis === "piece" ? "1" : "");
  }

  function addLineToCart(
    product: RecyclingCatalogItem, selectedUnit: RecyclingUnit, selectedQuantity: number,
    price: number
  ) {
    if (posting || checkoutOpen) return;
    const calculated = calculateRecyclingLine(
      selectedQuantity, selectedUnit, price, product.priceBasis
    );
    if (!calculated) return;
    nextKey.current += 1;
    requestIdRef.current = "";
    setPosted(null);
    setPrintNotice(null);
    setLines(current => {
      // Scanner repeats for countable products increase their existing cart line.
      const existing = current.findIndex(line =>
        line.direction === direction && line.product.id === product.id &&
        line.unit === selectedUnit && line.unitPrice === price
      );
      if (existing < 0 || selectedUnit !== "piece") {
        return [...current, {
          key: nextKey.current, direction, product, unit: selectedUnit,
          quantity: selectedQuantity, basisQuantity: calculated.basisQuantity,
          unitPrice: price, total: calculated.amount
        }];
      }
      return current.map((line, index) => index === existing ? {
        ...line,
        quantity: line.quantity + selectedQuantity,
        basisQuantity: line.basisQuantity + calculated.basisQuantity,
        total: Number((line.total + calculated.amount).toFixed(2))
      } : line);
    });
  }

  function scanBarcode() {
    if (posting || checkoutOpen) return;
    const result = resolveRecyclingBarcode(barcodeIndex, search);
    if (result.status !== "found") {
      setError(result.status === "duplicate"
        ? "บาร์โค้ดนี้ซ้ำกัน กรุณาให้ผู้จัดการตรวจสอบทะเบียนสินค้า"
        : "ไม่พบบาร์โค้ดนี้ในสต๊อกของสาขา");
      return;
    }
    const product = result.item;
    const price = direction === "buy" ? product.buyPrice : product.sellPrice;
    if (price === null) {
      setError("ยังไม่ได้กำหนดราคาในสต๊อกสำหรับรายการนี้");
      return;
    }
    setSearch("");
    setError("");
    if (product.priceBasis === "piece") {
      // Barcode scanners terminate with Enter; a counted item has an exact
      // unambiguous quantity of one, so add immediately like ordinary POS.
      addLineToCart(product, "piece", 1, price);
      scannerRef.current?.focus();
    } else {
      // Weighted materials require the actual scale reading. Never invent
      // kilograms or silently authorize a payment from a barcode alone.
      openQuantityPopup(product);
    }
  }

  function addToCart() {
    if (posting || checkoutOpen || !pending || !preview || selectedPrice === null) return;
    addLineToCart(pending, unit, Number(quantity), selectedPrice);
    setPending(null);
    setQuantity("");
    setSearch("");
    setError("");
    window.setTimeout(() => scannerRef.current?.focus(), 0);
  }

  function changeDirection(next: Direction) {
    if (posting || checkoutOpen || next === direction) return;
    setDirection(next);
    setSearch("");
    setError("");
    setPending(null);
    setCheckoutOpen(false);
    setSettlement("cash");
    setPostError("");
  }

  async function queueReceiptPrint(transactionId: string, requestId: string) {
    if (printing) return;
    setPrinting(true);
    setPrintNotice(null);
    try {
      const response = await fetch(
        "/api/pos/recycling/receipts/" + transactionId + "/print", {
          method:"POST", credentials:"same-origin",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({request_id:requestId})
        }
      );
      const result = await response.json().catch(() => null) as {
        data?: {queued?:boolean; jobs?:Array<{status?:string}>};
        error?: {message?:string};
      } | null;
      if (!response.ok || result?.data?.queued !== true) {
        setPrintNotice({ok:false,message:
          "บันทึกธุรกรรมสำเร็จ แต่ส่งคำสั่งพิมพ์ไม่สำเร็จ: " +
          (result?.error?.message ?? "กรุณาตรวจเครื่องพิมพ์หรือ Print Agent")});
        return;
      }
      const jobs = result.data.jobs ?? [];
      const allPrinted = jobs.length > 0 && jobs.every(job=>job.status==="printed");
      setPrintNotice({ok:true,message:allPrinted
        ? "เครื่องพิมพ์ยืนยันการพิมพ์แล้ว"
        : "ส่งคำสั่งเข้าคิว Print Agent แล้ว กรุณาตรวจการพิมพ์ที่เครื่อง"});
    } catch {
      setPrintNotice({ok:false,message:
        "บันทึกธุรกรรมสำเร็จแล้ว แต่เชื่อมต่อเครื่องพิมพ์ไม่ได้ สามารถส่งพิมพ์ซ้ำด้วยบิลเดิม"});
    } finally {
      setPrinting(false);
    }
  }

  async function postTransaction() {
    if (posting || !transactionWritesEnabled || !checkoutOpen || !visibleLines.length || !counterpartyName.trim()) return;
    if (settlement === "bank_transfer") {
      setPostError("ต้องตรวจหลักฐานธนาคารก่อนจึงจะยืนยันการจ่ายหรือรับเงินโอนได้");
      return;
    }
    setPosting(true);
    setPostError("");
    setPosted(null);
    if (!requestIdRef.current) requestIdRef.current = window.crypto.randomUUID();
    const currentRequestId = requestIdRef.current;
    try {
      const response = await fetch("/api/pos/recycling/transactions", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: currentRequestId, direction, settlement,
          counterparty_name: counterpartyName.trim(),
          lines: visibleLines.map(line => ({
            product_id: line.product.id,
            quantity: line.quantity,
            unit: line.unit,
            expected_price: line.unitPrice
          }))
        })
      });
      const body = await response.json().catch(() => null) as {
        data?: { transaction?: { id?: string; receipt_no?: string; total_minor?: number } };
        error?: { code?: string; message?: string };
      } | null;
      if (!response.ok || !body?.data?.transaction?.id) {
        const code = body?.error?.code ?? "recycling_post_failed";
        const reasons: Record<string,string> = {
          recycling_migration_required: "ระบบบันทึกธุรกรรม Recycling ยังไม่ได้ติดตั้งที่เซิร์ฟเวอร์ ไม่มีรายการถูกบันทึก",
          recycling_uat_only: "ระบบยังปิดการบันทึกรับซื้อ–ขายออกจริงระหว่างทดสอบบัญชีและสต๊อก ไม่มีรายการถูกบันทึก",
          recycling_stock_insufficient: "จำนวนสินค้าในสต๊อกไม่เพียงพอ โปรดตรวจสอบยอดคงเหลือ",
          recycling_price_changed_refresh_cart: "ราคาวัสดุมีการเปลี่ยนแปลง กรุณาเริ่มบิลใหม่ด้วยราคาล่าสุด",
          missing_active_shift: "กรุณาเปิดกะก่อนบันทึกรับซื้อหรือขายออก",
          recycling_subscription_inactive: "สัญญา CUSTOM Recycling ยังไม่พร้อมใช้งาน"
        };
        setPostError(reasons[code] ?? body?.error?.message ?? "บันทึกไม่สำเร็จ ยังไม่ควรจ่ายหรือรับเงิน");
        return;
      }
      const committedId = body.data.transaction.id;
      setPosted({
        id: committedId,
        receipt_no: body.data.transaction.receipt_no,
        total_minor: Number(body.data.transaction.total_minor ?? 0),
        printRequestId: currentRequestId
      });
      requestIdRef.current = "";
      setCheckoutOpen(false);
      setLines(current => current.filter(line => line.direction !== direction));
      setCounterpartyName("");
      // Queue only after a confirmed atomic transaction. A print failure must
      // never undo or silently repeat a completed buy/sell transaction.
      await queueReceiptPrint(committedId, currentRequestId);
    } catch {
      // Keep the same request_id on retry to avoid double posting after a
      // connection error. The backend returns the original transaction.
      setPostError("การเชื่อมต่อขัดข้อง กรุณาลองบันทึกซ้ำด้วยรายการเดิม ห้ามจ่าย/รับเงินซ้ำก่อนตรวจสอบบิล");
    } finally {
      setPosting(false);
    }
  }

  const units = pending?.priceBasis === "piece" ? (["piece", "stem"] as RecyclingUnit[]) : weightUnits;

  return <main className="flex h-full min-h-0 w-full flex-col gap-2 overflow-y-auto bg-slate-50 px-2 py-2 md:px-3" data-testid="recycling-custom-pos">
    <RecyclingSalesModeSwitcher storeName={storeName} branchName={branchName}
      deviceCode={deviceCode} sellerName={sellerName} shiftStatus={shiftStatus}
      generalSaleEnabled={generalSaleEnabled} direction={direction}
      onDirectionChange={changeDirection} busy={posting}/>
    {!transactionWritesEnabled && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      ระบบรับซื้อ–ขายออกยังปิดการบันทึกธุรกรรมจริงระหว่างตรวจสอบ Backend ไม่มีรายการสต๊อกหรือบัญชีถูกบันทึก
    </div>}

    <div className="grid min-h-[560px] w-full flex-1 gap-2 lg:grid-cols-[minmax(290px,0.42fr)_minmax(0,0.58fr)]">
      <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-extrabold text-slate-900">ยิงบาร์โค้ด / ค้นหาวัสดุ</h2>
          <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">{products.length} รายการ</span>
        </div>
        <label className="mt-3 block text-sm font-semibold text-slate-700" htmlFor="recycling-barcode">รหัสสินค้า / SKU</label>
        <input id="recycling-barcode" ref={scannerRef} autoComplete="off" autoFocus disabled={posting || checkoutOpen}
          className="mt-1 w-full rounded-lg border-2 border-blue-400 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-blue-700"
          placeholder="ยิงบาร์โค้ดแล้วกด Enter" value={search}
          onChange={event => { setSearch(event.target.value); setError(""); }}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); scanBarcode(); } }} />
        {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
        <p className="mt-2 text-xs text-slate-500">ยิงบาร์โค้ดแล้ว Enter: สินค้านับชิ้นเข้าตะกร้าทันที · สินค้าชั่งน้ำหนักให้ยืนยันค่าชั่งก่อน</p>
        <div className="mt-4 max-h-[460px] space-y-1 overflow-y-auto">
          {filteredProducts.length ? filteredProducts.map(item => {
            const price = direction === "buy" ? item.buyPrice : item.sellPrice;
            return <button type="button" key={item.id} disabled={posting || checkoutOpen} onClick={() => openQuantityPopup(item)}
              className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left hover:border-blue-200 hover:bg-blue-50">
              <CatalogImage item={item} />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm text-slate-900">{item.name}</strong>
                <span className="block truncate text-xs text-slate-500">{item.sku || "ไม่มีบาร์โค้ด"} · {item.category}</span>
              </span>
              <span className="shrink-0 text-right text-sm font-bold text-blue-800">
                {price === null ? "ยังไม่ตั้งราคา" : `${formatMoney(price)} ฿`}
                <small className="block text-xs font-normal text-slate-500">/{item.priceBasis === "kg" ? "กก." : "ชิ้น"}</small>
              </span>
            </button>;
          }) : <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">ไม่พบสินค้าในสต๊อกของสาขา</p>}
        </div>
      </section>

      <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-slate-900">ตะกร้ารายการ{direction === "buy" ? "รับซื้อ" : "ขายออก"}</h2>
          <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
            disabled={!visibleLines.length || posting || checkoutOpen} onClick={() => { requestIdRef.current = ""; setPosted(null); setLines(current => current.filter(line => line.direction !== direction)); }}>
            ล้างตะกร้า
          </button>
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[630px] border-collapse text-sm">
            <thead className="bg-slate-100 text-left text-slate-700"><tr>
              <th className="px-3 py-3">#</th><th className="px-3 py-3">รหัส / รายการ</th>
              <th className="px-3 py-3 text-right">จำนวน</th><th className="px-3 py-3 text-right">ราคาต่อหน่วยฐาน</th>
              <th className="px-3 py-3 text-right">รวม (บาท)</th><th className="px-3 py-3">ลบ</th>
            </tr></thead>
            <tbody>{visibleLines.length ? visibleLines.map((line, index) => <tr key={line.key} className="border-t border-slate-100">
              <td className="px-3 py-3 text-slate-500">{index + 1}</td>
              <td className="px-3 py-3"><strong>{line.product.name}</strong><span className="block text-xs text-slate-500">{line.product.sku}</span></td>
              <td className="px-3 py-3 text-right">{line.quantity.toLocaleString("th-TH")} {recyclingUnitLabel(line.unit)}</td>
              <td className="px-3 py-3 text-right">{formatMoney(line.unitPrice)} /{line.product.priceBasis === "kg" ? "กก." : "ชิ้น"}</td>
              <td className="px-3 py-3 text-right font-extrabold">{formatMoney(line.total)}</td>
              <td className="px-3 py-3"><button type="button" disabled={posting || checkoutOpen} aria-label={`ลบ ${line.product.name}`}
                className="rounded px-2 py-1 text-rose-700 hover:bg-rose-50"
                onClick={() => { requestIdRef.current = ""; setPosted(null); setLines(current => current.filter(item => item.key !== line.key)); }}>ลบ</button></td>
            </tr>) : <tr><td colSpan={6} className="px-4 py-14 text-center text-slate-500">
              ยังไม่มีสินค้าในตะกร้า · ยิงบาร์โค้ดเพื่อเริ่มรายการ
            </td></tr>}</tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl bg-blue-50 p-4">
          <div><span className="text-sm font-semibold text-slate-600">{direction === "buy" ? "ยอดเงินจ่ายผู้ขาย" : "ยอดรับเงินจากผู้ซื้อ"}</span>
            <small className="block text-xs text-slate-500">{visibleLines.length} รายการ (ยังไม่บันทึก)</small></div>
          <strong className="text-2xl font-extrabold tabular-nums text-blue-900">{formatMoney(total)} ฿</strong>
        </div>
        {postError && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{postError}</p>}
        {posted && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
          บันทึกรายการสำเร็จ หมายเลขอ้างอิง {posted.receipt_no ?? posted.id}
          · ยอดที่บันทึก {formatMoney(posted.total_minor / 100)} บาท
          {printing && <span className="mt-2 block text-xs">กำลังส่งคิวพิมพ์อัตโนมัติ...</span>}
          {printNotice && <span role={printNotice.ok ? "status" : "alert"} className={"mt-2 block text-xs " + (printNotice.ok ? "text-emerald-800" : "text-amber-800")}>{printNotice.message}</span>}
          {printNotice && !printNotice.ok && <button type="button" disabled={printing}
            className="mt-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-950 disabled:opacity-50"
            onClick={() => void queueReceiptPrint(posted.id, posted.printRequestId)}>ส่งคำสั่งพิมพ์ซ้ำ (ไม่บันทึกบิลใหม่)</button>}
          <Link href={`/preview/pos/recycling/receipts/${posted.id}`}
            className="mt-2 block w-fit rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white">
            ดูหลักฐานและพิมพ์ใบรับซื้อ–ขายออก
          </Link>
        </p>}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={() => { setCheckoutOpen(true); setPostError(""); }}
            disabled={posting || visibleLines.length === 0}
            className="w-auto min-w-[220px] max-w-full rounded-lg bg-blue-700 px-5 py-3 text-sm font-extrabold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
            {direction === "buy" ? "บันทึกใบรับซื้อและเข้าสต๊อก" : "บันทึกขายออกและตัดสต๊อก"}
          </button>
        </div>
      </section>
    </div>

    {checkoutOpen && <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/70 p-3"
      role="presentation">
      <form role="dialog" aria-modal="true" aria-labelledby="recycling-checkout-title"
        onSubmit={event => {event.preventDefault(); void postTransaction();}}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="recycling-checkout-title" className="text-lg font-extrabold text-slate-900">
              {direction === "buy" ? "จ่ายเงิน" : "ชำระเงิน"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{direction === "buy"
              ? "รับซื้อเข้าร้าน · ร้านจ่ายเงินให้ผู้ขายวัสดุ"
              : "ขายออก · ร้านรับชำระเงินจากผู้ซื้อวัสดุ"}</p>
          </div>
          <button type="button" disabled={posting} aria-label="ปิดหน้าต่างชำระเงิน"
            onClick={() => setCheckoutOpen(false)}
            className="rounded-lg border border-slate-200 px-3 py-1 text-lg text-slate-500 disabled:opacity-50">×</button>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-blue-50 px-4 py-3">
          <span className="text-sm font-semibold text-slate-700">
            {direction === "buy" ? "ยอดที่ร้านต้องจ่าย" : "ยอดที่ร้านต้องรับ"}
          </span>
          <strong className="text-2xl font-extrabold tabular-nums text-blue-900">{formatMoney(total)} ฿</strong>
        </div>
        <label htmlFor="recycling-counterparty" className="mt-4 block text-sm font-semibold text-slate-800">
          {direction === "buy" ? "ชื่อผู้ขายวัสดุ" : "ชื่อผู้ซื้อวัสดุ"}
        </label>
        <input id="recycling-counterparty" autoFocus required maxLength={240}
          value={counterpartyName} disabled={posting}
          onChange={event => setCounterpartyName(event.target.value)}
          placeholder="ระบุชื่อคู่ค้า"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"/>
        <fieldset className="mt-4 space-y-2">
          <legend className="text-sm font-extrabold text-slate-800">{direction === "buy" ? "วิธีจ่ายเงิน" : "วิธีรับชำระเงิน"}</legend>
          <label className={"flex cursor-pointer items-center gap-3 rounded-lg border p-3 " + (settlement === "cash" ? "border-blue-600 bg-blue-50" : "border-slate-200")}>
            <input type="radio" name="recycling-settlement" checked={settlement==="cash"}
              disabled={posting} onChange={() => setSettlement("cash")} />
            <span className="text-sm font-semibold">{direction === "buy" ? "จ่ายเงินสด" : "ชำระเงินสด"}</span>
          </label>
          <label className={"flex cursor-pointer items-center gap-3 rounded-lg border p-3 " + (settlement === "bank_transfer" ? "border-blue-600 bg-blue-50" : "border-slate-200")}>
            <input type="radio" name="recycling-settlement" checked={settlement==="bank_transfer"}
              disabled={posting} onChange={() => { setSettlement("bank_transfer"); setPostError(""); }} />
            <span className="text-sm font-semibold">{direction === "buy" ? "จ่ายเงินโอน" : "ชำระเงินโอน"}
              <small className="block font-normal text-slate-500">ต้องตรวจหลักฐานธนาคารก่อนยืนยันธุรกรรม</small>
            </span>
          </label>
        </fieldset>
        {settlement === "bank_transfer" && <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          ยังไม่เปิดการตรวจสอบหลักฐานโอนเงินสำหรับ Recycling จึงไม่อนุญาตให้ยืนยันการ{direction === "buy" ? "จ่ายเงิน" : "รับชำระเงิน"}หรือสร้างบิลสำเร็จ
        </p>}
        {!transactionWritesEnabled && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-900">ตัวอย่างหน้าต่างชำระเงิน: การบันทึกธุรกรรมจริงยังปิดไว้จนกว่าจะผ่านตรวจรับบัญชีและสต๊อก</p>}
        {postError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">{postError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={posting} onClick={() => setCheckoutOpen(false)}
            className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 disabled:opacity-50">ย้อนกลับ</button>
          <button type="submit" disabled={!transactionWritesEnabled || posting || settlement === "bank_transfer" || !counterpartyName.trim() || !visibleLines.length}
            className="rounded-lg bg-blue-700 px-5 py-3 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {posting ? "กำลังบันทึก..." : direction === "buy" ? "ยืนยันจ่ายเงินและออกใบรับซื้อ" : "ยืนยันรับชำระและออกใบเสร็จขายออก"}
          </button>
        </div>
      </form>
    </div>}
    {pending && <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/65 p-3"
      onMouseDown={event => { if (event.target === event.currentTarget) setPending(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="recycling-quantity-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-widest text-blue-700">บาร์โค้ด: {pending.sku || "ไม่ระบุ"}</p>
        <h3 id="recycling-quantity-title" className="mt-1 text-xl font-extrabold text-slate-900">ระบุน้ำหนัก / จำนวน</h3>
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-slate-50 p-3">
          <CatalogImage item={pending}/>
          <div><strong className="block text-slate-900">{pending.name}</strong><small className="text-slate-500">{pending.category}</small></div>
        </div>
        <p className="mt-4 text-sm font-semibold text-slate-700">เลือกหน่วยจากผลชั่งภายนอก</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="หน่วยจำนวน">
          {units.map(value => <button type="button" key={value} onClick={() => setUnit(value)} aria-pressed={unit === value}
            className={`rounded-lg border px-2 py-2 text-sm font-bold ${unit === value
              ? "border-blue-700 bg-blue-700 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
            {recyclingUnitLabel(value)}
          </button>)}
        </div>
        <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor="recycling-quantity">จำนวนที่ชั่ง / นับ</label>
        <input id="recycling-quantity" autoFocus type="number" min="0.001" step="any" value={quantity}
          onChange={event => setQuantity(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addToCart(); } }}
          className="mt-1 w-full rounded-lg border-2 border-blue-300 px-3 py-3 text-xl font-bold text-slate-900 focus:border-blue-700 focus:outline-none" />
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between gap-2"><span>ราคาที่ตั้งไว้ในสต๊อก</span>
            <strong>{selectedPrice === null ? "—" : formatMoney(selectedPrice)} ฿ /{pending.priceBasis === "kg" ? "กก." : "ชิ้น"}</strong></div>
          {preview && <div className="mt-2 flex justify-between gap-2 text-slate-600">
            <span>จำนวนเทียบหน่วยราคา</span><span>{preview.basisQuantity.toLocaleString("th-TH", { maximumFractionDigits: 6 })} {pending.priceBasis === "kg" ? "กก." : "ชิ้น"}</span>
          </div>}
          <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-lg font-extrabold text-blue-900">
            <span>รวม</span><span>{preview ? formatMoney(preview.amount) : "—"} ฿</span>
          </div>
          {!preview && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">โปรดกรอกจำนวนที่ถูกต้องและเลือกหน่วยที่ตรงกับสินค้าชนิดนี้</p>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { setPending(null); scannerRef.current?.focus(); }}
            className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700">ยกเลิก</button>
          <button type="button" disabled={!preview} onClick={addToCart}
            className="rounded-lg bg-blue-700 px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">เพิ่มลงตะกร้า</button>
        </div>
      </section>
    </div>}
  </main>;
}
