"use client";

import { useEffect, useRef, useState } from "react";
import {
  agentAttemptIdForJob,
  bytesForCashDrawer,
  bytesForReceipt,
  isCashDrawerJob,
  postAgentApi,
  recentlyPhysicallyPrinted,
  rememberPhysicalPrint,
  sleep,
  dispatchStatus as dispatchSharedStatus,
  type BrowserPrintAgentStatus,
  type BrowserPrintJob,
  type ClaimResponse
} from "@/components/printing/browser-print-shared";

export const BROWSER_PRINT_AGENT_ENABLED_KEY = "cpi_browser_print_agent_enabled_v1";
export const BROWSER_PRINT_AGENT_KEY = "cpi_browser_print_agent_key_v1";
export const BROWSER_PRINT_AGENT_BAUD_KEY = "cpi_browser_print_agent_baud_v1";
export const BROWSER_PRINT_AGENT_STATUS_EVENT = "cpi-browser-print-agent-status";
export const BROWSER_PRINT_AGENT_CONFIG_EVENT = "cpi-browser-print-agent-config";
export const BROWSER_PRINT_AGENT_RESET_EVENT = "cpi-browser-print-agent-reset";
export const BROWSER_PRINT_AGENT_FORGET_PORTS_EVENT = "cpi-browser-print-agent-forget-ports";

export type { BrowserPrintAgentStatus };

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

declare global {
  interface Navigator {
    serial?: SerialLike;
  }
}

const POLL_MS = 4000;
const IDLE_POLL_MS = 10000;
const DEEP_IDLE_POLL_MS = 20000;
const HIDDEN_POLL_MS = 30000;
const DEEP_IDLE_AFTER_EMPTY_POLLS = 6;
const MAX_ERROR_BACKOFF_MS = 60000;
const SERIAL_RETRY_DELAY_MS = 350;
const SERIAL_MAX_OPEN_FAILURES_BEFORE_RESELECT = 3;
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
  dispatchSharedStatus(BROWSER_PRINT_AGENT_STATUS_EVENT, status);
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
  if (consecutiveOpenFailuresRef.current >= SERIAL_MAX_OPEN_FAILURES_BEFORE_RESELECT) {
    // Never revoke Web Serial permission automatically. Another tab/runtime can temporarily
    // own the same COM port; forgetting it here made the printer disappear from Settings and
    // forced the operator to discover/pair it again. Explicit "forget/reset" remains available.
    return {
      ok: false,
      code: "serial_reselect_required",
      message: "พอร์ตเครื่องพิมพ์ยังถูกใช้งานหรือเปิดไม่ได้ กรุณาปิดแท็บ/โปรแกรมที่ใช้เครื่องนี้ แล้วลองใหม่ หากต้องล้างสิทธิ์ให้กดรีเซ็ตเครื่องพิมพ์ด้วยตนเอง"
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
    let emptyPollStreak = 0;
    let tickInFlight = false;
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
      if (tickInFlight) {
        scheduleNext(POLL_MS);
        return;
      }
      tickInFlight = true;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        tickInFlight = false;
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
        emptyPollStreak = jobs.length > 0 ? 0 : Math.min(emptyPollStreak + 1, DEEP_IDLE_AFTER_EMPTY_POLLS);
        for (const job of jobs) {
          const agentAttemptId = agentAttemptIdForJob(job);
          const alreadySent = recentlyPhysicallyPrinted(job.id);
          if (alreadySent) {
            const recoveredAck = await postAgentApi(`/api/print-agent/v1/jobs/${encodeURIComponent(job.id)}/ack`, config.agentKey, {
              agent_attempt_id: agentAttemptId,
              provider_job_id: `browser-recovered:${job.id}`,
              bytes_sent: alreadySent.bytes_sent,
              metadata: {
                provider: "browser_web_serial",
                app_version: APP_VERSION,
                duplicate_suppressed: true,
                physical_send_recovered: true,
                physical_sent_at_ms: alreadySent.sent_at_ms
              }
            });
            if (!recoveredAck.response.ok || recoveredAck.body?.error) {
              throw new Error(recoveredAck.body?.error?.message ?? `ack_recovery_failed_${recoveredAck.response.status}`);
            }
            lastJobIdRef.current = job.id;
            continue;
          }

          let physicallySent = false;
          try {
            const bytes = isCashDrawerJob(job) ? bytesForCashDrawer() : await bytesForReceipt(job);
            await writeToPort(ensured.port, bytes);
            physicallySent = true;
            rememberPhysicalPrint(job.id, "browser_web_serial", bytes.length);
            const ack = await postAgentApi(`/api/print-agent/v1/jobs/${encodeURIComponent(job.id)}/ack`, config.agentKey, {
              agent_attempt_id: agentAttemptId,
              provider_job_id: `browser:${Date.now()}`,
              bytes_sent: bytes.length,
              metadata: { provider: "browser_web_serial", baud_rate: config.baudRate, app_version: APP_VERSION }
            });
            if (!ack.response.ok || ack.body?.error) {
              throw new Error(ack.body?.error?.message ?? `ack_failed_${ack.response.status}`);
            }
            jobsPrintedRef.current += 1;
            lastJobIdRef.current = job.id;
          } catch (jobError) {
            lastJobIdRef.current = job.id;
            const message = jobError instanceof Error ? jobError.message : "browser_serial_print_failed";
            if (physicallySent) {
              // The printer already accepted the bytes. Do not mark the job failed or it may
              // be printed twice. Let the lease retry and recover via the durable local ledger.
              publish("print_ack_pending", "พิมพ์ออกแล้ว แต่ยืนยันผลกับเซิร์ฟเวอร์ยังไม่สำเร็จ ระบบจะยืนยันซ้ำโดยไม่พิมพ์กระดาษซ้ำ");
              continue;
            }
            const port = portRef.current;
            portRef.current = null;
            void safeClosePort(port);
            await postAgentApi(`/api/print-agent/v1/jobs/${encodeURIComponent(job.id)}/fail`, config.agentKey, {
              agent_attempt_id: agentAttemptId,
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
        emptyPollStreak = 0;
        publish("agent_error", error instanceof Error ? error.message : "Browser Print Agent failed.");
      } finally {
        tickInFlight = false;
        const idleDelay = emptyPollStreak >= DEEP_IDLE_AFTER_EMPTY_POLLS ? DEEP_IDLE_POLL_MS : emptyPollStreak > 0 ? IDLE_POLL_MS : POLL_MS;
        const backoffDelay = errorStreak > 0 ? Math.min(POLL_MS * 2 ** errorStreak, MAX_ERROR_BACKOFF_MS) : idleDelay;
        scheduleNext(backoffDelay);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        emptyPollStreak = 0;
        if (timer) {
          window.clearTimeout(timer);
          timer = null;
        }
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
