"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { recyclingBusinessDayKey, recyclingShiftIsToday } from "@/lib/recycling-business-day";
import { buildRecyclingBarcodeIndex, resolveRecyclingBarcode } from "@/lib/recycling-barcode-index";
import { normalizeRecyclingBarcodeInput, physicalRecyclingBarcodeKey } from "@/lib/recycling-scanner-keyboard";
import { parseRecyclingHeldBills, recyclingHeldKey, type HeldRecyclingBill } from "@/lib/recycling-held-bills";
import { calculateRecyclingLine, recyclingUnitLabel } from "@/lib/recycling-calculation";
import { formatRecyclingUnitPrice, RECYCLING_PRICE_UNIT_LABELS } from "@/lib/recycling-price-units";
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

function CatalogImage({ item, mediaUrl }: { item: RecyclingCatalogItem; mediaUrl?: string }) {
  const imageUrl=mediaUrl || item.imageUrl;
  return imageUrl
    ? <Image src={imageUrl} alt={item.name} width={54} height={54} unoptimized
        className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-white object-cover" />
    : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xl" aria-hidden="true">♻️</div>;
}

export function RecyclingPosWorkspace({ products, tenantId, branchId, mediaByProduct, branchName, storeName, deviceCode, sellerName, shiftStatus, generalSaleEnabled, transactionWritesEnabled }: {
  products: RecyclingCatalogItem[];
  tenantId: string;
  branchId: string;
  mediaByProduct: Record<string,string>;
  branchName: string;
  storeName: string;
  deviceCode: string | null;
  sellerName: string;
  shiftStatus: string;
  generalSaleEnabled: boolean;
  transactionWritesEnabled: boolean;
}) {
  const [shiftGate,setShiftGate]=useState<"checking"|"open"|"blocked">("checking");
  const [shiftOpenedAt,setShiftOpenedAt]=useState("");
  const [shiftId,setShiftId]=useState("");
  const [shiftMessage,setShiftMessage]=useState("กำลังตรวจสอบและเปิดกะ Recycling ประจำวัน...");
  const gateInFlightRef=useRef(false);
  const lastDayRef=useRef(recyclingBusinessDayKey(new Date()));
  const postingRef=useRef(false);
  const rolloverWhilePostingRef=useRef(false);
  const [direction, setDirection] = useState<Direction>("buy");
  const [search, setSearch] = useState("");
  const [searchMode,setSearchMode]=useState<"barcode"|"name">("barcode");
  const [selectedCategory,setSelectedCategory]=useState("all");
  const [catalogPage,setCatalogPage]=useState(1);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<RecyclingCatalogItem | null>(null);
  const [unit, setUnit] = useState<RecyclingUnit>("kg");
  const [quantity, setQuantity] = useState("1");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [heldBills,setHeldBills]=useState<HeldRecyclingBill[]>([]);
  const [heldOpen,setHeldOpen]=useState(false);
  const [cancelOpen,setCancelOpen]=useState(false);
  const [heldNotice,setHeldNotice]=useState("");
  const [heldError,setHeldError]=useState("");
  const previousShiftId=useRef("");
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
  useEffect(()=>{postingRef.current=posting;},[posting]);
  const canUseShift=shiftGate==="open" && recyclingShiftIsToday(shiftOpenedAt);
  useEffect(() => {
    let mounted = true;
    async function checkShift() {
      if (gateInFlightRef.current) return;
      gateInFlightRef.current = true;
      if (mounted) {
        setShiftGate("checking");
        setShiftMessage("กำลังตรวจสอบสถานะกะ Recycling...");
      }
      try {
        const response = await fetch("/api/pos/recycling/shifts/current", {
          credentials: "same-origin", cache: "no-store"
        });
        const result = await response.json().catch(() => null) as {
          data?: { shift?: { id: string; opened_at: string; status: string } | null; needs_join?: boolean; message?: string };
          error?: { code?: string; message?: string };
        } | null;
        if (!mounted) return;
        const shift = result?.data?.shift;
        if (response.ok && shift?.status === "open" && !result?.data?.needs_join &&
            recyclingShiftIsToday(shift.opened_at)) {
          setShiftOpenedAt(shift.opened_at);
          setShiftId(shift.id);
          setShiftGate("open");
          setShiftMessage("กะ Recycling เปิดแล้ว");
        } else {
          setShiftOpenedAt("");
          setShiftId("");
          setShiftGate("blocked");
          setShiftMessage(result?.error?.message ?? result?.data?.message ??
            "ยังไม่ได้เปิดกะวันนี้ กรุณาไปที่เมนูเปิด/ปิดกะ");
        }
      } catch {
        if (mounted) {
          setShiftGate("blocked");
          setShiftOpenedAt("");
          setShiftId("");
          setShiftMessage("ไม่สามารถตรวจสอบสถานะกะได้ กรุณาลองอีกครั้ง");
        }
      } finally {
        gateInFlightRef.current = false;
      }
    }
    // Visiting the cashier never creates a shift. Opening/joining requires
    // an explicit action from the dedicated Recycling shift screen.
    void checkShift();
    const onDayCheck = () => {
      const today = recyclingBusinessDayKey(new Date());
      if (today !== lastDayRef.current) {
        lastDayRef.current = today;
        rolloverWhilePostingRef.current = postingRef.current;
        if (!postingRef.current) {
          setLines([]); setPending(null); setCheckoutOpen(false); setCounterpartyName("");
          setHeldBills([]); setHeldOpen(false); setCancelOpen(false);
          requestIdRef.current = ""; setPosted(null);
        }
        setShiftGate("checking"); setShiftOpenedAt(""); setShiftId("");
        setError("เปลี่ยนวันธุรกิจแล้ว เคลียร์เฉพาะตะกร้าที่ยังไม่บันทึก ไม่ลบใบเสร็จหรือสต๊อก");
        void checkShift();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkShift();
    };
    const interval = window.setInterval(onDayCheck, 5000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const barcodeIndex = useMemo(() => buildRecyclingBarcodeIndex(products), [products]);
  const visibleLines = lines.filter(line => line.direction === direction);
  const total = visibleLines.reduce((sum, line) => sum + line.total, 0);
  const categories=useMemo(()=>Array.from(new Set(products.map(item=>item.category)))
    .sort((a,b)=>a.localeCompare(b,"th")), [products]);
  const filteredProducts=useMemo(()=>{
    const needle=search.trim().toLocaleLowerCase();
    return products.filter(item=>{
      const matchesCategory=selectedCategory==="all"||item.category===selectedCategory;
      const matchesSearch=!needle || (searchMode==="barcode"
        ? item.sku.toLocaleLowerCase().includes(needle)
        : [item.name,item.category,item.sku].some(value=>value.toLocaleLowerCase().includes(needle)));
      return matchesCategory&&matchesSearch;
    }).sort((a,b)=>a.name.localeCompare(b.name,"th"));
  },[products,search,searchMode,selectedCategory]);
  const pageSize=12;
  const pageCount=Math.max(1,Math.ceil(filteredProducts.length/pageSize));
  const currentPage=Math.min(catalogPage,pageCount);
  const pageItems=filteredProducts.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const storageKey=useMemo(()=>recyclingHeldKey(tenantId,branchId,deviceCode,shiftId),
    [tenantId,branchId,deviceCode,shiftId]);
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

  function scanBarcode(value:string=search) {
    if (posting || checkoutOpen) return;
    const normalized=normalizeRecyclingBarcodeInput(value);
    setSearch(normalized);
    const result = resolveRecyclingBarcode(barcodeIndex, normalized);
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
    setCatalogPage(1);
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
      if (jobs.length === 0 || jobs.some(job => job.status === "failed")) {
        setPrintNotice({ok:false,message:
          "พบงานพิมพ์ไม่สำเร็จ กรุณาตรวจเครื่องพิมพ์และคิวงานก่อนส่งพิมพ์ใหม่"});
        return;
      }
      const allPrinted = jobs.every(job=>job.status==="printed");
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
    if (posting || !canUseShift || !transactionWritesEnabled || !checkoutOpen || !visibleLines.length) return;
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
          counterparty_name: counterpartyName.trim() || "-",
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
          recycling_shift_daily_cutoff: "สิ้นสุดวันธุรกิจแล้ว กะเมื่อวานกำลังปิดและสรุปยอด",
          recycling_shift_mode_required: "ต้องเปิดกะ Recycling แยกจากกะขายทั่วไป",
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
      if(rolloverWhilePostingRef.current){
        rolloverWhilePostingRef.current=false;
        setLines([]);setPending(null);setCheckoutOpen(false);
        setCounterpartyName("");requestIdRef.current="";
      }
    }
  }

  // Local drafts are isolated from the normal POS held-bill pool. Never
  // automatically restore a cart into a new shift, another branch or device.
  useEffect(()=>{
    if(!shiftId){setHeldBills([]);return;}
    if(previousShiftId.current && previousShiftId.current!==shiftId){
      setLines([]);setPending(null);setCheckoutOpen(false);
      setHeldOpen(false);setCancelOpen(false);
    }
    previousShiftId.current=shiftId;
    try{
      setHeldBills(parseRecyclingHeldBills(window.localStorage.getItem(storageKey),shiftId));
    }catch{setHeldBills([]);}
  },[shiftId,storageKey]);

  function saveHeldBills(next:HeldRecyclingBill[]):boolean{
    if(!canUseShift || !shiftId)return false;
    try{
      window.localStorage.setItem(storageKey,JSON.stringify(next.slice(0,30)));
      setHeldBills(next.slice(0,30));
      return true;
    }catch{
      setHeldError("ไม่สามารถบันทึกพักบิลลงเครื่องนี้ได้ ตะกร้ายังอยู่ โปรดตรวจสอบพื้นที่เก็บข้อมูล");
      return false;
    }
  }

  function parkCurrentBill(){
    if(!canUseShift||posting||checkoutOpen||!visibleLines.length||!shiftId)return;
    setHeldError("");
    const draft:HeldRecyclingBill={
      id:window.crypto.randomUUID(),heldAt:new Date().toISOString(),direction,shiftId,
      lines:visibleLines.map(line=>({
        productId:line.product.id,unit:line.unit,quantity:line.quantity,unitPrice:line.unitPrice
      }))
    };
    if(!saveHeldBills([draft,...heldBills].slice(0,30)))return;
    requestIdRef.current="";setPosted(null);setPrintNotice(null);setCounterpartyName("");
    setLines(current=>current.filter(line=>line.direction!==direction));
    setHeldNotice("พักบิลสำเร็จ · สามารถเรียกคืนได้จากรายการพักบิล");
    scannerRef.current?.focus();
  }

  function cancelCurrentBill(){
    if(posting||checkoutOpen)return;
    requestIdRef.current="";setPosted(null);setPostError("");setPrintNotice(null);
    setLines(current=>current.filter(line=>line.direction!==direction));
    setCounterpartyName("");setCancelOpen(false);setHeldNotice("ยกเลิกตะกร้าที่ยังไม่บันทึกแล้ว");
    scannerRef.current?.focus();
  }

  function restoreHeldBill(bill:HeldRecyclingBill){
    if(posting||checkoutOpen||!canUseShift||!shiftId||bill.shiftId!==shiftId)return;
    setHeldError("");
    if(lines.some(line=>line.direction===bill.direction) &&
       !window.confirm("มีรายการในตะกร้าอยู่แล้ว ต้องการแทนที่ด้วยบิลที่พักไว้หรือไม่?"))return;
    const nextLines:CartLine[]=[];
    let priceChanged=false;
    for(const saved of bill.lines){
      const product=products.find(item=>item.id===saved.productId);
      if(!product){
        setHeldError("พบสินค้าที่ถูกลบหรือย้ายสาขา ไม่สามารถเรียกคืนบิลนี้ได้");
        return;
      }
      const currentPrice=bill.direction==="buy"?product.buyPrice:product.sellPrice;
      if(currentPrice===null){
        setHeldError("มีรายการที่ยังไม่กำหนดราคา ไม่สามารถเรียกคืนบิลนี้ได้");
        return;
      }
      const calculated=calculateRecyclingLine(saved.quantity,saved.unit,currentPrice,product.priceBasis);
      if(!calculated){setHeldError("น้ำหนักหรือหน่วยในบิลพักไม่ถูกต้อง");return;}
      priceChanged ||= currentPrice!==saved.unitPrice;
      nextKey.current+=1;
      nextLines.push({
        key:nextKey.current,direction:bill.direction,product,quantity:saved.quantity,
        unit:saved.unit,basisQuantity:calculated.basisQuantity,
        unitPrice:currentPrice,total:calculated.amount
      });
    }
    if(!saveHeldBills(heldBills.filter(item=>item.id!==bill.id)))return;
    requestIdRef.current="";setPosted(null);setPrintNotice(null);
    setDirection(bill.direction);
    setLines(current=>[...current.filter(line=>line.direction!==bill.direction),...nextLines]);
    setHeldOpen(false);setCounterpartyName("");setPostError("");
    setHeldNotice(priceChanged
      ?"เรียกคืนบิลแล้ว · ราคาวัสดุมีการเปลี่ยนแปลง ระบบใช้ราคาปัจจุบัน กรุณาตรวจสอบก่อนรับจ่าย"
      :"เรียกคืนบิลแล้ว กรุณาตรวจสอบน้ำหนักและยอดก่อนชำระ");
  }

  function deleteHeldBill(bill:HeldRecyclingBill){
    if(posting||!canUseShift)return;
    if(!window.confirm("ลบรายการพักบิลนี้? รายการยังไม่ถูกบันทึกเป็นการซื้อขาย"))return;
    saveHeldBills(heldBills.filter(item=>item.id!==bill.id));
  }

  function onBarcodeKeyDown(event:React.KeyboardEvent<HTMLInputElement>){
    if(event.key==="Enter"){
      event.preventDefault();
      if(searchMode==="barcode")scanBarcode(event.currentTarget.value);
      return;
    }
    if(searchMode!=="barcode"||event.ctrlKey||event.altKey||event.metaKey||
       event.nativeEvent.isComposing)return;
    // Hardware scanner sends physical key codes independent of Windows TH/EN.
    // Intercept only when the active layout emitted Thai, leaving shortcuts
    // and navigation intact; pasted Thai codes are normalized on input.
    if(!/[ก-๙]/u.test(event.key))return;
    const latin=physicalRecyclingBarcodeKey(event.code,event.shiftKey);
    if(latin===null)return;
    event.preventDefault();
    const input=event.currentTarget;
    const start=input.selectionStart??input.value.length;
    const end=input.selectionEnd??start;
    const replacement=input.value.slice(0,start)+latin+input.value.slice(end);
    setSearch(replacement);setError("");setCatalogPage(1);
  }

  const units = pending?.priceBasis === "piece" ? (["piece", "stem"] as RecyclingUnit[]) : weightUnits;

  return <main className="recycling-pos-layout flex h-full min-h-0 w-full flex-col overflow-hidden bg-white" data-testid="recycling-custom-pos">
    <RecyclingSalesModeSwitcher storeName={storeName} branchName={branchName}
      deviceCode={deviceCode} sellerName={sellerName} shiftStatus={canUseShift?"เปิดกะแล้ว":shiftGate==="checking"?"กำลังตรวจสอบกะ":"ยังไม่เปิดกะ"}
      generalSaleEnabled={generalSaleEnabled} direction={direction}
      onDirectionChange={changeDirection} busy={posting}/>
    {!canUseShift && <div data-testid="recycling-daily-shift-gate"
      className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/55 px-4 py-8"
      role="dialog" aria-modal="true" aria-labelledby="recycling-shift-gate-title"
      aria-describedby="recycling-shift-gate-message">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-7">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-2xl text-blue-700" aria-hidden="true">♻</div>
        <h2 id="recycling-shift-gate-title" className="text-xl font-extrabold text-slate-900">
          {shiftGate === "checking" ? "กำลังตรวจสอบกะ" : "กรุณาเปิดกะก่อนเริ่มรับซื้อ–ขายออก"}
        </h2>
        <p id="recycling-shift-gate-message" className="mt-3 text-sm leading-6 text-slate-600">{shiftMessage}</p>
        <p className="mt-2 text-xs text-slate-500">ตรวจสอบตามสาขาและเครื่องที่เข้าสู่ระบบ · กะ Recycling แยกจาก POS ทั่วไป</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link href="/preview/pos/shift"
            className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-blue-700 px-4 py-3 text-sm font-bold text-white">
            ไปหน้าเปิด/ปิดกะ
          </Link>
          <button type="button" disabled={shiftGate === "checking"}
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
            ตรวจสอบอีกครั้ง
          </button>
        </div>
      </section>
    </div>}
    {!transactionWritesEnabled && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      ระบบรับซื้อ–ขายออกยังปิดการบันทึกธุรกรรมจริงระหว่างตรวจสอบ Backend ไม่มีรายการสต๊อกหรือบัญชีถูกบันทึก
    </div>}

    <div className="recycling-pos-panels min-h-0 w-full flex-1 overflow-hidden" data-testid="recycling-unified-sales-body">
      <section className="recycling-scanner-panel flex min-h-0 min-w-0 flex-col bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-extrabold text-slate-900">ยิงบาร์โค้ด / ค้นหาวัสดุ</h2>
          <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">{products.length} รายการ</span>
        </div>
        <label className="mt-3 block text-sm font-semibold text-slate-700" htmlFor="recycling-barcode">รหัสสินค้า / SKU</label>
        <input id="recycling-barcode" ref={scannerRef} autoComplete="off" autoFocus disabled={!canUseShift || posting || checkoutOpen}
          className="mt-1 w-full rounded-lg border-2 border-blue-400 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-blue-700"
          placeholder="ยิงบาร์โค้ดแล้วกด Enter" value={search}
          onChange={event => { setSearch(event.target.value); setError(""); }}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); scanBarcode(); } }} />
        {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
        <p className="mt-2 text-xs text-slate-500">ยิงบาร์โค้ดแล้ว Enter: สินค้านับชิ้นเข้าตะกร้าทันที · สินค้าชั่งน้ำหนักให้ยืนยันค่าชั่งก่อน</p>
        <div className="recycling-catalog-scroll mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {filteredProducts.length ? filteredProducts.map(item => {
            const price = direction === "buy" ? item.buyPrice : item.sellPrice;
            return <button type="button" key={item.id} disabled={!canUseShift || posting || checkoutOpen} onClick={() => openQuantityPopup(item)}
              className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left hover:border-blue-200 hover:bg-blue-50">
              <CatalogImage item={item} />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm text-slate-900">{item.name}</strong>
                <span className="block truncate text-xs text-slate-500">{item.sku || "ไม่มีบาร์โค้ด"} · {item.category}</span>
              </span>
              <span className="shrink-0 text-right text-sm font-bold text-blue-800">
                {price === null ? "ยังไม่ตั้งราคา" : `${formatMoney(price)} ฿`}
                <small className="block text-xs font-normal text-slate-500">/{item.priceBasis === "kg" ? "กก." : "ชิ้น"} (ราคาอ้างอิง)</small>
                {price !== null && item.priceUnit !== item.priceBasis && <small className="block text-[11px] font-normal text-blue-600">
                  {formatRecyclingUnitPrice(price,item.priceUnit)} ฿/{RECYCLING_PRICE_UNIT_LABELS[item.priceUnit]}
                </small>}
              </span>
            </button>;
          }) : <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">ไม่พบสินค้าในสต๊อกของสาขา</p>}
        </div>
      </section>

      <section className="recycling-cart-panel flex min-h-0 min-w-0 flex-col bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-slate-900">ตะกร้ารายการ{direction === "buy" ? "รับซื้อ" : "ขายออก"}</h2>
          <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
            disabled={!visibleLines.length || posting || checkoutOpen} onClick={() => { requestIdRef.current = ""; setPosted(null); setLines(current => current.filter(line => line.direction !== direction)); }}>
            ล้างตะกร้า
          </button>
        </div>
        <div className="recycling-cart-scroll mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200" data-testid="recycling-scrollable-cart">
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
        <div className="recycling-summary-dock mt-auto shrink-0 border-t border-slate-200 bg-white pt-3" data-testid="recycling-anchored-summary">
          <div className="flex items-center justify-between rounded-lg bg-blue-50 p-4">
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
            onClick={() => void queueReceiptPrint(posted.id, window.crypto.randomUUID())}>ส่งพิมพ์ใหม่เมื่อยืนยันว่าใบเสร็จเดิมไม่ออก (ไม่บันทึกบิลใหม่)</button>}
          <Link href={`/preview/pos/recycling/receipts/${posted.id}`}
            className="mt-2 block w-fit rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white">
            ดูหลักฐานและพิมพ์ใบรับซื้อ–ขายออก
          </Link>
        </p>}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={() => { setCheckoutOpen(true); setPostError(""); }}
            disabled={!canUseShift || posting || visibleLines.length === 0}
            className="w-auto min-w-[220px] max-w-full rounded-lg bg-blue-700 px-5 py-3 text-sm font-extrabold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
            {direction === "buy" ? "บันทึกใบรับซื้อและเข้าสต๊อก" : "บันทึกขายออกและตัดสต๊อก"}
          </button>
        </div>
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
          <button type="submit" disabled={!canUseShift || !transactionWritesEnabled || posting || settlement === "bank_transfer" || !counterpartyName.trim() || !visibleLines.length}
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
          <div className="flex justify-between gap-2"><span>ราคาฐานที่ใช้คำนวณ</span>
            <strong>{selectedPrice === null ? "—" : formatMoney(selectedPrice)} ฿ /{pending.priceBasis === "kg" ? "กก." : "ชิ้น"}</strong></div>
          {selectedPrice !== null && pending.priceUnit !== pending.priceBasis && <p className="mt-1 text-xs text-blue-800">
            ราคาที่ตั้งในทะเบียน: {formatRecyclingUnitPrice(selectedPrice,pending.priceUnit)} บาท/{RECYCLING_PRICE_UNIT_LABELS[pending.priceUnit]} · ระบบแปลงเป็นหน่วยฐานแล้ว
          </p>}
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
