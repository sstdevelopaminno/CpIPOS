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


/**
 * Stable text mode for 58/80mm Windows thermal printers. HTML WebBrowser.Print
 * can report a spool success without producing paper on XP-80C; the existing
 * native .NET PrintDocument text renderer is confirmed by physical test.
 * Keep the final rendered Thai amounts, product names, and order number.
 */
export function windowsReceiptHtmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<br\s*\/?\s*>|<hr\b[^>]*>/gi, "\n")
    .replace(/<\/\s*(?:tr|div|p|main|header|footer|h[1-6]|li|section|article|table)\s*>/gi, "\n")
    .replace(/<\/?(?:td|th|span|strong)\b[^>]*>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(line => line.length > 0)
    .join("\n")
    .slice(0, 14_000);
}

const WINDOWS_SALE_PRINT_LEDGER = "cpi_windows_sale_receipts_attempted_v1";

function reserveUniqueWindowsSaleReceipt(orderNo: string) {
  const key = orderNo.trim().slice(0, 100);
  if (!key) throw new Error("Windows receipt order number required");
  try {
    const raw = window.localStorage.getItem(WINDOWS_SALE_PRINT_LEDGER);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("corrupt");
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      throw new Error("ใบเสร็จเลขที่นี้ถูกส่งพิมพ์ไปแล้ว หรือยังไม่ทราบผล ห้ามส่งซ้ำ ให้ใช้พิมพ์ย้อนหลังผ่าน PIN ผู้จัดการ");
    }
    const recent = Object.entries(parsed)
      .filter(([name, time]) => name !== key && typeof time === "number" && Number.isFinite(time))
      .slice(-250);
    const updated = Object.fromEntries([...recent, [key, Date.now()]]);
    window.localStorage.setItem(WINDOWS_SALE_PRINT_LEDGER, JSON.stringify(updated));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ใบเสร็จเลขที่นี้")) throw error;
    throw new Error("ไม่สามารถบันทึกสถานะป้องกันใบเสร็จซ้ำได้ งดพิมพ์ซ้ำและใช้ใบเสร็จย้อนหลังหลังตรวจเครื่อง");
  }
}

// Manually initiated sales receipt or PIN-authorized historical reprint.
// Never forward a receipt to the old Android Print Agent from this method.
// The caller owns the user action; unknown outcomes must not be auto-retried.
export async function printWindowsReceiptHtml(
  receiptHtml: string,
  options: { orderNo?: string | null; reprint?: boolean; plainText?: string | null } = {}
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
  // WinForms DocumentText uses about:blank as its page URL; relative store
  // logo assets otherwise disappear from printed receipts. Use the current
  // authenticated POS origin as the base, never an untrusted receipt URL.
  const appOrigin = typeof window.location?.origin === "string" && /^https:\/\//i.test(window.location.origin)
    ? window.location.origin
    : null;
  const printableHtml = appOrigin && /<img\b[^>]+src=["']\//i.test(content)
    ? content.replace(/<head([^>]*)>/i, `<head$1><base href="${appOrigin}/" />`)
    : content;
  if (printableHtml.length > 250_000) throw new Error("Windows receipt HTML exceeds the print bridge limit.");
  // The native bridge already validates the configured, installed printer.
  // The separate GET /printers preflight caused an extra failure point before
  // a single receipt could ever reach POST /print.
  const nativePrinterName = typeof (runtime as Runtime & { windows_printer?: unknown }).windows_printer === "string"
    ? String((runtime as Runtime & { windows_printer?: string }).windows_printer ?? "").trim()
    : "";
  const textToPrint = (options.plainText?.trim() || windowsReceiptHtmlToText(printableHtml)).slice(0, 14_000);
  if (!textToPrint.trim()) throw new Error("Windows receipt text is empty after rendering");
  // Only sale receipts are guarded here. Historical reprints are separately
  // PIN-authorized and may intentionally print a second copy.
  // This also prevents the manual button racing with the Windows cloud worker
  // for the same paid order; the native spool request is attempted at most once.
  if (options.orderNo && options.reprint !== true) reserveUniqueWindowsSaleReceipt(options.orderNo);
  const controller = new AbortController();
  // WinForms HTML print can consume most of the native 30s HTTP timeout.
  // A timed-out response is indeterminate: do not retry automatically.
  const timer = window.setTimeout(() => controller.abort(), 35_000);
  let stage: "dispatch" | "response" | "timeout" = "dispatch";
  try {
    const response = await fetch("http://127.0.0.1:3210/print", {
      method: "POST",
      headers,
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        ...(nativePrinterName ? { printer_name: nativePrinterName } : {}),
        html: printableHtml,
        text: textToPrint,
        order_no: options.orderNo ?? null,
        metadata: {
          source: "pos_windows_webview2_manual_receipt",
          payload_format: "receipt_html_v1",
          reprint: options.reprint === true
        }
      })
    });
    stage = "response";
    const payload = (await response.json().catch(() => null)) as BridgeResponse<{
      printed?: boolean;
      provider?: string;
      printer_name?: string;
      job_id?: string;
    }> | null;
    if (!response.ok || payload?.ok !== true || payload.data?.printed !== true ||
        payload.data?.provider !== "native_winforms_html_receipt" ||
        (nativePrinterName && payload.data.printer_name !== nativePrinterName)) {
      throw new Error(payload?.error?.message ?? "Windows HTML receipt renderer ไม่ยืนยันการรับงานพิมพ์");
    }
    return { printer: payload.data.printer_name ?? nativePrinterName, spoolJobId: payload.data.job_id ?? null };
  } catch (error) {
    const unknownOutcome = controller.signal.aborted;
    const message = unknownOutcome
      ? "Bridge timed out; physical print status unknown"
      : error instanceof Error ? error.message : "Windows bridge request failed";
    // Best-effort telemetry only; it must not trigger a second print, block
    // checkout or transmit the bridge token / receipt HTML.
    try {
      void fetch("/api/pos/windows-print/diagnostic", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        keepalive: true,
        body: JSON.stringify({
          order_no: options.orderNo ?? null,
          reprint: options.reprint === true,
          stage: unknownOutcome ? "timeout" : stage,
          error_message: message.slice(0, 320)
        })
      }).catch(() => undefined);
    } catch { /* diagnostic must never affect print outcome */ }
    if (unknownOutcome) {
      throw new Error("ไม่ทราบว่างานพิมพ์ถูกส่งแล้วหรือไม่ ให้ตรวจกระดาษและคิว XP-80C ก่อน ห้ามกดพิมพ์ซ้ำทันที");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Execute only a server-authorized, device-bound cash-drawer print job.
 * This endpoint is loopback-only and never retries an unknown physical
 * outcome. Windows Native Print Agent owns the persistent attempt ledger.
 */
export async function openWindowsCashDrawerJob(
  drawer?: { kickPin: 0 | 1; pulseOnMs: number; pulseOffMs: number } | null
): Promise<{ printer: string; spoolJobId: string | null }> {
  const runtime = windowsRuntime() as (Runtime & { windows_printer?: string }) | null;
  if (!drawer || ![0, 1].includes(drawer.kickPin) ||
      !Number.isInteger(drawer.pulseOnMs) || drawer.pulseOnMs < 20 || drawer.pulseOnMs > 500 ||
      !Number.isInteger(drawer.pulseOffMs) || drawer.pulseOffMs < 20 || drawer.pulseOffMs > 500) {
    throw new Error("Windows cash drawer command is invalid.");
  }
  if (!runtime?.bridge_token || !runtime.bridge_health_url) {
    throw new Error("Windows Local Print Bridge is unavailable for the cash drawer.");
  }
  let bridge: URL;
  try { bridge = new URL(runtime.bridge_health_url); }
  catch { throw new Error("Windows Local Print Bridge URL is invalid."); }
  if (bridge.protocol !== "http:" || bridge.hostname !== "127.0.0.1" ||
      bridge.port !== "3210" || bridge.pathname !== "/health" ||
      bridge.username || bridge.password || bridge.search || bridge.hash) {
    throw new Error("Windows cash drawer must use the trusted loopback bridge.");
  }
  const printerName = runtime.windows_printer?.trim() ?? "";
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("http://127.0.0.1:3210/cash-drawer/open", {
      method: "POST",
      headers: { "X-CpIPOS-Bridge-Token": runtime.bridge_token, "Content-Type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        ...(printerName ? { printer_name: printerName } : {}),
        drawer_connection_mode: "printer-kick",
        drawer_kick_pin: drawer.kickPin,
        drawer_pulse_on_ms: drawer.pulseOnMs,
        drawer_pulse_off_ms: drawer.pulseOffMs
      })
    });
    const body = await response.json().catch(() => null) as BridgeResponse<{
      opened?: boolean; provider?: string; printer_name?: string; job_id?: string;
    }> | null;
    if (!response.ok || body?.ok !== true || body.data?.opened !== true ||
        body.data.provider !== "windows_raw_escpos_cash_drawer" ||
        (printerName && body.data.printer_name !== printerName)) {
      throw new Error(body?.error?.message ?? "Windows cash drawer spool command was not accepted.");
    }
    return { printer: body.data.printer_name ?? printerName, spoolJobId: body.data.job_id ?? null };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Cash drawer command timed out. Check the drawer before retrying manually.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
