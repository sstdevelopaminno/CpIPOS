"use client";

import { useEffect, useRef, useState } from "react";

export const BROWSER_PRINT_AGENT_ENABLED_KEY = "cpi_browser_print_agent_enabled_v1";
export const BROWSER_PRINT_AGENT_KEY = "cpi_browser_print_agent_key_v1";
export const BROWSER_PRINT_AGENT_BAUD_KEY = "cpi_browser_print_agent_baud_v1";
export const BROWSER_PRINT_AGENT_STATUS_EVENT = "cpi-browser-print-agent-status";
export const BROWSER_PRINT_AGENT_CONFIG_EVENT = "cpi-browser-print-agent-config";
export const BROWSER_PRINT_AGENT_RESET_EVENT = "cpi-browser-print-agent-reset";
export const BROWSER_PRINT_AGENT_FORGET_PORTS_EVENT = "cpi-browser-print-agent-forget-ports";

export type BrowserPrintAgentStatus = {
  enabled: boolean;
  supported: boolean;
  connected: boolean;
  code: string;
  message: string;
  jobsPrinted: number;
  lastJobId: string | null;
  updatedAt: string;
};

type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  forget?: () => Promise<void>;
  writable: WritableStream<Uint8Array> | null;
};

type SerialLike = {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: unknown): Promise<SerialPortLike>;
  addEventListener?(type: "connect" | "disconnect", listener: EventListener): void;
  removeEventListener?(type: "connect" | "disconnect", listener: EventListener): void;
};

type BrowserPrintJob = {
  id: string;
  payload_text?: string | null;
  payload_json?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  printer_profiles?: null | {
    printer_name?: string | null;
    paper_width_mm?: 58 | 80 | null;
    metadata?: Record<string, unknown> | null;
  };
};

type ClaimResponse = {
  data?: {
    jobs?: BrowserPrintJob[];
  };
  error?: {
    message?: string;
  };
};

declare global {
  interface Navigator {
    serial?: SerialLike;
  }
}

const POLL_MS = 4000;
const HIDDEN_POLL_MS = 15000;
const MAX_ERROR_BACKOFF_MS = 60000;
const SERIAL_RETRY_DELAY_MS = 350;
const SERIAL_MAX_OPEN_FAILURES_BEFORE_FORGET = 3;
const APP_VERSION = "browser-web-serial-1.0.5-hard-serial-reset";

function readBool(value: string | null) {
  return value === "1" || value === "true";
}

function readBaudRate(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 9600;
  return Math.min(921600, Math.max(1200, Math.trunc(parsed)));
}

function readConfig() {
  if (typeof window === "undefined") return { enabled: false, agentKey: "", baudRate: 9600 };
  return {
    enabled: readBool(window.localStorage.getItem(BROWSER_PRINT_AGENT_ENABLED_KEY)),
    agentKey: window.localStorage.getItem(BROWSER_PRINT_AGENT_KEY)?.trim() ?? "",
    baudRate: readBaudRate(window.localStorage.getItem(BROWSER_PRINT_AGENT_BAUD_KEY))
  };
}

function dispatchStatus(status: Omit<BrowserPrintAgentStatus, "updatedAt">) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BrowserPrintAgentStatus>(BROWSER_PRINT_AGENT_STATUS_EVENT, {
      detail: { ...status, updatedAt: new Date().toISOString() }
    })
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isCashDrawerJob(job: BrowserPrintJob) {
  const metadata = job.metadata ?? {};
  const payload = job.payload_json ?? {};
  return metadata.command === "open_cash_drawer" || payload.command === "open_cash_drawer";
}

function bytesForCashDrawer() {
  return new Uint8Array([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x32, 0xfa]);
}

function receiptHtmlForJob(job: BrowserPrintJob) {
  const metadata = readRecord(job.metadata);
  const payload = readRecord(job.payload_json);
  return readString(metadata.payload_html) ?? readString(metadata.receipt_html) ?? readString(payload.payload_html) ?? readString(payload.receipt_html);
}

function decodeHtml(value: string) {
  if (typeof document === "undefined") return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function stripHtmlToLines(html: string) {
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|hr)\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|tr|table|section|article|main|header|footer|dl)>/gi, "\n")
    .replace(/<\/(td|th|dt|dd|span|strong)>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(withBreaks)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 160);
}

function textToLines(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 160);
}

function paperWidthMmForJob(job: BrowserPrintJob): 58 | 80 {
  return job.printer_profiles?.paper_width_mm === 80 ? 80 : 58;
}

function printerDotsForPaper(paperWidthMm: 58 | 80) {
  return paperWidthMm === 80 ? 576 : 384;
}

function cssPxForMm(mm: number) {
  return mm * (96 / 25.4);
}

function wrapCanvasLine(ctx: CanvasRenderingContext2D, line: string, maxWidth: number) {
  if (ctx.measureText(line).width <= maxWidth) return [line];
  const words = line.split(/\s+/).filter(Boolean);
  const wrapped: string[] = [];
  let current = "";
  for (const word of words.length ? words : [line]) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      wrapped.push(current);
      current = word;
    }
  }
  if (current) wrapped.push(current);
  return wrapped;
}

function rasterBytesFromCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_context_missing");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const widthBytes = Math.ceil(canvas.width / 8);
  const raster = new Uint8Array(widthBytes * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      const alpha = image[offset + 3] ?? 0;
      const lum = (image[offset] ?? 255) * 0.299 + (image[offset + 1] ?? 255) * 0.587 + (image[offset + 2] ?? 255) * 0.114;
      if (alpha > 96 && lum < 190) raster[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const header = new Uint8Array([
    0x1b,
    0x40,
    0x1d,
    0x76,
    0x30,
    0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    canvas.height & 0xff,
    (canvas.height >> 8) & 0xff
  ]);
  const cut = new Uint8Array([0x0a, 0x0a, 0x1d, 0x56, 0x00]);
  const output = new Uint8Array(header.length + raster.length + cut.length);
  output.set(header, 0);
  output.set(raster, header.length);
  output.set(cut, header.length + raster.length);
  return output;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function waitForAssets(root: HTMLElement) {
  const fonts = "fonts" in document ? document.fonts : null;
  await fonts?.ready.catch(() => undefined);
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.allSettled(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        })
    )
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function sanitizeReceiptHtml(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script,iframe,object,embed").forEach((node) => node.remove());
  return {
    styles: Array.from(parsed.querySelectorAll("style")).map((style) => style.textContent ?? "").join("\n"),
    body: parsed.body?.innerHTML?.trim() || html
  };
}

async function rasterBytesFromReceiptHtml(job: BrowserPrintJob, html: string) {
  const paperWidthMm = paperWidthMmForJob(job);
  const printerWidthPx = printerDotsForPaper(paperWidthMm);
  const cssWidthPx = cssPxForMm(paperWidthMm);
  const scale = printerWidthPx / cssWidthPx;
  const sanitized = sanitizeReceiptHtml(html);
  const styleText = `
.receipt-print-page{box-sizing:border-box;width:${paperWidthMm}mm;min-height:1px;margin:0;overflow:visible;background:#fff;color:#000;font-family:Tahoma,"Noto Sans Thai",Arial,sans-serif;text-rendering:geometricPrecision;}
.receipt-print-page *{box-sizing:border-box;}
.receipt-print-page img{max-width:100%;}
${sanitized.styles.replace(/@page[^{}]*\{[^{}]*\}/gi, "")}`;

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${cssWidthPx}px`;
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";

  const page = document.createElement("div");
  page.className = "receipt-print-page";
  page.innerHTML = `<style>${styleText}</style>${sanitized.body}`;
  host.appendChild(page);
  document.body.appendChild(host);

  try {
    await waitForAssets(page);
    const rect = page.getBoundingClientRect();
    const cssHeightPx = Math.ceil(Math.max(rect.height, page.scrollHeight, 120));
    const canvasHeightPx = Math.max(120, Math.ceil(cssHeightPx * scale));
    const printPage = page.cloneNode(true) as HTMLElement;
    printPage.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const serializedPage = new XMLSerializer().serializeToString(printPage);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cssWidthPx}" height="${cssHeightPx}" viewBox="0 0 ${cssWidthPx} ${cssHeightPx}"><foreignObject width="100%" height="100%">${serializedPage}</foreignObject></svg>`;
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    if (!image) throw new Error("receipt_html_image_render_failed");

    const canvas = document.createElement("canvas");
    canvas.width = printerWidthPx;
    canvas.height = canvasHeightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_context_missing");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, printerWidthPx, canvasHeightPx);
    return rasterBytesFromCanvas(canvas);
  } finally {
    host.remove();
  }
}

async function rasterBytesFromReceiptText(job: BrowserPrintJob, html?: string | null) {
  const lines = html ? stripHtmlToLines(html) : textToLines(job.payload_text?.trim() || "CpIPOS print job");
  const paperWidthMm = paperWidthMmForJob(job);
  const width = printerDotsForPaper(paperWidthMm);
  const canvas = document.createElement("canvas");
  const firstPass = canvas.getContext("2d");
  if (!firstPass) throw new Error("canvas_context_missing");
  const padding = 14;
  const lineHeight = 30;
  firstPass.font = '800 23px "Tahoma", "Noto Sans Thai", sans-serif';
  const wrapped = lines.flatMap((line) => wrapCanvasLine(firstPass, line.replace(/\?(\d)/g, "฿$1"), width - padding * 2));
  canvas.width = width;
  canvas.height = Math.max(120, padding * 2 + wrapped.length * lineHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_context_missing");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  ctx.font = '800 23px "Tahoma", "Noto Sans Thai", sans-serif';
  let y = padding;
  for (const line of wrapped) {
    const isCenter = y < padding + lineHeight * 4 || line === "CpIPOS";
    ctx.textAlign = isCenter ? "center" : "left";
    ctx.fillText(line, isCenter ? width / 2 : padding, y);
    y += lineHeight;
  }
  return rasterBytesFromCanvas(canvas);
}

async function bytesForReceipt(job: BrowserPrintJob) {
  if (typeof document === "undefined") {
    const body = new TextEncoder().encode((job.payload_text?.trim() || "CpIPOS print job") + "\n\n\n");
    const output = new Uint8Array(2 + body.length + 3);
    output.set([0x1b, 0x40], 0);
    output.set(body, 2);
    output.set([0x1d, 0x56, 0x00], 2 + body.length);
    return output;
  }

  const html = receiptHtmlForJob(job);
  if (html) {
    try {
      return await rasterBytesFromReceiptHtml(job, html);
    } catch (error) {
      console.warn("[browser-print-agent] receipt HTML raster failed; falling back to text raster", {
        jobId: job.id,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      return rasterBytesFromReceiptText(job, html);
    }
  }
  return rasterBytesFromReceiptText(job);
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function postAgentApi<T>(path: string, agentKey: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${agentKey}`
    },
    body: JSON.stringify(body)
  });
  return { response, body: await readJson<T>(response) };
}

async function safeClosePort(port: SerialPortLike | null) {
  if (!port) return;
  try {
    await port.close();
  } catch {
    // Ignore close errors from already-disconnected or already-closed ports.
  }
}

async function forgetPort(port: SerialPortLike | null) {
  if (!port) return;
  await safeClosePort(port);
  try {
    await port.forget?.();
  } catch {
    // Some browser/adapter combinations do not support forget() yet.
  }
}

async function forgetRememberedPorts() {
  const ports = await navigator.serial?.getPorts().catch(() => []);
  await Promise.allSettled((ports ?? []).map((port) => forgetPort(port)));
}

async function tryOpenPort(port: SerialPortLike, baudRate: number) {
  if (port.writable) return true;
  try {
    await port.open({ baudRate });
    return Boolean(port.writable);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("already open") && port.writable) return true;
    await safeClosePort(port);
    await sleep(SERIAL_RETRY_DELAY_MS);
    try {
      await port.open({ baudRate });
      return Boolean(port.writable);
    } catch {
      await safeClosePort(port);
      return false;
    }
  }
}

type EnsureSerialPortResult =
  | { ok: true; port: SerialPortLike }
  | { ok: false; code: "serial_permission_required" | "serial_reconnect_waiting" | "serial_reselect_required"; message: string };

async function ensureSerialPort(
  portRef: { current: SerialPortLike | null },
  baudRate: number,
  consecutiveOpenFailuresRef: { current: number }
): Promise<EnsureSerialPortResult> {
  if (portRef.current?.writable) return { ok: true, port: portRef.current };

  if (portRef.current) {
    await safeClosePort(portRef.current);
    portRef.current = null;
  }

  const ports = await navigator.serial?.getPorts().catch(() => []);
  if (!ports || ports.length === 0) {
    consecutiveOpenFailuresRef.current = 0;
    return {
      ok: false,
      code: "serial_permission_required",
      message: "ยังไม่ได้เลือกพอร์ตเครื่องพิมพ์ กรุณากดเลือกเครื่องจาก Windows อีกครั้ง"
    };
  }

  for (const port of ports) {
    if (await tryOpenPort(port, baudRate)) {
      portRef.current = port;
      consecutiveOpenFailuresRef.current = 0;
      return { ok: true, port };
    }
  }

  consecutiveOpenFailuresRef.current += 1;
  if (consecutiveOpenFailuresRef.current >= SERIAL_MAX_OPEN_FAILURES_BEFORE_FORGET) {
    await forgetRememberedPorts();
    consecutiveOpenFailuresRef.current = 0;
    portRef.current = null;
    return {
      ok: false,
      code: "serial_permission_required",
      message: "Chrome ล้างพอร์ตเดิมที่เปิดไม่ได้แล้ว กรุณากดเลือกเครื่องจาก Windows ใหม่หนึ่งครั้ง"
    };
  }

  return {
    ok: false,
    code: "serial_reconnect_waiting",
    message: "กำลังรอเครื่องพิมพ์กลับมาเชื่อมต่อ ระบบจะลองเปิดพอร์ตให้อัตโนมัติ"
  };
}

async function writeToPort(port: SerialPortLike, bytes: Uint8Array) {
  if (!port.writable) throw new Error("serial_port_not_writable");
  const writer = port.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

export function BrowserPrintAgent() {
  const [config, setConfig] = useState(readConfig);
  const portRef = useRef<SerialPortLike | null>(null);
  const jobsPrintedRef = useRef(0);
  const lastJobIdRef = useRef<string | null>(null);
  const consecutiveOpenFailuresRef = useRef(0);

  useEffect(() => {
    const reload = () => setConfig(readConfig());
    const reset = () => {
      const port = portRef.current;
      portRef.current = null;
      consecutiveOpenFailuresRef.current = 0;
      void safeClosePort(port);
      jobsPrintedRef.current = 0;
      lastJobIdRef.current = null;
      reload();
      dispatchStatus({
        enabled: readConfig().enabled,
        supported: Boolean(navigator.serial),
        connected: false,
        code: "reset",
        message: "Browser Print Agent was reset.",
        jobsPrinted: 0,
        lastJobId: null
      });
    };
    const forgetAndReset = () => {
      const port = portRef.current;
      portRef.current = null;
      consecutiveOpenFailuresRef.current = 0;
      void forgetPort(port)
        .then(forgetRememberedPorts)
        .finally(() => {
          jobsPrintedRef.current = 0;
          lastJobIdRef.current = null;
          reload();
          dispatchStatus({
            enabled: readConfig().enabled,
            supported: Boolean(navigator.serial),
            connected: false,
            code: "serial_permission_required",
            message: "ระบบล้างพอร์ตเดิมแล้ว กรุณากดเลือกเครื่องจาก Windows ใหม่หนึ่งครั้ง",
            jobsPrinted: 0,
            lastJobId: null
          });
        });
    };
    const handleSerialDisconnect = () => {
      const port = portRef.current;
      portRef.current = null;
      void safeClosePort(port);
      dispatchStatus({
        enabled: readConfig().enabled,
        supported: Boolean(navigator.serial),
        connected: false,
        code: "serial_reconnect_waiting",
        message: "เครื่องพิมพ์หลุดการเชื่อมต่อ ระบบจะลองเชื่อมต่อใหม่อัตโนมัติเมื่อเครื่องกลับมา",
        jobsPrinted: jobsPrintedRef.current,
        lastJobId: lastJobIdRef.current
      });
    };
    const handleSerialConnect = () => {
      consecutiveOpenFailuresRef.current = 0;
      window.setTimeout(reload, 350);
      window.setTimeout(reload, 1800);
    };
    const onStorage = (event: StorageEvent) => {
      if ([BROWSER_PRINT_AGENT_ENABLED_KEY, BROWSER_PRINT_AGENT_KEY, BROWSER_PRINT_AGENT_BAUD_KEY].includes(event.key ?? "")) reload();
    };
    window.addEventListener(BROWSER_PRINT_AGENT_CONFIG_EVENT, reload);
    window.addEventListener(BROWSER_PRINT_AGENT_RESET_EVENT, reset);
    window.addEventListener(BROWSER_PRINT_AGENT_FORGET_PORTS_EVENT, forgetAndReset);
    window.addEventListener("storage", onStorage);
    navigator.serial?.addEventListener?.("disconnect", handleSerialDisconnect);
    navigator.serial?.addEventListener?.("connect", handleSerialConnect);
    return () => {
      window.removeEventListener(BROWSER_PRINT_AGENT_CONFIG_EVENT, reload);
      window.removeEventListener(BROWSER_PRINT_AGENT_RESET_EVENT, reset);
      window.removeEventListener(BROWSER_PRINT_AGENT_FORGET_PORTS_EVENT, forgetAndReset);
      window.removeEventListener("storage", onStorage);
      navigator.serial?.removeEventListener?.("disconnect", handleSerialDisconnect);
      navigator.serial?.removeEventListener?.("connect", handleSerialConnect);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    let errorStreak = 0;
    const supported = Boolean(navigator.serial);

    const publish = (code: string, message: string) => {
      dispatchStatus({
        enabled: config.enabled,
        supported,
        connected: Boolean(portRef.current?.writable),
        code,
        message,
        jobsPrinted: jobsPrintedRef.current,
        lastJobId: lastJobIdRef.current
      });
    };

    const scheduleNext = (delayMs: number) => {
      if (!active) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(tick, delayMs);
    };

    const tick = async () => {
      if (!active) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        scheduleNext(HIDDEN_POLL_MS);
        return;
      }
      try {
        if (!config.enabled) {
          publish("disabled", "Browser Print Agent is disabled.");
          return;
        }
        if (!supported) {
          publish("web_serial_unsupported", "This browser does not support Web Serial.");
          return;
        }
        if (!config.agentKey) {
          publish("agent_key_missing", "Print Agent secret is missing.");
          return;
        }

        const ensured = await ensureSerialPort(portRef, config.baudRate, consecutiveOpenFailuresRef);
        if (!ensured.ok) {
          publish(ensured.code, ensured.message);
          return;
        }

        const claim = await postAgentApi<ClaimResponse>("/api/print-agent/v1/jobs/claim", config.agentKey, {
          limit: 3,
          lease_seconds: 45,
          app_version: APP_VERSION
        });
        if (!claim.response.ok || claim.body?.error) throw new Error(claim.body?.error?.message ?? `claim_failed_${claim.response.status}`);

        const jobs = claim.body?.data?.jobs ?? [];
        for (const job of jobs) {
          try {
            const bytes = isCashDrawerJob(job) ? bytesForCashDrawer() : await bytesForReceipt(job);
            await writeToPort(ensured.port, bytes);
            await postAgentApi(`/api/print-agent/v1/jobs/${encodeURIComponent(job.id)}/ack`, config.agentKey, {
              provider_job_id: `browser:${Date.now()}`,
              bytes_sent: bytes.length,
              metadata: { provider: "browser_web_serial", baud_rate: config.baudRate, app_version: APP_VERSION }
            });
            jobsPrintedRef.current += 1;
            lastJobIdRef.current = job.id;
          } catch (jobError) {
            lastJobIdRef.current = job.id;
            const message = jobError instanceof Error ? jobError.message : "browser_serial_print_failed";
            const port = portRef.current;
            portRef.current = null;
            void safeClosePort(port);
            await postAgentApi(`/api/print-agent/v1/jobs/${encodeURIComponent(job.id)}/fail`, config.agentKey, {
              error_message: message,
              error_code: "browser_serial_print_failed",
              retryable: true,
              metadata: { provider: "browser_web_serial", baud_rate: config.baudRate, app_version: APP_VERSION }
            });
            publish("browser_serial_print_failed", message);
          }
        }

        errorStreak = 0;
        publish(jobs.length > 0 ? "printed" : "ready", jobs.length > 0 ? `Printed ${jobs.length} job(s).` : "Ready.");
      } catch (error) {
        errorStreak = Math.min(errorStreak + 1, 10);
        publish("agent_error", error instanceof Error ? error.message : "Browser Print Agent failed.");
      } finally {
        const backoffDelay = errorStreak > 0 ? Math.min(POLL_MS * 2 ** errorStreak, MAX_ERROR_BACKOFF_MS) : POLL_MS;
        scheduleNext(backoffDelay);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    void tick();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [config]);

  return null;
}
