/**
 * Windows Web POS direct test-print pathway.
 *
 * This path is intentionally local to the installed WebView2 wrapper:
 * it never routes a Windows printer test to the Android print agent or the
 * server-side print queue. Only the trusted native wrapper supplies the
 * per-launch LocalPrintBridge token.
 *
 * A successful response means Windows accepted a spool job, NOT proof that
 * paper was physically printed. Do not retry automatically.
 */
type Runtime = {
  bridge_health_url?: string;
  bridge_token?: string;
};

type BridgeResponse<T> = {
  ok?: boolean;
  data?: T;
  error?: { code?: string; message?: string };
};

function windowsRuntime(): Runtime | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { CpIPOSWindowsRuntime?: Runtime }).CpIPOSWindowsRuntime ?? null;
}

export function hasLocalWindowsPrintBridge(): boolean {
  return windowsRuntime() !== null;
}

export async function testInstalledWindowsPrinter(printerName: string): Promise<{ printer: string; spoolJobId: string | null }> {
  const runtime = windowsRuntime();
  if (!runtime?.bridge_token || !runtime.bridge_health_url) {
    throw new Error("กรุณาเปิดหน้าเครื่องพิมพ์ในโปรแกรม CpiPOS Windows Web POS ไม่ใช่ Chrome หรือแท็บเบราว์เซอร์");
  }
  const original = new URL(runtime.bridge_health_url);
  if (original.protocol !== "http:" || original.hostname !== "127.0.0.1" || original.port !== "3210" || original.pathname !== "/health") {
    throw new Error("ไม่พบ Windows Print Bridge ที่ปลอดภัยบนเครื่องนี้");
  }
  const target = printerName.trim();
  if (!target || target.length > 128) throw new Error("ไม่ได้ระบุชื่อเครื่องพิมพ์ Windows ที่ถูกต้อง");

  const headers = {
    "X-CpIPOS-Bridge-Token": runtime.bridge_token,
    "Content-Type": "application/json"
  };
  const base = "http://127.0.0.1:3210";
  const controller = new AbortController();
  // The native Windows spooler can take up to 45 seconds. An early HTTP
  // timeout can leave an unknown outcome, so never retry on timeout.
  const timer = window.setTimeout(() => controller.abort(), 65_000);
  try {
    const printersResponse = await fetch(`${base}/printers`, { headers, cache: "no-store", signal: controller.signal });
    const printers = (await printersResponse.json()) as BridgeResponse<{
      resolved_printer?: string;
      printers?: Array<{ name: string; is_valid?: boolean }>;
    }>;
    if (!printersResponse.ok || printers.ok !== true || !printers.data) {
      throw new Error("Windows Print Bridge ไม่สามารถอ่านรายชื่อเครื่องพิมพ์ได้");
    }
    const selected = printers.data.printers?.find((candidate) =>
      candidate.is_valid === true && candidate.name?.toLocaleLowerCase() === target.toLocaleLowerCase());
    if (!selected || printers.data.resolved_printer !== selected.name) {
      throw new Error(`เครื่อง Windows ยังไม่ได้เลือก ${target} ให้ตรงกับเครื่องพิมพ์ที่ตั้งค่าไว้`);
    }

    const response = await fetch(`${base}/print/test`, {
      method: "POST",
      headers,
      body: JSON.stringify({ printer_name: selected.name }),
      cache: "no-store",
      signal: controller.signal
    });
    const result = (await response.json()) as BridgeResponse<{ printed?: boolean; printer_name?: string; job_id?: string }>;
    if (!response.ok || result.ok !== true || result.data?.printed !== true || result.data.printer_name !== selected.name) {
      throw new Error(result.error?.message ?? "Windows Print Bridge ไม่ได้รับงานพิมพ์ทดสอบ");
    }
    return { printer: selected.name, spoolJobId: result.data.job_id ?? null };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Windows Print Bridge ตอบช้า ไม่ทราบว่างานพิมพ์ออกหรือไม่ กรุณาตรวจเครื่องก่อน ห้ามกดพิมพ์ซ้ำทันที");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}


// Manually initiated sales receipt or PIN-authorized historical reprint.
// Never forward a receipt to the old Android Print Agent from this method.
// The caller owns the user action; unknown outcomes must not be auto-retried.
export async function printWindowsReceiptHtml(
  receiptHtml: string,
  options: { orderNo?: string | null; reprint?: boolean } = {}
): Promise<{ printer: string; spoolJobId: string | null }> {
  const runtime = windowsRuntime();
  if (!runtime?.bridge_token || !runtime.bridge_health_url) {
    throw new Error("กรุณาเปิดหน้าขายในโปรแกรม CpiPOS Windows Web POS เพื่อใช้เครื่องพิมพ์ XP-80C");
  }
  let bridge: URL;
  try {
    bridge = new URL(runtime.bridge_health_url);
  } catch {
    throw new Error("Windows Local Print Bridge URL ไม่ถูกต้อง");
  }
  if (bridge.protocol !== "http:" || bridge.hostname !== "127.0.0.1" ||
      bridge.port !== "3210" || bridge.pathname !== "/health" ||
      bridge.username || bridge.password || bridge.search || bridge.hash) {
    throw new Error("ไม่อนุญาตให้ส่งใบเสร็จออกไปยัง Print Bridge ที่ไม่ใช่เครื่องนี้");
  }
  const content = receiptHtml.trim();
  if (!content || content.length > 250_000 || !/<html\b/i.test(content)) {
    throw new Error("รูปแบบใบเสร็จไม่ถูกต้อง หรือมีขนาดใหญ่เกินไป");
  }
  const headers = {
    "X-CpIPOS-Bridge-Token": runtime.bridge_token,
    "Content-Type": "application/json"
  };
  const controller = new AbortController();
  // WinForms HTML print can consume most of the native 30s HTTP timeout.
  // A timed-out response is indeterminate: do not retry automatically.
  const timer = window.setTimeout(() => controller.abort(), 35_000);
  try {
    const listingResponse = await fetch("http://127.0.0.1:3210/printers", {
      headers, cache: "no-store", signal: controller.signal
    });
    if (!listingResponse.ok) throw new Error("ไม่สามารถตรวจเครื่องพิมพ์ที่ Windows ติดตั้งได้");
    const listing = (await listingResponse.json()) as BridgeResponse<{
      resolved_printer?: string | null;
      printers?: Array<{ name?: string; is_valid?: boolean }>;
    }>;
    const selectedPrinter = listing.data?.resolved_printer?.trim() ?? "";
    if (listing.ok !== true || !selectedPrinter || !listing.data?.printers?.some(
      (p) => p.is_valid === true && p.name === selectedPrinter
    )) {
      throw new Error("ยังไม่ได้เลือกเครื่องพิมพ์ Windows ที่ใช้งานได้ กรุณาตรวจ XP-80C ในตั้งค่าเครื่องพิมพ์");
    }
    const response = await fetch("http://127.0.0.1:3210/print", {
      method: "POST",
      headers,
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        printer_name: selectedPrinter,
        receipt_html: content,
        order_no: options.orderNo ?? null,
        metadata: { source: "pos_windows_webview2_manual_receipt", reprint: options.reprint === true }
      })
    });
    const payload = (await response.json().catch(() => null)) as BridgeResponse<{
      printed?: boolean;
      html_printed?: boolean;
      printer_name?: string;
      job_id?: string;
    }> | null;
    if (!response.ok || payload?.ok !== true || payload.data?.printed !== true ||
        payload.data?.html_printed !== true || payload.data.printer_name !== selectedPrinter) {
      throw new Error(payload?.error?.message ?? "Windows Print Bridge ไม่ยืนยันการรับใบเสร็จ HTML");
    }
    return { printer: selectedPrinter, spoolJobId: payload.data.job_id ?? null };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("ไม่ทราบว่างานพิมพ์ถูกส่งแล้วหรือไม่ ให้ตรวจกระดาษและคิว XP-80C ก่อน ห้ามกดพิมพ์ซ้ำทันที");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
