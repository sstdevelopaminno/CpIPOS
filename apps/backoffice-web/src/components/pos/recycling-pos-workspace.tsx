"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { calculateRecyclingLine, recyclingUnitLabel } from "@/lib/recycling-calculation";
import type { RecyclingCatalogItem, RecyclingUnit } from "@/lib/server/recycling-pos-service";

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

export function RecyclingPosWorkspace({ products, branchName }: {
  products: RecyclingCatalogItem[];
  branchName: string;
}) {
  const [direction, setDirection] = useState<Direction>("buy");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<RecyclingCatalogItem | null>(null);
  const [unit, setUnit] = useState<RecyclingUnit>("kg");
  const [quantity, setQuantity] = useState("1");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [counterpartyName, setCounterpartyName] = useState("");
  const [settlement, setSettlement] = useState<"cash" | "bank_transfer" | "credit">("cash");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [posted, setPosted] = useState<{ id: string; total_minor: number } | null>(null);
  const requestIdRef = useRef("");
  const nextKey = useRef(0);
  const scannerRef = useRef<HTMLInputElement>(null);

  const visibleLines = lines.filter(line => line.direction === direction);
  const total = visibleLines.reduce((sum, line) => sum + line.total, 0);
  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter(item => !needle || item.sku.toLowerCase().includes(needle) ||
      item.name.toLowerCase().includes(needle) || item.category.toLowerCase().includes(needle)).slice(0, 30);
  }, [products, search]);
  const selectedPrice = pending ? (direction === "buy" ? pending.buyPrice : pending.sellPrice) : null;
  const preview = pending && selectedPrice !== null
    ? calculateRecyclingLine(Number(quantity), unit, selectedPrice, pending.priceBasis) : null;

  function openQuantityPopup(item: RecyclingCatalogItem) {
    const price = direction === "buy" ? item.buyPrice : item.sellPrice;
    if (price === null) {
      setError(`กรุณากำหนดราคา${direction === "buy" ? "รับซื้อ" : "ขายออก"}ของ "${item.name}" ในสต๊อกก่อน`);
      scannerRef.current?.focus();
      return;
    }
    setError("");
    setPending(item);
    setUnit(item.priceBasis === "piece" ? "piece" : "kg");
    setQuantity("1");
  }

  function scanBarcode() {
    const barcode = search.trim().toLowerCase();
    if (!barcode) return;
    // A scanner sends its code followed by Enter. Never infer a product from
    // partial text, and never silently add weight without operator confirmation.
    const matches = products.filter(item => item.sku.trim().toLowerCase() === barcode);
    if (matches.length !== 1) {
      setError(matches.length > 1
        ? "บาร์โค้ดนี้ซ้ำกัน กรุณาให้ผู้จัดการตรวจสอบทะเบียนสินค้า"
        : "ไม่พบบาร์โค้ดนี้ในสต๊อกของสาขา");
      return;
    }
    openQuantityPopup(matches[0]);
    setSearch("");
  }

  function addToCart() {
    if (!pending || !preview || selectedPrice === null) return;
    nextKey.current += 1;
    requestIdRef.current = "";
    setPosted(null);
    setLines(current => [...current, {
      key: nextKey.current,
      direction,
      product: pending,
      unit,
      quantity: Number(quantity),
      basisQuantity: preview.basisQuantity,
      unitPrice: selectedPrice,
      total: preview.amount
    }]);
    setPending(null);
    setQuantity("1");
    setSearch("");
    setError("");
    window.setTimeout(() => scannerRef.current?.focus(), 0);
  }

  async function postTransaction() {
    if (posting || !visibleLines.length || !counterpartyName.trim()) return;
    setPosting(true);
    setPostError("");
    setPosted(null);
    if (!requestIdRef.current) requestIdRef.current = window.crypto.randomUUID();
    try {
      const response = await fetch("/api/pos/recycling/transactions", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestIdRef.current, direction, settlement,
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
        data?: { transaction?: { id?: string; total_minor?: number } };
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
      setPosted({
        id: body.data.transaction.id,
        total_minor: Number(body.data.transaction.total_minor ?? 0)
      });
      requestIdRef.current = "";
      setLines(current => current.filter(line => line.direction !== direction));
      setCounterpartyName("");
    } catch {
      // Keep the same request_id on retry to avoid double posting after a
      // connection error. The backend returns the original transaction.
      setPostError("การเชื่อมต่อขัดข้อง กรุณาลองบันทึกซ้ำด้วยรายการเดิม ห้ามจ่าย/รับเงินซ้ำก่อนตรวจสอบบิล");
    } finally {
      setPosting(false);
    }
  }

  const units = pending?.priceBasis === "piece" ? (["piece"] as RecyclingUnit[]) : weightUnits;

  return <main className="mx-auto w-full max-w-[1550px] space-y-4 px-3 pb-8 pt-4 md:px-6" data-testid="recycling-custom-pos">
    <header className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-950 to-blue-800 p-5 text-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.16em] text-sky-200">CPIPOS · CUSTOM RECYCLING</p>
          <h1 className="mt-1 text-2xl font-extrabold">รับซื้อ / ขายออก วัสดุรีไซเคิล</h1>
          <p className="mt-1 text-sm text-blue-100">{branchName} · ชั่งน้ำหนักจากเครื่องชั่งภายนอก แล้วกรอกจำนวนใน POP UP</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
            href="/preview/pos/recycling/stock">สต๊อกและราคาวัสดุ</Link>
          <Link className="rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
            href="/preview/pos/more">เมนูเพิ่มเติม</Link>
        </div>
      </div>
    </header>

    <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      ระบบรับซื้อ–ขายออกจะบันทึกผ่าน RPC แบบ Atomic เท่านั้น ถ้า Backend ยังไม่ได้ติดตั้ง ระบบจะแจ้งและไม่บันทึกบิล
      ทุกครั้งต้องเปิดกะและยืนยันข้อมูลคู่ค้าก่อนรับหรือจ่ายเงินจริง
    </div>

    <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-1.5" role="group" aria-label="ประเภทการทำรายการ">
      {([["buy", "รับซื้อเข้าร้าน"], ["sell", "ขายออก"]] as const).map(([value, label]) =>
        <button type="button" key={value} onClick={() => { setDirection(value); setSearch(""); setError(""); setPending(null); }}
          aria-pressed={direction === value}
          className={`rounded-lg px-4 py-3 text-base font-extrabold transition-colors ${direction === value
            ? value === "buy" ? "bg-blue-700 text-white" : "bg-emerald-700 text-white"
            : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>
          {label}
        </button>)}
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.4fr)]">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-extrabold text-slate-900">ยิงบาร์โค้ด / ค้นหาวัสดุ</h2>
          <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">{products.length} รายการ</span>
        </div>
        <label className="mt-3 block text-sm font-semibold text-slate-700" htmlFor="recycling-barcode">รหัสสินค้า / SKU</label>
        <input id="recycling-barcode" ref={scannerRef} autoComplete="off" autoFocus
          className="mt-1 w-full rounded-lg border-2 border-blue-400 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-blue-700"
          placeholder="ยิงบาร์โค้ดแล้วกด Enter" value={search}
          onChange={event => { setSearch(event.target.value); setError(""); }}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); scanBarcode(); } }} />
        {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
        <p className="mt-2 text-xs text-slate-500">เลือกจากรายการด้านล่างได้เช่นกัน · ราคาดึงจากสต๊อก ไม่แก้ราคาหน้าขาย</p>
        <div className="mt-4 max-h-[460px] space-y-1 overflow-y-auto">
          {filteredProducts.length ? filteredProducts.map(item => {
            const price = direction === "buy" ? item.buyPrice : item.sellPrice;
            return <button type="button" key={item.id} onClick={() => openQuantityPopup(item)}
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

      <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-slate-900">ตะกร้ารายการ{direction === "buy" ? "รับซื้อ" : "ขายออก"}</h2>
          <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
            disabled={!visibleLines.length || posting} onClick={() => { requestIdRef.current = ""; setPosted(null); setLines(current => current.filter(line => line.direction !== direction)); }}>
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
              <td className="px-3 py-3"><button type="button" aria-label={`ลบ ${line.product.name}`}
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
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            {direction === "buy" ? "ชื่อผู้ขายวัสดุ" : "ชื่อผู้ซื้อวัสดุ"}
            <input value={counterpartyName} maxLength={240} onChange={event => setCounterpartyName(event.target.value)}
              placeholder={direction === "buy" ? "กรอกชื่อผู้ขายวัสดุ" : "กรอกชื่อผู้ซื้อวัสดุ"}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900 focus:border-blue-600 focus:outline-none" />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            วิธีรับ / จ่ายเงิน
            <select value={settlement} onChange={event => setSettlement(event.target.value as typeof settlement)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900">
              <option value="cash">เงินสด</option>
              <option value="bank_transfer">โอนเงิน</option>
              <option value="credit">ค้างชำระ / เครดิต</option>
            </select>
          </label>
        </div>
        {postError && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{postError}</p>}
        {posted && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
          บันทึกรายการสำเร็จ หมายเลขอ้างอิง {posted.id} · ยอดที่บันทึก {formatMoney(posted.total_minor / 100)} บาท
        </p>}
        <button type="button" onClick={() => void postTransaction()}
          disabled={posting || visibleLines.length === 0 || !counterpartyName.trim()}
          className="mt-4 w-full rounded-lg bg-blue-700 px-4 py-4 text-base font-extrabold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
          {posting ? "กำลังตรวจสอบและบันทึก..." : direction === "buy" ? "บันทึกใบรับซื้อและรับเข้าสต๊อก" : "บันทึกขายออกและตัดสต๊อก"}
        </button>
      </section>
    </div>

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
