"use client";

import { useEffect, useRef, useState } from "react";

export const BROWSER_PRINT_AGENT_ENABLED_KEY = "cpi_browser_print_agent_enabled_v1";
export const BROWSER_PRINT_AGENT_KEY = "cpi_browser_print_agent_key_v1";
export const BROWSER_PRINT_AGENT_BAUD_KEY = "cpi_browser_print_agent_baud_v1";
export const BROWSER_PRINT_AGENT_STATUS_EVENT = "cpi-browser-print-agent-status";
export const BROWSER_PRINT_AGENT_CONFIG_EVENT = "cpi-browser-print-agent-config";
export const BROWSER_PRINT_AGENT_RESET_EVENT = "cpi-browser-print-agent-reset";

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
  writable: WritableStream<Uint8Array> | null;
};

type SerialLike = {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: unknown): Promise<SerialPortLike>;
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
const APP_VERSION = "browser-web-serial-1.0.0";

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
  window.dispatchEvent(new CustomEvent<BrowserPrintAgentStatus>(BROWSER_PRINT_AGENT_STATUS_EVENT, {
    detail: { ...status, updatedAt: new Date().toISOString() }
  }));
}

function isCashDrawerJob(job: BrowserPrintJob) {
  const metadata = job.metadata ?? {};
  const payload = job.payload_json ?? {};
  return metadata.command === "open_cash_drawer" || payload.command === "open_cash_drawer";
}

function bytesForCashDrawer() {
  return new Uint8Array([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x32, 0xfa]);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

function htmlToLines(html: string) {
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
    .slice(0, 80);
}

function textToLines(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 80);
}

function wrapCanvasLine(ctx: CanvasRenderingContext2D, line: string, maxWidth: number) {
  if (ctx.measureText(line).width <= maxWidth) return [line];
  const words = line.split(/\s+/).filter(Boolean);
  const wrapped: string[] = [];
  let current = "";
  for (const word of words.length ? words : [line]) {
    const next = current ? current + " " + word : word;
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

function extractFirstImageSrc(html: string) {
  return /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
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
      const lum = ((image[offset] ?? 255) * 0.299) + ((image[offset + 1] ?? 255) * 0.587) + ((image[offset + 2] ?? 255) * 0.114);
      if (alpha > 96 && lum < 190) raster[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const header = new Uint8Array([0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, canvas.height & 0xff, (canvas.height >> 8) & 0xff]);
  const cut = new Uint8Array([0x0a, 0x0a, 0x1d, 0x56, 0x00]);
  const output = new Uint8Array(header.length + raster.length + cut.length);
  output.set(header, 0);
  output.set(raster, header.length);
  output.set(cut, header.length + raster.length);
  return output;
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
  const lines = html ? htmlToLines(html) : textToLines(job.payload_text?.trim() || "CpIPOS print job");
  const canvas = document.createElement("canvas");
  const width = job.printer_profiles?.paper_width_mm === 80 ? 576 : 384;
  const padding = 14;
  const lineHeight = 26;
  const qrSrc = html ? extractFirstImageSrc(html) : null;
  const firstPass = canvas.getContext("2d");
  if (!firstPass) throw new Error("canvas_context_missing");
  firstPass.font = '700 21px "Tahoma", "Noto Sans Thai", sans-serif';
  const wrapped = lines.flatMap((line) => wrapCanvasLine(firstPass, line, width - padding * 2));
  const qrHeight = qrSrc ? Math.min(width - padding * 2, 300) + 18 : 0;
  canvas.width = width;
  canvas.height = Math.max(120, padding * 2 + wrapped.length * lineHeight + qrHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_context_missing");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  ctx.font = '700 21px "Tahoma", "Noto Sans Thai", sans-serif';
  let y = padding;
  for (const line of wrapped) {
    const isCenter = y < padding + lineHeight * 5 || line === "CpIPOS";
    ctx.textAlign = isCenter ? "center" : "left";
    ctx.fillText(line, isCenter ? width / 2 : padding, y);
    y += lineHeight;
  }
  if (qrSrc) {
    const img = await loadImage(qrSrc);
    if (img) {
      const size = Math.min(width - padding * 2, 300);
      ctx.drawImage(img, (width - size) / 2, y + 8, size, size);
    }
  }
  return rasterBytesFromCanvas(canvas);
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

async function ensureSerialPort(portRef: { current: SerialPortLike | null }, baudRate: number) {
  if (portRef.current?.writable) return portRef.current;
  const ports = await navigator.serial?.getPorts();
  const port = ports?.[0] ?? null;
  if (!port) return null;
  try {
    await port.open({ baudRate });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("already open")) throw error;
  }
  portRef.current = port;
  return port;
}

export function BrowserPrintAgent() {
  const [config, setConfig] = useState(readConfig);
  const portRef = useRef<SerialPortLike | null>(null);
  const jobsPrintedRef = useRef(0);
  const lastJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    const reload = () => setConfig(readConfig());
    const reset = () => {
      const port = portRef.current;
      portRef.current = null;
      if (port) void port.close().catch(() => undefined);
      jobsPrintedRef.current = 0;
      lastJobIdRef.current = null;
      reload();
      dispatchStatus({
        enabled: false,
        supported: Boolean(navigator.serial),
        connected: false,
        code: "reset",
        message: "Browser Print Agent was reset.",
        jobsPrinted: 0,
        lastJobId: null
      });
    };
    const onStorage = (event: StorageEvent) => {
      if ([BROWSER_PRINT_AGENT_ENABLED_KEY, BROWSER_PRINT_AGENT_KEY, BROWSER_PRINT_AGENT_BAUD_KEY].includes(event.key ?? "")) reload();
    };
    window.addEventListener(BROWSER_PRINT_AGENT_CONFIG_EVENT, reload);
    window.addEventListener(BROWSER_PRINT_AGENT_RESET_EVENT, reset);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BROWSER_PRINT_AGENT_CONFIG_EVENT, reload);
      window.removeEventListener(BROWSER_PRINT_AGENT_RESET_EVENT, reset);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    const supported = Boolean(navigator.serial);

    const stopWithStatus = (code: string, message: string) => {
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

    const tick = async () => {
      if (!active) return;
      try {
        if (!config.enabled) {
          stopWithStatus("disabled", "Browser Print Agent is disabled.");
          return;
        }
        if (!supported) {
          stopWithStatus("web_serial_unsupported", "This browser does not support Web Serial.");
          return;
        }
        if (!config.agentKey) {
          stopWithStatus("agent_key_missing", "Print Agent secret is missing.");
          return;
        }

        const port = await ensureSerialPort(portRef, config.baudRate);
        if (!port) {
          stopWithStatus("serial_permission_required", "Select a printer port once to allow auto reconnect.");
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
            await writeToPort(port, bytes);
            await postAgentApi(`/api/print-agent/v1/jobs/${encodeURIComponent(job.id)}/ack`, config.agentKey, {
              provider_job_id: `browser:${Date.now()}`,
              bytes_sent: bytes.length,
              metadata: { provider: "browser_web_serial", baud_rate: config.baudRate }
            });
            jobsPrintedRef.current += 1;
            lastJobIdRef.current = job.id;
          } catch (jobError) {
            await postAgentApi(`/api/print-agent/v1/jobs/${encodeURIComponent(job.id)}/fail`, config.agentKey, {
              error_message: jobError instanceof Error ? jobError.message : "browser_serial_print_failed",
              error_code: "browser_serial_print_failed",
              retryable: true,
              metadata: { provider: "browser_web_serial", baud_rate: config.baudRate }
            });
          }
        }

        stopWithStatus(jobs.length > 0 ? "printed" : "ready", jobs.length > 0 ? `Printed ${jobs.length} job(s).` : "Ready.");
      } catch (error) {
        stopWithStatus("agent_error", error instanceof Error ? error.message : "Browser Print Agent failed.");
      } finally {
        if (active) timer = window.setTimeout(tick, POLL_MS);
      }
    };

    void tick();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [config]);

  return null;
}
