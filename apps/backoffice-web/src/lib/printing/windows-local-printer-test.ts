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
