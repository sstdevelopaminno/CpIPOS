import { afterEach, describe, expect, it, vi } from "vitest";
import { hasLocalWindowsPrintBridge, printWindowsReceiptHtml, testInstalledWindowsPrinter, windowsReceiptHtmlToText } from "@/lib/printing/windows-local-printer-test";

function stubWindowsRuntime(healthUrl = "http://127.0.0.1:3210/health", token = "test-token") {
  const local = new Map<string, string>();
  vi.stubGlobal("window", {
    CpIPOSWindowsRuntime: { bridge_health_url: healthUrl, bridge_token: token },
    localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => { local.set(key, value); }
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis)
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Windows direct native receipt test", () => {
  it("submits only one test to the installed, selected XP-80C queue", async () => {
    stubWindowsRuntime();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/printers")) {
        return { ok: true, json: async () => ({
          ok: true, data: { resolved_printer: "XP-80C", printers: [
            { name: "XP-80C", is_valid: true },
            { name: "Bad Queue", is_valid: false }
          ] }
        }) } as Response;
      }
      return { ok: true, json: async () => ({
        ok: true, data: { printed: true, printer_name: "XP-80C", job_id: "win-test-1" }
      }) } as Response;
    }));

    expect(hasLocalWindowsPrintBridge()).toBe(true);
    await expect(testInstalledWindowsPrinter("XP-80C")).resolves.toEqual({
      printer: "XP-80C", spoolJobId: "win-test-1"
    });
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:3210/printers",
      "http://127.0.0.1:3210/print/test"
    ]);
    expect(calls[0].init?.headers).toMatchObject({ "X-CpIPOS-Bridge-Token": "test-token" });
    expect(calls[1].init?.method).toBe("POST");
    expect(calls[1].init?.body).toBe(JSON.stringify({ printer_name: "XP-80C" }));
  });

  it("does not submit a test if a different Windows printer is selected", async () => {
    stubWindowsRuntime();
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({
      ok: true, data: { resolved_printer: "Microsoft Print to PDF", printers: [
        { name: "XP-80C", is_valid: true },
        { name: "Microsoft Print to PDF", is_valid: true }
      ] }
    }) } as Response));
    vi.stubGlobal("fetch", fetchMock);
    await expect(testInstalledWindowsPrinter("XP-80C")).rejects.toThrow("ยังไม่ได้เลือก XP-80C");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects arbitrary remote server URL without dispatching a print job", async () => {
    stubWindowsRuntime("https://remote.example.org/health");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(testInstalledWindowsPrinter("XP-80C")).rejects.toThrow("ไม่พบ Windows Print Bridge");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires native WebView2 runtime; plain Chrome cannot test Windows queue", async () => {
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(hasLocalWindowsPrintBridge()).toBe(false);
    await expect(testInstalledWindowsPrinter("XP-80C")).rejects.toThrow("โปรแกรม CpiPOS Windows Web POS");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("manual Windows sales and historical receipt printing", () => {
  const html = "<!doctype html><html lang=\"th\"><body>ข้าวมันไก่สามเซียน</body></html>";

  it("submits one rendered text receipt via native .NET PrintDocument on XP-80C", async () => {
    stubWindowsRuntime();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({ ok: true, data: {
          printed: true, provider: "native_dotnet_print_document", printer_name: "XP-80C", job_id: "CPIPOS-HTML-001"
        } })
      } as Response;
    }));
    await expect(printWindowsReceiptHtml(html, { orderNo: "BILL001", reprint: true })).resolves.toEqual({
      printer: "XP-80C", spoolJobId: "CPIPOS-HTML-001"
    });
    expect(calls.map((x) => x.url)).toEqual(["http://127.0.0.1:3210/print"]);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toMatchObject({ "X-CpIPOS-Bridge-Token": "test-token" });
    const payload = JSON.parse(String(calls[0].init?.body));
    expect(payload).toMatchObject({
      order_no: "BILL001",
      metadata: { reprint: true }
    });
    expect(payload.text).toContain("ข้าวมันไก่สามเซียน");
    expect(payload.text).not.toContain("<body>");
    expect(payload).not.toHaveProperty("receipt_html");
    expect(payload).not.toHaveProperty("printer_name");
  });

  it("lets the installed Windows bridge reject a missing printer and audits the failure", async () => {
    stubWindowsRuntime();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith("/api/pos/windows-print/")) return { ok: true } as Response;
      return {
        ok: false,
        json: async () => ({ ok: false, error: { message: "Printer is not installed on this Windows machine: XP-80C" } })
      } as Response;
    }));
    await expect(printWindowsReceiptHtml(html, { orderNo: "TKO1" })).rejects.toThrow("Printer is not installed");
    expect(calls.filter((x) => x.url === "http://127.0.0.1:3210/print")).toHaveLength(1);
    const audit = calls.find((x) => x.url === "/api/pos/windows-print/diagnostic");
    expect(audit).toBeDefined();
    expect(JSON.parse(String(audit?.init?.body))).toMatchObject({
      order_no: "TKO1", stage: "response", reprint: false
    });
    expect(String(audit?.init?.body)).not.toContain("test-token");
    expect(String(audit?.init?.body)).not.toContain(html);
  });

  it("rejects a response without confirmed native text spool acceptance", async () => {
    stubWindowsRuntime();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return String(url).startsWith("/api/pos/windows-print/")
        ? { ok: true } as Response
        : { ok: true, json: async () => ({ ok: true, data: {
          printed: true, provider: "legacy_html_only", printer_name: "XP-80C"
        } }) } as Response;
    }));
    await expect(printWindowsReceiptHtml(html)).rejects.toThrow("Windows PrintDocument ไม่ยืนยัน");
    expect(calls).toEqual(["http://127.0.0.1:3210/print", "/api/pos/windows-print/diagnostic"]);
  });

  it("rejects non-loopback receipt destinations before any print", async () => {
    stubWindowsRuntime("https://example.com/health");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(printWindowsReceiptHtml(html)).rejects.toThrow("ไม่อนุญาตให้ส่งใบเสร็จ");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converts Thai receipt HTML to readable thermal-printer text with newlines", () => {
    const receipt = '<html><style>.x{display:none}</style><body><div>ข้าวมันไก่สามเซียน</div><div>ข้าวมันไก่ &amp; น้ำซุป</div><div>รวม 120.00 บาท</div></body></html>';
    const output = windowsReceiptHtmlToText(receipt);
    expect(output).toContain("ข้าวมันไก่สามเซียน\nข้าวมันไก่ & น้ำซุป\nรวม 120.00 บาท");
    expect(output).not.toContain("display:none");
    expect(output).not.toContain("<div>");
  });

  it("prevents a second sale receipt dispatch of the same order but permits PIN-authorized reprint", async () => {
    stubWindowsRuntime();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ ok: true, data: {
        printed: true, provider: "native_dotnet_print_document", printer_name: "XP-80C", job_id: "spool-ok"
      } }) } as Response;
    }));
    await printWindowsReceiptHtml(html, { orderNo: "TKO-261104-001" });
    await expect(printWindowsReceiptHtml(html, { orderNo: "TKO-261104-001" })).rejects.toThrow("ถูกส่งพิมพ์ไปแล้ว");
    expect(calls).toEqual(["http://127.0.0.1:3210/print"]);
    await printWindowsReceiptHtml(html, { orderNo: "TKO-261104-001", reprint: true });
    expect(calls).toHaveLength(2);
  });
});
