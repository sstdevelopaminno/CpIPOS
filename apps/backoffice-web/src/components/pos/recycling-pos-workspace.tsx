"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { bangkokLocalDateTime, parseRecyclingDocumentTime } from "@/lib/recycling-document-time";
import { recyclingBusinessDayKey, recyclingShiftIsToday } from "@/lib/recycling-business-day";
import { buildRecyclingBarcodeIndex, resolveRecyclingBarcode } from "@/lib/recycling-barcode-index";
import { normalizeRecyclingBarcodeInput, physicalRecyclingBarcodeKey } from "@/lib/recycling-scanner-keyboard";
import { recyclingCashierShortcutFromCode, RECYCLING_SHORTCUT_DELAY_MS, type RecyclingCashierShortcut } from "@/lib/recycling-cashier-shortcuts";
import { parseRecyclingHeldBills, recyclingHeldKey, type HeldRecyclingBill } from "@/lib/recycling-held-bills";
import { calculateRecyclingLine, recyclingUnitLabel } from "@/lib/recycling-calculation";
import { MAX_RECYCLING_WEIGHT_EXPRESSION_LENGTH, parseRecyclingWeightExpression } from "@/lib/recycling-weight-expression";
import { recyclingVatMinor } from "@/lib/recycling-tax-invoice";
import { priceUnitLabel } from "@/lib/recycling-price-units";
import { formatRecyclingUnitPriceDisplay } from "@/lib/recycling-money-display";
import { recyclingVatBlockerMessage } from "@/lib/recycling-vat-readiness";
import type { RecyclingCatalogItem, RecyclingUnit } from "@/lib/server/recycling-pos-service";
import { RecyclingSalesModeSwitcher } from "@/components/pos/recycling-sales-mode-switcher";
import { RecyclingReceiptDialog } from "@/components/pos/recycling-receipt-dialog";

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

const formatMoney = (amount: number) =>
  new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

function CatalogImage({ item, mediaUrl }: { item: RecyclingCatalogItem; mediaUrl?: string }) {
  const imageUrl=mediaUrl || item.imageUrl;
  return imageUrl
    ? <Image src={imageUrl} alt={item.name} width={54} height={54} unoptimized
        className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-white object-cover" />
    : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xl" aria-hidden="true">♻️</div>;
}

export function RecyclingPosWorkspace({ products, tenantId, branchId, mediaByProduct, branchName, storeName, deviceCode, sellerName, shiftStatus, generalSaleEnabled, transactionWritesEnabled, fastWindowsReceiptEnabled, manualDocumentTimeEnabled = false }: {
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
  fastWindowsReceiptEnabled: boolean;
  manualDocumentTimeEnabled?: boolean;
}) {
  const [shiftGate,setShiftGate]=useState<"checking"|"open"|"blocked">("checking");
  const [shiftOpenedAt,setShiftOpenedAt]=useState("");
  const [shiftId,setShiftId]=useState("");
  const [shiftMessage,setShiftMessage]=useState("กำลังตรวจสอบกะ Recycling ประจำวัน...");
  const [shiftRefreshWarning,setShiftRefreshWarning]=useState("");
  const shiftGateRef=useRef<"checking"|"open"|"blocked">("checking");
  const gateInFlightRef=useRef(false);
  const lastDayRef=useRef(recyclingBusinessDayKey(new Date()));
  const postingRef=useRef(false);
  const rolloverWhilePostingRef=useRef(false);
  const [direction, setDirection] = useState<Direction>("buy");
  const [search, setSearch] = useState("");
  // Synchronous scan buffer: sub-10ms HID bursts must not lose keys while
  // React waits to render each controlled input update.
  const scanBufferRef=useRef("");
  const pendingScannerShortcutRef=useRef<{letter:RecyclingCashierShortcut;timer:number}|null>(null);
  const scanRenderFrameRef=useRef<number|null>(null);
  function updateScannerSearch(next:string,deferRender=false){
    // The synchronous buffer is authoritative during dense HID bursts.
    // Coalesce the visual catalog update into a frame without losing digits.
    scanBufferRef.current=next;
    if(scanRenderFrameRef.current!==null){
      window.cancelAnimationFrame(scanRenderFrameRef.current);
      scanRenderFrameRef.current=null;
    }
    if(deferRender){
      scanRenderFrameRef.current=window.requestAnimationFrame(()=>{
        scanRenderFrameRef.current=null;
        setSearch(scanBufferRef.current);
      });
    }else setSearch(next);
  }
  const [fixedDocumentTime,setFixedDocumentTime]=useState<string|null>(null);
  const [documentTimeOpen,setDocumentTimeOpen]=useState(false);
  const [documentTimeDraft,setDocumentTimeDraft]=useState("");
  const [documentTimeError,setDocumentTimeError]=useState("");
  const documentTimeButtonRef=useRef<HTMLButtonElement>(null);
  const documentTimeInputRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(documentTimeOpen)window.requestAnimationFrame(()=>documentTimeInputRef.current?.focus());},[documentTimeOpen]);
  function closeDocumentTime(){setDocumentTimeOpen(false);window.requestAnimationFrame(()=>documentTimeButtonRef.current?.focus());}
  function applyDocumentTime(){
    if(!manualDocumentTimeEnabled||postingRef.current||requestIdRef.current)return;
    const parsed=parseRecyclingDocumentTime(documentTimeDraft,new Date());
    if(!parsed){setDocumentTimeError("กรุณาระบุวันที่และเวลาที่ถูกต้อง ไม่เกินเวลาปัจจุบัน");return;}
    setFixedDocumentTime(parsed);closeDocumentTime();
  }
  const [searchMode,setSearchMode]=useState<"barcode"|"name">("barcode");
  const [searchPreferencesOpen,setSearchPreferencesOpen]=useState(false);
  const searchPreferencesButtonRef=useRef<HTMLButtonElement>(null);
  const searchPreferencesCloseRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(searchPreferencesOpen) window.requestAnimationFrame(()=>searchPreferencesCloseRef.current?.focus());
  },[searchPreferencesOpen]);
  function selectScannerMode(next:"barcode"|"name"){
    setSearchMode(next);
    updateScannerSearch("");
    setScanFeedback("idle");
    setCatalogPage(1);
    setSearchPreferencesOpen(false);
    window.requestAnimationFrame(()=>scannerRef.current?.focus());
  }
  const [selectedCategory,setSelectedCategory]=useState("all");
  const [catalogPage,setCatalogPage]=useState(1);
  const [error, setError] = useState("");
  const [scanFeedback,setScanFeedback]=useState<"idle"|"success"|"error">("idle");
  const [scanErrorPopup,setScanErrorPopup]=useState("");
  const scanDismissRef=useRef<HTMLButtonElement>(null);
  const shiftTapArmedRef=useRef(false);
  const [pending, setPending] = useState<RecyclingCatalogItem | null>(null);
  const [unit, setUnit] = useState<RecyclingUnit>("kg");
  const [quantity, setQuantity] = useState("1");
  const quantityInputRef=useRef<HTMLInputElement>(null);
  const quantityCommittedRef=useRef(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [heldBills,setHeldBills]=useState<HeldRecyclingBill[]>([]);
  const [heldOpen,setHeldOpen]=useState(false);
  const [cancelOpen,setCancelOpen]=useState(false);
  const [cancelChoice,setCancelChoice]=useState<"keep"|"confirm">("confirm");
  const cancelConfirmRef=useRef<HTMLButtonElement>(null);
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
  const [vatQuote,setVatQuote]=useState<{
    configured:boolean;rollout_enabled:boolean;ready:boolean;
    rate_pct:number;mode:string;reason:string|null;blockers?:string[];
  }|null>(null);
  const [vatQuoteLoading,setVatQuoteLoading]=useState(false);
  const [posted, setPosted] = useState<{ id: string; receipt_no?: string; total_minor: number; printRequestId: string } | null>(null);
  const [receiptDialogOpen,setReceiptDialogOpen]=useState(false);
  const requestIdRef = useRef("");
  const nextKey = useRef(0);
  const scannerRef = useRef<HTMLInputElement>(null);
  const cashMethodRef=useRef<HTMLInputElement>(null);
  const heldCloseRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>()=> {
    if(pendingScannerShortcutRef.current)window.clearTimeout(pendingScannerShortcutRef.current.timer);
    if(scanRenderFrameRef.current!==null)window.cancelAnimationFrame(scanRenderFrameRef.current);
  },[]);
  useEffect(()=>{if(heldOpen)heldCloseRef.current?.focus();},[heldOpen]);
  useEffect(()=>{if(scanErrorPopup)scanDismissRef.current?.focus();},[scanErrorPopup]);
  useEffect(()=>{if(cancelOpen)cancelConfirmRef.current?.focus();},[cancelOpen]);
  useEffect(()=>{if(checkoutOpen)cashMethodRef.current?.focus();},[checkoutOpen]);
  useEffect(()=>{postingRef.current=posting;},[posting]);
  const canUseShift=shiftGate==="open" && recyclingShiftIsToday(shiftOpenedAt);
  useEffect(() => {
    let mounted = true;
    async function checkShift() {
      if (gateInFlightRef.current) return;
      gateInFlightRef.current = true;
      // Refresh a previously verified shift in place. Never remount a
      // fullscreen "checking" dialog during tab focus / revalidation.
      // The server-side transaction RPC still authoritatively checks the
      // shift state before any cash or stock write.
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
          shiftGateRef.current="open";
          setShiftGate("open");
          setShiftRefreshWarning("");
          setShiftMessage("กะ Recycling เปิดแล้ว");
        } else {
          // Explicit 404/no shift, needs_join, expired day, or a verified
          // business conflict must block checkout. Transient 5xx/transport
          // failures must not falsely label an already verified shift closed.
          if(!response.ok && response.status>=500 && shiftGateRef.current==="open"){
            setShiftRefreshWarning("ยังตรวจสอบสถานะกะล่าสุดไม่ได้ ระบบจะตรวจใหม่เมื่อกลับเข้าหน้าต่าง");
          }else{
            setShiftOpenedAt("");
            setShiftId("");
            shiftGateRef.current="blocked";
            setShiftGate("blocked");
            setShiftRefreshWarning("");
            setShiftMessage(result?.data?.needs_join
              ? "กะ Recycling เปิดแล้ว แต่บัญชีผู้ใช้นี้ยังไม่ได้เข้าร่วมกะบนเครื่องนี้ กรุณาไปเมนูเปิด/ปิดกะเพื่อเข้าร่วม"
              : result?.error?.message ?? result?.data?.message ??
                "ยังไม่ได้เปิดกะวันนี้ กรุณาไปที่เมนูเปิด/ปิดกะ");
          }
        }
      } catch {
        if (mounted) {
          if(shiftGateRef.current==="open"){
            setShiftRefreshWarning("เครือข่ายขัดข้อง ยังยืนยันสถานะกะครั้งล่าสุดไม่ได้");
          }else{
            shiftGateRef.current="blocked";
            setShiftGate("blocked");
            setShiftOpenedAt("");
            setShiftId("");
            setShiftMessage("ไม่สามารถตรวจสอบสถานะกะได้ กรุณาลองอีกครั้ง");
          }
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
          setFixedDocumentTime(null);setDocumentTimeOpen(false);
          requestIdRef.current = ""; setPosted(null);
        }
        shiftGateRef.current="checking";
        setShiftGate("checking"); setShiftOpenedAt(""); setShiftId("");
        setShiftRefreshWarning("");
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
  // Sum satang, not floating-point baht: 0.10 + 0.20 must remain 0.30.
  const total = Number(visibleLines.reduce((sum,line)=>sum+BigInt(Math.round(line.total*100)),0n))/100;
  const baseMinor=Math.round(total*100);
  const vatApplied=direction==="sell" && vatQuote?.configured===true &&
    vatQuote.ready===true && vatQuote.rate_pct===7;
  const vatPreviewMinor=vatApplied?recyclingVatMinor(baseMinor,7):0;
  const grossPreviewMinor=baseMinor+vatPreviewMinor;
  const saleVatReady=direction==="buy" ||
    (vatQuote!==null&&vatQuote.ready&&(!vatQuote.configured||
      vatQuote.rate_pct===7));
  const categories=useMemo(()=>Array.from(new Set(products.map(item=>item.category)))
    .sort((a,b)=>a.localeCompare(b,"th")), [products]);
  // Sorting 1,000 product cards for every scanner character stalls checkout.
  const sortedProducts=useMemo(()=>[...products].sort((a,b)=>a.name.localeCompare(b.name,"th")),[products]);
  const filteredProducts=useMemo(()=>{
    const needle=search.trim().toLocaleLowerCase();
    return sortedProducts.filter(item=>{
      const matchesCategory=selectedCategory==="all"||item.category===selectedCategory;
      const matchesSearch=!needle || (searchMode==="barcode"
        ? item.sku.toLocaleLowerCase().includes(needle)
        : [item.name,item.category,item.sku].some(value=>value.toLocaleLowerCase().includes(needle)));
      return matchesCategory&&matchesSearch;
    });
  },[sortedProducts,search,searchMode,selectedCategory]);
  const pageSize=12;
  const pageCount=Math.max(1,Math.ceil(filteredProducts.length/pageSize));
  const currentPage=Math.min(catalogPage,pageCount);
  const pageItems=filteredProducts.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const pageStart=Math.max(1,Math.min(currentPage-2,pageCount-4));
  const paginationPages=Array.from({length:Math.min(5,pageCount)},(_,i)=>pageStart+i);
  const storageKey=useMemo(()=>recyclingHeldKey(tenantId,branchId,deviceCode,shiftId),
    [tenantId,branchId,deviceCode,shiftId]);
  const selectedPrice = pending ? (direction === "buy" ? pending.buyPrice : pending.sellPrice) : null;
  const weightedQuantity=pending?.priceBasis==="kg";
  const weightTotal=weightedQuantity?parseRecyclingWeightExpression(quantity,unit):null;
  const resolvedQuantity=weightedQuantity?weightTotal?.quantity??null:quantity.trim()?Number(quantity):null;
  const preview=pending&&selectedPrice!==null&&resolvedQuantity!==null
    ?calculateRecyclingLine(resolvedQuantity,unit,selectedPrice,pending.priceBasis):null;

  function openQuantityPopup(item: RecyclingCatalogItem) {
    if (posting || checkoutOpen) return;
    const price = direction === "buy" ? item.buyPrice : item.sellPrice;
    if (price === null) {
      setError(`กรุณากำหนดราคา${direction === "buy" ? "รับซื้อ" : "ขายออก"}ของ "${item.name}" ในสต๊อกก่อน`);
      scannerRef.current?.focus();
      return;
    }
    setError("");
    quantityCommittedRef.current=false;
    setPending(item);
    // Material catalogue config is authoritative: no discretionary unit
    // switching in the cashier, avoiding wrong kg/khid/g amounts.
    setUnit(item.priceUnit);
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
      if (existing < 0 || product.priceBasis !== "piece") {
        return [...current, {
          key: nextKey.current, direction, product, unit: selectedUnit,
          quantity: selectedQuantity, basisQuantity: calculated.basisQuantity,
          unitPrice: price, total: calculated.amount
        }];
      }
      return current.map((line, index) => {
        if(index!==existing)return line;
        // Recalculate from the full count, rather than accumulating rounded
        // floating-point totals over hundreds of repeated scans.
        const nextQuantity=line.quantity+selectedQuantity;
        const next=calculateRecyclingLine(nextQuantity,selectedUnit,price,product.priceBasis);
        return next?{...line,quantity:nextQuantity,basisQuantity:next.basisQuantity,total:next.amount}:line;
      });
    });
  }

  function scanBarcode(value:string=search) {
    if (posting || checkoutOpen) return;
    const normalized=normalizeRecyclingBarcodeInput(value);
    updateScannerSearch(normalized);
    const result = resolveRecyclingBarcode(barcodeIndex, normalized);
    if (result.status !== "found") {
      const message=result.status==="duplicate"
        ?"บาร์โค้ดนี้ซ้ำกัน กรุณาให้ผู้จัดการตรวจสอบทะเบียนสินค้า"
        :"ไม่พบบาร์โค้ดนี้ในสต๊อกของสาขา กรุณาตรวจสอบรหัสและยิงใหม่";
      setError(message);
      setScanFeedback("error");
      setScanErrorPopup(message);
      return;
    }
    const product = result.item;
    const price = direction === "buy" ? product.buyPrice : product.sellPrice;
    if (price === null) {
      const message="ยังไม่ได้กำหนดราคาในสต๊อกสำหรับรายการนี้ กรุณาตรวจสอบทะเบียนวัสดุ";
      setError(message);setScanFeedback("error");setScanErrorPopup(message);
      return;
    }
    setScanFeedback("success");
    updateScannerSearch("");
    setError("");
    if (product.priceBasis === "piece") {
      // Barcode scanners terminate with Enter; a counted item has an exact
      // unambiguous quantity of one, so add immediately like ordinary POS.
      addLineToCart(product, product.priceUnit, 1, price);
      scannerRef.current?.focus();
    } else {
      // Weighted materials require the actual scale reading. Never invent
      // kilograms or silently authorize a payment from a barcode alone.
      openQuantityPopup(product);
    }
  }

  function calculateWeightInPlace(raw=quantity){
    if(!weightedQuantity)return;
    const result=parseRecyclingWeightExpression(raw,unit);
    if(result)setQuantity(result.display);
    window.requestAnimationFrame(()=>quantityInputRef.current?.focus());
  }
  function appendWeightPlus(){
    if(!weightedQuantity)return;
    const raw=quantity.trim();
    const result=parseRecyclingWeightExpression(raw,unit);
    const next=raw.endsWith("=")?result?.display??"":raw;
    if(next&&result&&next.length<MAX_RECYCLING_WEIGHT_EXPRESSION_LENGTH)setQuantity(next+"+");
    window.requestAnimationFrame(()=>quantityInputRef.current?.focus());
  }
  function addToCart(raw=quantity) {
    if(posting||checkoutOpen||!pending||selectedPrice===null||quantityCommittedRef.current)return;
    const resolved=pending.priceBasis==="kg"
      ?parseRecyclingWeightExpression(raw,unit)?.quantity??null
      :raw.trim()?Number(raw):null;
    if(resolved===null||!calculateRecyclingLine(resolved,unit,selectedPrice,pending.priceBasis))return;
    quantityCommittedRef.current=true;
    addLineToCart(pending,unit,resolved,selectedPrice);
    setPending(null);
    setQuantity("");
    updateScannerSearch("");
    setError("");
    window.setTimeout(() => scannerRef.current?.focus(), 0);
  }

  function closeScanErrorPopup(){
    setScanErrorPopup("");
    setError("");
    updateScannerSearch("");
    window.requestAnimationFrame(()=>scannerRef.current?.focus());
  }
  function openCancelConfirmation(){
    if(posting||checkoutOpen||!visibleLines.length)return;
    setCancelChoice("confirm");
    setCancelOpen(true);
  }
  function removeLastCartLine(){
    if(posting||checkoutOpen||!visibleLines.length)return;
    const latest=visibleLines[visibleLines.length-1];
    requestIdRef.current="";setPosted(null);setPrintNotice(null);
    setLines(current=>current.filter(line=>line.key!==latest.key));
    setHeldNotice("ลบรายการล่าสุดออกจากตะกร้าแล้ว");
  }
  async function refreshVatQuote(){
    setVatQuoteLoading(true);setVatQuote(null);
    try{
      const response=await fetch("/api/pos/recycling/vat/quote",{
        credentials:"same-origin",cache:"no-store"
      });
      const result=await response.json().catch(()=>null) as {
        data?:{configured:boolean;rollout_enabled:boolean;ready:boolean;rate_pct:number;mode:string;reason:string|null;blockers?:string[]};
        error?:{message?:string};
      }|null;
      if(!response.ok||!result?.data)throw Error(result?.error?.message??"VAT settings unavailable");
      setVatQuote(result.data);
    }catch{
      setVatQuote(null);
      setPostError("ยังตรวจสอบ VAT ของสาขาไม่ได้ กรุณาตรวจสอบระบบก่อนยืนยันบิล");
    }finally{setVatQuoteLoading(false);}
  }
  function openCheckout(){
    if(!canUseShift||posting||!visibleLines.length)return;
    setCheckoutOpen(true);setSettlement("cash");setPostError("");
    if(direction==="sell")void refreshVatQuote();
  }

  function changeDirection(next: Direction) {
    if (posting || checkoutOpen || next === direction) return;
    setDirection(next);
    updateScannerSearch("");
    setError("");
    setPending(null);
    setCheckoutOpen(false);
    setSettlement("cash");
    setCatalogPage(1);
    setPostError("");
  }

  function openHeldBills(){
    if(!canUseShift||posting||pending||checkoutOpen||cancelOpen||heldOpen||scanErrorPopup)return;
    setHeldError("");
    setHeldOpen(true);
  }
  function activateRecyclingShortcut(shortcut:RecyclingCashierShortcut){
    if(!canUseShift||posting||pending||checkoutOpen||cancelOpen||heldOpen||scanErrorPopup)return;
    if(shortcut==="w")openHeldBills();
    else changeDirection(shortcut==="a"?"buy":"sell");
  }
  function flushPendingScannerShortcut(){
    const pendingShortcut=pendingScannerShortcutRef.current;
    if(!pendingShortcut)return;
    window.clearTimeout(pendingShortcut.timer);
    pendingScannerShortcutRef.current=null;
    // Second character or Enter arrived: it was a barcode, not W/A/D.
    updateScannerSearch(scanBufferRef.current+pendingShortcut.letter,true);
  }

  async function queueReceiptPrint(transactionId: string, requestId: string) {
    if (printing) return;
    setPrinting(true);
    setPrintNotice(null);
    // Prime a short claim burst while the server enqueues the receipt.
    // This runs only for an explicitly enrolled Windows test printer.
    if (fastWindowsReceiptEnabled) {
      window.dispatchEvent(new Event("cpi-windows-print-agent-wake"));
    }
    try {
      const response = await fetch(
        "/api/pos/recycling/receipts/" + transactionId + "/print", {
          method:"POST", credentials:"same-origin",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({request_id:requestId})
        }
      );
      const result = await response.json().catch(() => null) as {
        data?: {queued?:boolean; jobs?:Array<{status?:string;fast_wake?:boolean}>};
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
      // The job now exists; claim it immediately rather than waiting for the
      // agent's normal 12–30 second idle polling interval.
      if (jobs.some(job=>job.fast_wake===true)) {
        window.dispatchEvent(new Event("cpi-windows-print-agent-wake"));
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
    if (postingRef.current || posting || !canUseShift || !transactionWritesEnabled || !checkoutOpen || !visibleLines.length) return;
    if(direction==="sell"&&!saleVatReady){
      setPostError("ยังตรวจสอบภาษีขายไม่ผ่าน ไม่สามารถบันทึกรับชำระเงินได้");return;
    }
    if (settlement === "bank_transfer") {
      setPostError("ต้องตรวจหลักฐานธนาคารก่อนจึงจะยืนยันการจ่ายหรือรับเงินโอนได้");
      return;
    }
    // Synchronous guard prevents rapid Enter/click from submitting twice
    // before React applies the first 'posting' state update.
    postingRef.current=true;
    setPosting(true);
    setPostError("");
    setPosted(null);
    setReceiptDialogOpen(false);
    if (!requestIdRef.current) requestIdRef.current = window.crypto.randomUUID();
    const currentRequestId = requestIdRef.current;
    try {
      const response = await fetch("/api/pos/recycling/transactions", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: currentRequestId, direction, settlement,
          ...(fixedDocumentTime?{document_time:bangkokLocalDateTime(new Date(fixedDocumentTime))}:{}),
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
          recycling_subscription_inactive: "สัญญา CUSTOM Recycling ยังไม่พร้อมใช้งาน",
          recycling_cash_drawer_insufficient: "เงินสดในกะไม่เพียงพอสำหรับจ่ายซื้อวัสดุ กรุณาตรวจนับและกระทบยอดเงินสดกับผู้จัดการก่อนทำรายการ ห้ามจ่ายเงินหรือบันทึกซ้ำ",
          recycling_shift_opening_cash_invalid: "ยอดเงินสดต้นกะไม่ถูกต้อง กรุณาให้ผู้จัดการตรวจสอบ",
          recycling_mixed_legacy_shift_requires_reconciliation: "มีกะ POS ทั่วไปปะปนอยู่ กรุณาให้ฝ่าย IT ตรวจสอบกะก่อนบันทึก",
          recycling_request_key_reused: "พบการส่งบิลด้วยรหัสเดิมแต่รายละเอียดเปลี่ยน กรุณาตรวจสอบใบรับซื้อก่อนทำรายการใหม่",
          recycling_branch_invalid: "สาขาที่กำลังใช้งานไม่พร้อมรับซื้อ–ขายออก",
          recycling_user_not_in_branch: "บัญชีผู้ใช้งานไม่ได้รับสิทธิ์ทำรายการในสาขานี้",
          recycling_ledger_not_balanced: "การตรวจสอบบัญชีไม่ผ่าน ระบบไม่ได้บันทึกบิล กรุณาติดต่อฝ่ายบัญชีหรือ IT",
          recycling_vat_registration_not_verified:"ร้านยังไม่มีหลักฐานจดทะเบียน VAT ที่ผ่านการยืนยัน ห้ามออกใบกำกับภาษี",
          recycling_vat_account_not_ready:"ยังไม่ได้ตั้งบัญชีภาษีขาย 2200 ในผังบัญชี",
          recycling_vat_settings_invalid:"การตั้งค่า VAT ของสาขาไม่ถูกต้อง กรุณาให้ฝ่ายบัญชีตรวจสอบ",
          recycling_vat_settings_unsupported:"รองรับ VAT 7% แบบบวกเพิ่มในบิลเพียงหนึ่งรายการเท่านั้น"
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
      setReceiptDialogOpen(true);
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
      postingRef.current=false;
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
      setHeldOpen(false);setCancelOpen(false);setFixedDocumentTime(null);setDocumentTimeOpen(false);
    }
    previousShiftId.current=shiftId;
    try{
      setHeldBills(parseRecyclingHeldBills(window.localStorage.getItem(storageKey),shiftId));
    }catch{setHeldBills([]);}
  },[shiftId,storageKey]);

  function saveHeldBills(next:HeldRecyclingBill[]):boolean{
    if(!canUseShift || !shiftId)return false;
    if(next.length>30){
      setHeldError("รายการพักบิลครบ 30 บิลแล้ว กรุณาเรียกคืนหรือเคลียร์บิลก่อนพักเพิ่ม");
      return false;
    }
    try{
      window.localStorage.setItem(storageKey,JSON.stringify(next));
      setHeldBills(next);
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
      documentTime:fixedDocumentTime,
      lines:visibleLines.map(line=>({
        productId:line.product.id,unit:line.unit,quantity:line.quantity,unitPrice:line.unitPrice
      }))
    };
    if(!saveHeldBills([draft,...heldBills]))return;
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
    const savedTime=bill.documentTime??null;
    if(savedTime&&!manualDocumentTimeEnabled){setHeldError("โหมดวันที่ย้อนหลังยังไม่เปิดใช้งาน ไม่สามารถเรียกคืนบิลนี้ได้");return;}
    if(savedTime!==fixedDocumentTime&&lines.some(line=>line.direction!==bill.direction)){setHeldError("กรุณาจัดการตะกร้าอีกประเภทก่อนเรียกคืนบิลที่ใช้วันที่ต่างกัน");return;}
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
    setDirection(bill.direction);setFixedDocumentTime(savedTime);
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

  function onBarcodeKeyDown(event:KeyboardEvent<HTMLInputElement>){
    if(scanErrorPopup){
      if(event.key==="Enter"||event.key==="Escape"){
        event.preventDefault();closeScanErrorPopup();
      }
      return;
    }
    if(event.key==="Escape"&&pendingScannerShortcutRef.current){
      event.preventDefault();
      window.clearTimeout(pendingScannerShortcutRef.current.timer);
      pendingScannerShortcutRef.current=null;
      return;
    }
    if(event.repeat&&pendingScannerShortcutRef.current){
      event.preventDefault();
      return;
    }
    const shortcut=recyclingCashierShortcutFromCode(event.code);
    if(searchMode==="barcode"&&shortcut&&!event.repeat&&!event.shiftKey&&
       !event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.nativeEvent.isComposing&&
       !scanBufferRef.current&&!pendingScannerShortcutRef.current){
      // A scanned W123/A123/D123 starts with the same physical key as a
      // shortcut. Only treat a lone idle key as an action after a short pause.
      // Enter (including one-character barcode W) flushes into the scan.
      event.preventDefault();
      const timer=window.setTimeout(()=>{
        if(pendingScannerShortcutRef.current?.timer!==timer)return;
        pendingScannerShortcutRef.current=null;
        if(document.activeElement===scannerRef.current)activateRecyclingShortcut(shortcut);
      },RECYCLING_SHORTCUT_DELAY_MS);
      pendingScannerShortcutRef.current={letter:shortcut,timer};
      return;
    }
    if(pendingScannerShortcutRef.current)flushPendingScannerShortcut();
    // If the scanner field is empty, Numpad +/- are POS actions; if a
    // barcode is being entered they are barcode characters instead.
    if(!scanBufferRef.current && !event.repeat &&
       (event.code==="NumpadAdd"||event.code==="NumpadSubtract"))return;
    if(event.key==="Enter"){
      event.preventDefault();
      if(searchMode==="barcode")scanBarcode(scanBufferRef.current || event.currentTarget.value);
      return;
    }
    if(searchMode!=="barcode"||event.ctrlKey||event.altKey||event.metaKey||
       event.nativeEvent.isComposing)return;
    // Hardware scanner sends physical key codes independent of Windows TH/EN.
    // Decode ALL printable physical keys, including Thai-layout "/" on Digit2
    // and "-" on Digit3, while preserving navigation and modifier shortcuts.
    // This makes scan-mode English throughout without changing OS language.
    const latin=physicalRecyclingBarcodeKey(event.code,event.shiftKey);
    if(latin===null)return;
    event.preventDefault();
    const input=event.currentTarget;
    const current=input.value;
    const base=scanBufferRef.current;
    const cursorAtEnd=input.selectionStart===current.length && input.selectionEnd===current.length;
    const start=cursorAtEnd?base.length:(input.selectionStart??base.length);
    const end=cursorAtEnd?base.length:(input.selectionEnd??start);
    const replacement=base.slice(0,start)+latin+base.slice(end);
    updateScannerSearch(replacement,true);setError("");setCatalogPage(1);
    setScanFeedback("idle");
  }

  // Only CUSTOM Recycling owns these shortcuts; the normal POS package and
  // browser shortcuts never install global keyboard handlers.
  function onWorkspaceKeyDown(event:KeyboardEvent<HTMLElement>){
    if(event.defaultPrevented||event.nativeEvent.isComposing)return;
    if(documentTimeOpen){shiftTapArmedRef.current=false;if(event.key==="Escape"){event.preventDefault();event.stopPropagation();closeDocumentTime();}return;}
    if(searchPreferencesOpen){
      if(event.key==="Escape"){
        event.preventDefault();event.stopPropagation();
        setSearchPreferencesOpen(false);
        window.requestAnimationFrame(()=>searchPreferencesButtonRef.current?.focus());
      }
      return;
    }
    if(event.key==="Escape"){
      if(posting)return; // never dismiss an in-flight payment
      if(!scanErrorPopup&&!pending&&!checkoutOpen&&!cancelOpen&&!heldOpen)return;
      event.preventDefault();event.stopPropagation();
      if(scanErrorPopup){closeScanErrorPopup();return;}
      if(cancelOpen)setCancelOpen(false);
      else if(heldOpen)setHeldOpen(false);
      else if(checkoutOpen)setCheckoutOpen(false);
      else if(pending){setPending(null);setQuantity("");}
      window.requestAnimationFrame(()=>scannerRef.current?.focus());
      return;
    }
    if(event.key==="Shift"){
      // Standalone Shift is a checkout shortcut only while the cashier is idle.
      // Never open checkout while the operator is editing another input,
      // including Thai/English material-name search.
      const shiftTarget=event.target instanceof HTMLElement?event.target:null;
      const shiftEditable=Boolean(shiftTarget?.closest("input,textarea,select,[contenteditable='true']"));
      const shiftIdleScanner=shiftTarget?.id==="recycling-barcode" && searchMode==="barcode" &&
        !scanBufferRef.current.trim();
      shiftTapArmedRef.current=!event.repeat&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&
        (!shiftEditable||shiftIdleScanner) &&
        !pending&&!checkoutOpen&&!cancelOpen&&!heldOpen&&!scanErrorPopup;
      return;
    }
    // A Shift+letter scanner HID sequence must NOT be mistaken for Shift tap.
    if(shiftTapArmedRef.current)shiftTapArmedRef.current=false;
    if(event.repeat||event.ctrlKey||event.altKey||event.metaKey ||
       posting||!canUseShift || scanErrorPopup || pending||checkoutOpen||heldOpen||cancelOpen)return;
    const target=event.target instanceof HTMLElement?event.target:null;
    const editable=Boolean(target?.closest("input,textarea,select,[contenteditable='true']"));
    const idleScanner=target?.id==="recycling-barcode" && searchMode==="barcode" &&
      !scanBufferRef.current.trim();
    if(editable&&!idleScanner)return;
    const shortcut=recyclingCashierShortcutFromCode(event.code);
    if(shortcut&&!event.shiftKey&&!scanBufferRef.current.trim()){
      event.preventDefault();
      activateRecyclingShortcut(shortcut);
      return;
    }
    if(event.key==="Delete" && visibleLines.length){
      event.preventDefault();
      openCancelConfirmation();
    }else if(event.code==="NumpadSubtract" && visibleLines.length){
      event.preventDefault();
      removeLastCartLine();
    }else if(event.code==="NumpadAdd" && visibleLines.length){
      event.preventDefault();
      parkCurrentBill();
    }
  }

  function onWorkspaceKeyUp(event:KeyboardEvent<HTMLElement>){
    if(event.key!=="Shift")return;
    const tap=shiftTapArmedRef.current;
    shiftTapArmedRef.current=false;
    if(tap && !documentTimeOpen && !event.ctrlKey&&!event.altKey&&!event.metaKey &&
       !scanBufferRef.current.trim()&&canUseShift&&!posting &&
       !pending&&!checkoutOpen&&!cancelOpen&&!heldOpen&&!scanErrorPopup&&visibleLines.length){
      event.preventDefault();
      openCheckout();
    }
  }

  return <main className="recycling-pos-layout flex h-full min-h-0 w-full flex-col overflow-hidden bg-white"
    data-testid="recycling-custom-pos" onKeyDown={onWorkspaceKeyDown} onKeyUp={onWorkspaceKeyUp}>
    <RecyclingSalesModeSwitcher storeName={storeName} branchName={branchName}
      deviceCode={deviceCode} sellerName={sellerName} shiftStatus={canUseShift?"เปิดกะแล้ว":shiftGate==="checking"?"กำลังตรวจสอบกะ":"ยังไม่เปิดกะ"}
      generalSaleEnabled={generalSaleEnabled} direction={direction}
      onDirectionChange={changeDirection} busy={posting}
      heldCount={heldBills.length} onOpenHeldBills={openHeldBills} fixedDocumentTime={fixedDocumentTime}/>
    {shiftGate==="checking" && <div role="status" data-testid="recycling-shift-inline-check"
      className="mx-3 mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900">
      กำลังตรวจสอบสถานะกะ Recycling · ระบบยังไม่อนุญาตให้บันทึกรายการจนกว่าจะตรวจสอบสำเร็จ
    </div>}
    {shiftRefreshWarning&&shiftGate==="open"&&<div role="status"
      data-testid="recycling-shift-refresh-warning"
      className="mx-3 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
      {shiftRefreshWarning} · บันทึกธุรกรรมต้องผ่านการตรวจสอบกะจาก Server ทุกครั้ง
    </div>}
    {shiftGate==="blocked" && <div data-testid="recycling-daily-shift-gate"
      className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/55 px-4 py-8"
      role="dialog" aria-modal="true" aria-labelledby="recycling-shift-gate-title"
      aria-describedby="recycling-shift-gate-message">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-7">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-2xl text-blue-700" aria-hidden="true">♻</div>
        <h2 id="recycling-shift-gate-title" className="text-xl font-extrabold text-slate-900">
          กรุณาตรวจสอบสถานะกะก่อนเริ่มรับซื้อ–ขายออก
        </h2>
        <p id="recycling-shift-gate-message" className="mt-3 text-sm leading-6 text-slate-600">{shiftMessage}</p>
        <p className="mt-2 text-xs text-slate-500">ตรวจสอบตามสาขาและเครื่องที่เข้าสู่ระบบ · กะ Recycling แยกจาก POS ทั่วไป</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link href="/preview/pos/shift"
            className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-blue-700 px-4 py-3 text-sm font-bold text-white">
            ไปหน้าเปิด/ปิดกะ
          </Link>
          <button type="button"
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-slate-900">ยิงบาร์โค้ด / ค้นหาวัสดุ</h2>
          <div className="flex flex-wrap items-center gap-2">
            {manualDocumentTimeEnabled&&<button type="button" ref={documentTimeButtonRef} data-testid="recycling-manual-document-time" aria-haspopup="dialog" aria-expanded={documentTimeOpen} disabled={!canUseShift||posting||checkoutOpen} onClick={()=>{if(requestIdRef.current){setError("กรุณาตรวจสอบหรือยืนยันบิลเดิมก่อนเปลี่ยนวันที่");return;}setDocumentTimeDraft(bangkokLocalDateTime(fixedDocumentTime?new Date(fixedDocumentTime):new Date()));setDocumentTimeError("");setDocumentTimeOpen(true);}} className={"inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 py-1 text-xs font-bold disabled:opacity-50 "+(fixedDocumentTime?"border-amber-400 bg-amber-100 text-amber-900":"border-blue-200 bg-blue-50 text-blue-800")}>
              <span aria-hidden="true">▦</span> {fixedDocumentTime?"วันที่ย้อนหลัง (เปิด)":"เปลี่ยนวันที่ย้อนหลัง"}</button>}
            <button type="button" ref={searchPreferencesButtonRef}
              data-testid="recycling-scanner-search-settings"
              aria-haspopup="dialog" aria-expanded={searchPreferencesOpen}
              onClick={()=>setSearchPreferencesOpen(true)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-100">
              <span aria-hidden="true">⚙</span> ตั้งค่าค้นหา
            </button>
          <span data-testid="recycling-scanner-feedback" role="status" aria-live="polite"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">
            <span aria-hidden="true" className={"h-2.5 w-2.5 rounded-full " +
              (scanFeedback==="success"?"bg-emerald-500 ring-2 ring-blue-100":
                scanFeedback==="error"?"bg-rose-600 ring-2 ring-rose-100":"bg-slate-300")}/>
            {products.length} รายการ
            <span className="sr-only">{scanFeedback==="success"?"สแกนสำเร็จ":scanFeedback==="error"?"สแกนผิดพลาด":"พร้อมสแกน"}</span>
          </span>
          </div>
        </div>
        {fixedDocumentTime&&<p role="status" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900">กำหนดวันเวลาเอกสาร: {new Date(fixedDocumentTime).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})} · ใช้จนกว่าจะกลับเป็นอัตโนมัติหรือเปลี่ยนกะ</p>}
        {documentTimeOpen&&<div role="presentation" className="fixed inset-0 z-[1760] flex items-center justify-center bg-slate-950/70 p-4">
          <form role="dialog" aria-modal="true" aria-labelledby="recycling-document-time-title" data-testid="recycling-document-time-dialog" className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onSubmit={event=>{event.preventDefault();applyDocumentTime();}}>
            <h2 id="recycling-document-time-title" className="text-lg font-extrabold">เปลี่ยนวันที่ย้อนหลัง</h2>
            <p className="mt-2 text-xs text-slate-600">กำหนดวันและเวลาเอกสารรับซื้อหรือขายออก (เวลาไทย) โดยไม่เปลี่ยนกะและเวลาที่บันทึกจริง</p>
            <label htmlFor="recycling-document-time" className="mt-4 block text-sm font-bold">วันที่และเวลาเอกสาร</label>
            <input id="recycling-document-time" ref={documentTimeInputRef} type="datetime-local" step={1} required max={bangkokLocalDateTime(new Date())} value={documentTimeDraft} onChange={event=>setDocumentTimeDraft(event.target.value)} className="mt-2 w-full rounded-md border border-slate-300 p-3"/>
            {documentTimeError&&<p role="alert" className="mt-2 text-sm text-rose-700">{documentTimeError}</p>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={closeDocumentTime} className="rounded border px-3 py-2 text-sm">ปิด</button>
              <button type="button" onClick={()=>{if(!requestIdRef.current&&!postingRef.current){setFixedDocumentTime(null);closeDocumentTime();}}} className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800">กลับเป็นอัตโนมัติ</button>
              <button type="submit" className="rounded bg-blue-700 px-3 py-2 text-sm font-bold text-white">ใช้วันที่นี้</button>
            </div>
          </form></div>}
        {searchPreferencesOpen&&<div role="presentation" className="fixed inset-0 z-[1760] flex items-center justify-center bg-slate-950/70 p-4"
          onMouseDown={event=>{if(event.target===event.currentTarget){setSearchPreferencesOpen(false);searchPreferencesButtonRef.current?.focus();}}}>
          <section role="dialog" aria-modal="true" aria-labelledby="recycling-scanner-search-settings-title"
            data-testid="recycling-scanner-search-settings-modal"
            onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setSearchPreferencesOpen(false);searchPreferencesButtonRef.current?.focus();}else event.stopPropagation();}}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h3 id="recycling-scanner-search-settings-title" className="text-base font-extrabold">วิธีค้นหาวัสดุ</h3>
              <button type="button" ref={searchPreferencesCloseRef} onClick={()=>{setSearchPreferencesOpen(false);searchPreferencesButtonRef.current?.focus();}}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">ปิด (Esc)</button>
            </div>
            <p className="mt-2 text-sm text-slate-600">เลือกวิธีค้นหาเพื่อใช้งานในช่องค้นหาเดิมของหน้าขาย</p>
            <div className="mt-4 grid gap-3">
              <button type="button" aria-pressed={searchMode==="barcode"}
                onClick={()=>selectScannerMode("barcode")}
                className={"min-h-12 rounded-lg border px-4 py-3 text-left text-sm font-bold "+(searchMode==="barcode"?"border-blue-600 bg-blue-600 text-white":"border-slate-300 bg-white text-slate-800")}>
                สแกนบาร์โค้ด (EN อัตโนมัติ)
              </button>
              <button type="button" aria-pressed={searchMode==="name"}
                onClick={()=>selectScannerMode("name")}
                className={"min-h-12 rounded-lg border px-4 py-3 text-left text-sm font-bold "+(searchMode==="name"?"border-blue-600 bg-blue-600 text-white":"border-slate-300 bg-white text-slate-800")}>
                ค้นหาชื่อวัสดุ (ไทย/อังกฤษ)
              </button>
            </div>
          </section>
        </div>}
        <span data-testid="recycling-search-mode-label" className="mt-2 text-xs font-semibold text-slate-500">
          โหมดปัจจุบัน: {searchMode==="barcode"?"สแกนบาร์โค้ด (EN อัตโนมัติ)":"ค้นหาชื่อวัสดุ (ไทย/อังกฤษ)"}
        </span>
        <label className="mt-2 block text-sm font-semibold text-slate-700" htmlFor="recycling-barcode">
          {searchMode==="barcode"?"รหัสสินค้า / SKU":"ชื่อวัสดุ / ประเภท / SKU"}
        </label>
        <input id="recycling-barcode" ref={scannerRef} autoComplete="off" autoFocus
          disabled={!canUseShift || posting || checkoutOpen}
          className="mt-1 w-full rounded-lg border-2 border-blue-400 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-blue-700"
          placeholder={searchMode==="barcode"?"ยิงบาร์โค้ดแล้วกด Enter":"ค้นหาชื่อวัสดุเป็นภาษาไทยหรืออังกฤษ"}
          value={search}
          onChange={event=>{
            updateScannerSearch(searchMode==="barcode"
              ?normalizeRecyclingBarcodeInput(event.target.value):event.target.value);
            setCatalogPage(1);setError("");setScanFeedback("idle");
          }}
          onKeyDown={onBarcodeKeyDown}/>
        {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
        <p className="mt-2 text-xs text-slate-500">
          {searchMode==="barcode"
            ?"สแกนได้โดยไม่ต้องเปลี่ยนภาษาคีย์บอร์ด · สินค้าชั่งน้ำหนักต้องยืนยันค่าน้ำหนักก่อน"
            :"ค้นหาชื่อวัสดุและเลือกจากรายการได้ทันที"}
        </p>
        <div className="mt-3 flex shrink-0 gap-2 overflow-x-auto pb-2" role="group" aria-label="หมวดประเภทวัสดุ" data-testid="recycling-category-tabs">
          {["all",...categories].map(cat=><button key={cat} type="button"
            aria-pressed={selectedCategory===cat}
            onClick={()=>{setSelectedCategory(cat);setCatalogPage(1);}}
            className={"min-h-9 shrink-0 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-bold "+
              (selectedCategory===cat?"border-blue-700 bg-blue-700 text-white":"border-slate-200 bg-white text-slate-700 hover:bg-blue-50")}>
              {cat==="all"?"ทั้งหมด":cat}
          </button>)}
        </div>
        <div className="recycling-catalog-scroll mt-1 min-h-0 flex-1 overflow-y-auto" data-testid="recycling-paged-catalog">
          {pageItems.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] content-start gap-2">
            {pageItems.map(item=>{
              const price=direction==="buy"?item.buyPrice:item.sellPrice;
              return <button type="button" key={item.id} disabled={!canUseShift||posting||checkoutOpen}
                onClick={()=>openQuantityPopup(item)}
                className="flex min-w-0 flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50">
                <div className="flex w-full items-center gap-2">
                  <CatalogImage item={item} mediaUrl={mediaByProduct[item.id]}/>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm text-slate-900" title={item.name}>{item.name}</strong>
                    <span className="block truncate text-[11px] text-slate-500">{item.category}</span>
                  </span>
                </div>
                <span className="block w-full truncate text-[11px] text-slate-500">{item.sku||"ไม่มีบาร์โค้ด"}</span>
                <strong className="block w-full text-right text-sm tabular-nums text-blue-800">
                  {price===null?"ยังไม่ตั้งราคา":formatMoney(price)+" ฿"}
                  <small className="block text-[11px] font-normal text-slate-500">
                    /{item.priceBasis==="kg"?"กก.":priceUnitLabel(item.priceUnit)}
                    {price!==null&&item.priceUnit!==item.priceBasis
                      ?" · "+formatRecyclingUnitPriceDisplay(price,item.priceUnit)+" ฿/"+priceUnitLabel(item.priceUnit):""}
                  </small>
                </strong>
              </button>;
            })}
          </div> : <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">
            ไม่พบวัสดุที่ตรงกับการค้นหาหรือหมวดที่เลือก
          </p>}
        </div>
        <nav className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2"
          aria-label="หน้ารายการวัสดุ" data-testid="recycling-catalog-pagination">
          <span className="text-xs text-slate-500">
            {filteredProducts.length} รายการ · หน้า {currentPage}/{pageCount}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" aria-label="หน้าก่อนหน้า" disabled={currentPage===1}
              onClick={()=>setCatalogPage(Math.max(1,currentPage-1))}
              className="rounded border border-slate-200 px-2 py-1.5 text-xs font-bold disabled:opacity-40">‹</button>
            {paginationPages.map(page=><button type="button" key={page} aria-current={currentPage===page?"page":undefined}
              onClick={()=>setCatalogPage(page)}
              className={"min-w-8 rounded border px-2 py-1.5 text-xs font-bold "+
                (currentPage===page?"border-blue-700 bg-blue-700 text-white":"border-slate-200 bg-white text-slate-700")}>
              {page}
            </button>)}
            <button type="button" aria-label="หน้าถัดไป" disabled={currentPage===pageCount}
              onClick={()=>setCatalogPage(Math.min(pageCount,currentPage+1))}
              className="rounded border border-slate-200 px-2 py-1.5 text-xs font-bold disabled:opacity-40">›</button>
          </div>
        </nav>
      </section>

      <section className="recycling-cart-panel flex min-h-0 min-w-0 flex-col bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-slate-900">ตะกร้ารายการ{direction === "buy" ? "รับซื้อ" : "ขายออก"}</h2>
          <span className="text-xs text-slate-500">กรุณาตรวจสอบน้ำหนักและราคาก่อนบันทึก</span>
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
              <td className="px-3 py-3 text-right">{formatMoney(line.unitPrice)} /{line.product.priceBasis === "kg" ? "กก." : priceUnitLabel(line.product.priceUnit)}</td>
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
          <div className="text-right">
            {vatApplied&&<small className="block text-xs font-semibold text-blue-800">
              ก่อน VAT {formatMoney(total)} + VAT 7% {formatMoney(vatPreviewMinor/100)}
            </small>}
            <strong className="text-2xl font-extrabold tabular-nums text-blue-900">
              {formatMoney(grossPreviewMinor/100)} ฿
            </strong>
          </div>
        </div>
        {postError && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{postError}</p>}

        {heldNotice && <p role="status" className="mt-2 text-xs font-semibold text-blue-800">{heldNotice}</p>}
        {heldError && <p role="alert" className="mt-2 text-xs font-semibold text-rose-800">{heldError}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2" data-testid="recycling-cart-actions">
          <button type="button" disabled={posting||checkoutOpen||visibleLines.length===0}
            onClick={openCancelConfirmation}
            className="min-h-11 rounded-md border border-rose-200 bg-white px-4 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40">
            ยกเลิกบิล
          </button>
          <button type="button" disabled={!canUseShift||posting||checkoutOpen||visibleLines.length===0}
            onClick={parkCurrentBill}
            className="min-h-11 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-40">
            ▤ พักบิล
          </button>
          <button type="button" onClick={openCheckout}
            disabled={!canUseShift || posting || visibleLines.length === 0}
            className="min-h-11 min-w-[210px] max-w-full flex-1 rounded-md bg-blue-700 px-5 py-3 text-sm font-extrabold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none">
            {direction === "buy" ? "บันทึกใบรับซื้อและเข้าสต๊อก" : "บันทึกขายออกและตัดสต๊อก"}
          </button>
        </div>
        </div>
      </section>
    </div>


    {scanErrorPopup && <div className="fixed inset-0 z-[1450] flex items-center justify-center bg-slate-950/65 p-4"
      role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="recycling-scan-error-title"
        aria-describedby="recycling-scan-error-message" data-testid="recycling-invalid-scan-dialog"
        onKeyDown={event=>{
          if(event.key==="Enter"||event.key==="Escape"){
            event.preventDefault();event.stopPropagation();closeScanErrorPopup();
          }
        }}
        className="w-full max-w-sm rounded-xl border border-rose-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-xl text-rose-700" aria-hidden="true">!</span>
          <h2 id="recycling-scan-error-title" className="text-lg font-extrabold text-slate-900">สแกนบาร์โค้ดไม่สำเร็จ</h2>
        </div>
        <p id="recycling-scan-error-message" className="mt-3 text-sm leading-6 text-rose-800">{scanErrorPopup}</p>
        <button type="button" ref={scanDismissRef} onClick={closeScanErrorPopup}
          className="mt-5 w-full rounded-md bg-blue-700 px-4 py-3 text-sm font-bold text-white">
          ตกลง (Enter) · สแกนใหม่
        </button>
      </section>
    </div>}
    {cancelOpen && <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-slate-950/65 p-3" role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="recycling-cancel-title"
        data-testid="recycling-cancel-confirmation"
        onKeyDown={event=>{
          if(event.key==="ArrowLeft"||event.key==="ArrowRight"){
            event.preventDefault();event.stopPropagation();
            setCancelChoice(event.key==="ArrowLeft"?"keep":"confirm");
          }else if(event.key==="Enter"){
            event.preventDefault();event.stopPropagation();
            if(cancelChoice==="confirm")cancelCurrentBill();
            else setCancelOpen(false);
          }else if(event.key==="Escape"){
            event.preventDefault();event.stopPropagation();setCancelOpen(false);
          }
        }}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
        <h2 id="recycling-cancel-title" className="text-lg font-extrabold text-slate-900">ยืนยันยกเลิกบิล</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          ยกเลิก {visibleLines.length} รายการที่ยังไม่บันทึก? ระบบจะไม่ลบใบรับซื้อหรือยอดสต๊อกที่เคยบันทึกแล้ว
        </p>
        <p className="mt-3 text-xs text-slate-500">ลูกศร ← ย้อนกลับ · → ยืนยันยกเลิก · Enter เลือก · Esc ปิด</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onFocus={()=>setCancelChoice("keep")} onClick={()=>setCancelOpen(false)}
            className={"rounded-md border px-3 py-3 text-sm font-semibold "+
              (cancelChoice==="keep"?"border-blue-700 bg-blue-50 text-blue-900 ring-2 ring-blue-200":"border-slate-200 bg-white text-slate-700")}>
            ← ไม่ยกเลิก
          </button>
          <button type="button" ref={cancelConfirmRef} onFocus={()=>setCancelChoice("confirm")}
            onClick={cancelCurrentBill}
            className={"rounded-md border px-3 py-3 text-sm font-bold "+
              (cancelChoice==="confirm"?"border-rose-700 bg-rose-700 text-white ring-2 ring-rose-200":"border-slate-200 bg-white text-rose-700")}>
            ยืนยันยกเลิกบิล →
          </button>
        </div>
      </section>
    </div>}
    {heldOpen && <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-slate-950/65 p-3" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="recycling-held-title"
        className="flex max-h-[85dvh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
        data-testid="recycling-held-bills-modal">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="recycling-held-title" className="text-lg font-extrabold text-slate-900">รายการพักบิล · CUSTOM Recycling</h2>
            <p className="mt-1 text-xs text-slate-500">เฉพาะสาขา เครื่อง และกะ Recycling ปัจจุบัน ไม่รวมพักบิล POS ทั่วไป</p>
          </div>
          <button type="button" ref={heldCloseRef} aria-label="ปิดรายการพักบิล" onClick={()=>setHeldOpen(false)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm">✕</button>
        </div>
        {heldError&&<p role="alert" className="mt-3 rounded-md bg-rose-50 p-3 text-xs text-rose-800">{heldError}</p>}
        <div className="mt-4 min-h-0 space-y-2 overflow-y-auto">
          {!heldBills.length && <p className="rounded-lg bg-slate-50 p-8 text-center text-sm text-slate-500">ยังไม่มีรายการพักบิลในกะนี้</p>}
          {heldBills.map(bill=><article key={bill.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <div>
              <strong className="text-sm text-slate-900">{bill.direction==="buy"?"ใบรับซื้อ":"บิลขายออก"} · {bill.lines.length} รายการ</strong>
              <small className="mt-1 block text-xs text-slate-500">
                พักเมื่อ {new Date(bill.heldAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}
              </small>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={posting} onClick={()=>restoreHeldBill(bill)}
                className="rounded-md bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">เรียกคืนบิล</button>
              <button type="button" disabled={posting} onClick={()=>deleteHeldBill(bill)}
                className="rounded-md border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">ลบ</button>
            </div>
          </article>)}
        </div>
      </section>
    </div>}
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
        {fixedDocumentTime&&<p className="mt-3 rounded-md bg-amber-50 p-2 text-xs font-bold text-amber-900">วันเวลาเอกสารย้อนหลัง: {new Date(fixedDocumentTime).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p>}
        <div className="mt-4 flex items-center justify-between rounded-lg bg-blue-50 px-4 py-3">
          <span className="text-sm font-semibold text-slate-700">
            {direction === "buy" ? "ยอดที่ร้านต้องจ่าย" : !saleVatReady ? "ยอดก่อนภาษี (ยังยืนยันไม่ได้)" : "ยอดที่ร้านต้องรับ"}
          </span>
          <div className="text-right">
            {vatApplied&&<small className="block text-xs font-semibold text-blue-800">
              ก่อน VAT {formatMoney(total)} + VAT 7% {formatMoney(vatPreviewMinor/100)}
            </small>}
            <strong className="text-2xl font-extrabold tabular-nums text-blue-900">
              {formatMoney(grossPreviewMinor/100)} ฿
            </strong>
          </div>
        </div>
        {direction==="sell"&&vatQuoteLoading&&<p role="status" className="mt-2 text-xs text-blue-700">กำลังตรวจสอบ VAT จากเซิร์ฟเวอร์...</p>}
        {direction==="sell"&&vatQuote&&!saleVatReady&&<div role="alert" className="mt-2 rounded-md bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          <p className="font-bold">ยังไม่พร้อมบันทึกการขายออก · กรุณาดำเนินการให้ครบ</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">{(vatQuote.blockers?.length?vatQuote.blockers:[vatQuote.reason??"unknown"]).map(code=><li key={code}>{recyclingVatBlockerMessage(code)}</li>)}</ul>
          <button type="button" disabled={vatQuoteLoading||posting} onClick={()=>void refreshVatQuote()} className="mt-2 rounded border border-amber-300 bg-white px-3 py-1 font-bold">ตรวจสอบความพร้อมอีกครั้ง</button>
        </div>}
        <label htmlFor="recycling-counterparty" className="mt-4 block text-sm font-semibold text-slate-800">
          {direction === "buy" ? "ชื่อผู้ขายวัสดุ" : "ชื่อผู้ซื้อวัสดุ"}
          <span className="ml-1 text-xs font-normal text-slate-500">(ไม่บังคับ · เว้นว่างแสดง - บนบิล)</span>
        </label>
        <input id="recycling-counterparty" maxLength={240}
          value={counterpartyName} disabled={posting}
          onChange={event => setCounterpartyName(event.target.value)}
          placeholder="ไม่ระบุก็ได้"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"/>
        <fieldset className="mt-4" tabIndex={0}
          onKeyDown={event=>{
            if(posting)return;
            if(event.key==="ArrowLeft"||event.key==="ArrowRight"){
              event.preventDefault();event.stopPropagation();setPostError("");
              const next=event.key==="ArrowLeft"?"cash":"bank_transfer";
              setSettlement(next);
              if(next==="cash")cashMethodRef.current?.focus();
            }else if(event.key==="Enter"){
              event.preventDefault();event.stopPropagation();
              if(settlement==="bank_transfer"){
                setPostError("ยังไม่สามารถยืนยันเงินโอนโดยไม่มีหลักฐานธนาคารที่ตรวจสอบแล้ว");
              }else if(canUseShift && transactionWritesEnabled && visibleLines.length && !posting && saleVatReady){
                event.currentTarget.closest("form")?.requestSubmit();
              }
            }
          }}>
          <legend className="mb-2 text-sm font-extrabold text-slate-800">
            {direction === "buy" ? "วิธีจ่ายเงิน" : "วิธีรับชำระเงิน"}
          </legend>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="เลือกวิธีชำระด้วยลูกศรซ้ายขวา">
            <label className={"flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border p-3 "+
              (settlement==="cash"?"border-blue-600 bg-blue-50 ring-1 ring-blue-100":"border-slate-200 bg-white")}>
              <input type="radio" ref={cashMethodRef} autoFocus name="recycling-settlement" checked={settlement==="cash"}
                disabled={posting} onChange={()=>{setSettlement("cash");setPostError("");}}/>
              <span className="text-xl" aria-hidden="true">💵</span>
              <span className="min-w-0 text-sm font-bold text-slate-800">
                {direction==="buy"?"จ่ายเงินสด":"ชำระเงินสด"}
              </span>
            </label>
            <label className={"flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border p-3 "+
              (settlement==="bank_transfer"?"border-blue-600 bg-blue-50 ring-1 ring-blue-100":"border-slate-200 bg-white")}>
              <input type="radio" name="recycling-settlement" checked={settlement==="bank_transfer"}
                disabled={posting} onChange={()=>{setSettlement("bank_transfer");setPostError("");}}/>
              <span className="text-xl" aria-hidden="true">🏦</span>
              <span className="min-w-0 text-sm font-bold text-slate-800">
                {direction==="buy"?"จ่ายเงินโอน":"ชำระเงินโอน"}
                <small className="block text-[11px] font-normal text-slate-500">ต้องตรวจหลักฐานธนาคารก่อนยืนยันธุรกรรม</small>
              </span>
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">ใช้ลูกศร ← / → เลือกเงินสดหรือเงินโอน แล้วกด Enter เพื่อยืนยันเมื่อผ่านการตรวจสอบเงื่อนไข</p>
        </fieldset>
        {settlement === "bank_transfer" && <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          ระบบยังไม่รองรับการยืนยันเงินโอนสำหรับ Recycling ต้องตรวจสอบยอดและเลขอ้างอิงจากธนาคารโดยผู้มีสิทธิ์ก่อนบันทึก{direction === "buy" ? "จ่ายเงิน" : "รับชำระเงิน"} ขณะนี้ยังไม่มีการสร้างบิลหรือบันทึกเงินโอน
        </p>}
        {!transactionWritesEnabled && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-900">ตัวอย่างหน้าต่างชำระเงิน: การบันทึกธุรกรรมจริงยังปิดไว้จนกว่าจะผ่านตรวจรับบัญชีและสต๊อก</p>}
        {postError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">{postError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={posting} onClick={() => setCheckoutOpen(false)}
            className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 disabled:opacity-50">ย้อนกลับ</button>
          <button type="submit" disabled={!canUseShift || !transactionWritesEnabled || posting || settlement === "bank_transfer" || !visibleLines.length || !saleVatReady || vatQuoteLoading}
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
          <CatalogImage item={pending} mediaUrl={mediaByProduct[pending.id]}/>
          <div><strong className="block text-slate-900">{pending.name}</strong><small className="text-slate-500">{pending.category}</small></div>
        </div>
        <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900"
          data-testid="recycling-configured-unit">
          หน่วยจากทะเบียนวัสดุ: {recyclingUnitLabel(unit)} · ระบบใช้ราคาที่ตั้งค่าไว้ให้อัตโนมัติ
        </p>
        <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor="recycling-quantity">
          จำนวนที่ชั่ง / นับ ({recyclingUnitLabel(unit)})
        </label>
        <div className="mt-1 flex items-stretch gap-2">
          <input id="recycling-quantity" ref={quantityInputRef} autoFocus
            type={weightedQuantity?"text":"number"} inputMode="decimal" min={weightedQuantity?undefined:"0.001"} step={weightedQuantity?undefined:"any"}
            maxLength={weightedQuantity?MAX_RECYCLING_WEIGHT_EXPRESSION_LENGTH:undefined}
            value={quantity} autoComplete="off" spellCheck={false}
            placeholder={weightedQuantity?"30+30+56":undefined}
            aria-describedby={weightedQuantity?"recycling-weight-help":undefined}
            onChange={event=>setQuantity(event.target.value)}
            onKeyDown={event=>{
              if(event.nativeEvent.isComposing||event.ctrlKey||event.altKey||event.metaKey)return;
              if(event.key==="Enter"){
                event.preventDefault();event.stopPropagation();
                if(!event.repeat)addToCart(event.currentTarget.value);
              }else if(weightedQuantity&&(event.key==="="||event.code==="NumpadEqual")){
                event.preventDefault();event.stopPropagation();
                if(!event.repeat)calculateWeightInPlace(event.currentTarget.value);
              }
            }}
            className="min-w-0 flex-1 rounded-lg border-2 border-blue-300 px-3 py-3 text-xl font-bold tabular-nums text-slate-900 focus:border-blue-700 focus:outline-none"/>
          {weightedQuantity&&<>
            <button type="button" aria-label="บวกน้ำหนักครั้งถัดไป" onClick={appendWeightPlus}
              className="w-12 shrink-0 rounded-lg border border-blue-300 bg-blue-50 text-xl font-extrabold text-blue-800 hover:bg-blue-100">+</button>
            <button type="button" aria-label="คำนวณน้ำหนักรวมในช่อง" disabled={!weightTotal} onClick={()=>calculateWeightInPlace()}
              className="w-12 shrink-0 rounded-lg bg-blue-700 text-xl font-extrabold text-white disabled:opacity-40">=</button>
          </>}
        </div>
        {weightedQuantity&&<div id="recycling-weight-help" className="mt-2 space-y-1 text-xs text-slate-600">
          <p>พิมพ์น้ำหนักหลายครั้ง เช่น 30+30+56 แล้วกด = เพื่อรวมในช่อง หรือกด Enter เพื่อเพิ่มลงตะกร้าทันที</p>
          {quantity.includes("+")&&<p role="status" className="rounded-md bg-blue-50 px-3 py-2 text-sm font-bold text-blue-900">
            น้ำหนักรวม: {weightTotal?weightTotal.display+" "+recyclingUnitLabel(unit):"กรอกจำนวนให้ครบก่อนยืนยัน"}
          </p>}
        </div>}
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between gap-2"><span>ราคาฐานที่ใช้คำนวณ</span>
            <strong>{selectedPrice === null ? "—" : formatMoney(selectedPrice)} ฿ /{pending.priceBasis === "kg" ? "กก." : priceUnitLabel(pending.priceUnit)}</strong></div>
          {selectedPrice !== null && pending.priceUnit !== pending.priceBasis && <p className="mt-1 text-xs text-blue-800">
            ราคาที่ตั้งในทะเบียน: {formatRecyclingUnitPriceDisplay(selectedPrice,pending.priceUnit)} บาท/{priceUnitLabel(pending.priceUnit)} · ระบบแปลงเป็นหน่วยฐานแล้ว
          </p>}
          {preview && <div className="mt-2 flex justify-between gap-2 text-slate-600">
            <span>จำนวนเทียบหน่วยราคา</span><span>{preview.basisQuantity.toLocaleString("th-TH", { maximumFractionDigits: 6 })} {pending.priceBasis === "kg" ? "กก." : priceUnitLabel(pending.priceUnit)}</span>
          </div>}
          <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-lg font-extrabold text-blue-900">
            <span>รวม</span><span>{preview ? formatMoney(preview.amount) : "—"} ฿</span>
          </div>
          {!preview && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">โปรดกรอกน้ำหนักหรือจำนวนให้ถูกต้องตามหน่วยที่กำหนดไว้ในทะเบียนวัสดุ</p>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { setPending(null); scannerRef.current?.focus(); }}
            className="rounded-lg border border-slate-200 px-4 py-3 font-bold text-slate-700">ยกเลิก</button>
          <button type="button" disabled={!preview} onClick={()=>addToCart()}
            className="rounded-lg bg-blue-700 px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            เพิ่มลงตะกร้า (Enter)
          </button>
        </div>
      </section>
    </div>}
    {posted&&<RecyclingReceiptDialog transactionId={posted.id}
      receiptNo={posted.receipt_no} open={receiptDialogOpen}
      onClose={()=>{setReceiptDialogOpen(false);window.requestAnimationFrame(()=>scannerRef.current?.focus());}}
      printing={printing} autoPrintNotice={printNotice} autoPrintRequestId={posted.printRequestId}/>}
  </main>;
}
