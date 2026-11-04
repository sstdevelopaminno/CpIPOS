"use client";

import { useEffect } from "react";
import { hasLocalWindowsPrintBridge, printWindowsReceiptHtml } from "@/lib/printing/windows-local-printer-test";

type Job = {
  id: string;
  order_id: string;
  agent_attempt_id: string;
  order_no: string | null;
  reprint?: boolean;
  html: string;
  text?: string | null;
};
type Reply = { data?: { jobs?: Job[] }; error?: { code?: string; message?: string } };
const PRINTED_ATTEMPTS_LEDGER = "cpi_windows_native_agent_attempted_v1";
const AGENT_ENDPOINT = "/api/pos/windows-print/agent";

async function command(payload: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(AGENT_ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
    signal
  });
  const body = await response.json().catch(() => null) as Reply | null;
  if (!response.ok || body?.error) throw new Error(body?.error?.code ?? `windows_agent_http_${response.status}`);
  return body?.data ?? {};
}

function alreadyAttempted(jobId: string) {
  try {
    const ledger = JSON.parse(window.localStorage.getItem(PRINTED_ATTEMPTS_LEDGER) ?? "{}") as Record<string, unknown>;
    return typeof ledger[jobId] === "number";
  } catch {
    // Corrupt ledger means we cannot guarantee no duplicate: fail closed.
    return true;
  }
}

function markAttempted(jobId: string) {
  // Write BEFORE requesting the Windows spooler. Unknown outcomes must never
  // cause an automatic duplicate on a later claim, reload, or lease expiry.
  const raw = window.localStorage.getItem(PRINTED_ATTEMPTS_LEDGER) ?? "{}";
  const old = JSON.parse(raw) as Record<string, unknown>;
  const entries = Object.entries(old).filter((entry) => Number.isFinite(entry[1]));
  const recent = entries.slice(-240);
  const latest = Object.fromEntries([...recent, [jobId, Date.now()]]);
  window.localStorage.setItem(PRINTED_ATTEMPTS_LEDGER, JSON.stringify(latest));
}

export function WindowsNativePrintAgent() {
  useEffect(() => {
    if (!hasLocalWindowsPrintBridge()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let idlePolls = 0;
    const abort = new AbortController();

    async function poll() {
      if (stopped || inFlight) return;
      inFlight = true;
      let nextMs = idlePolls > 7 ? 30_000 : 12_000;
      try {
        const data = await command({ action: "claim" }, abort.signal);
        const jobs = (data as { jobs?: Job[] }).jobs ?? [];
        const job = jobs[0];
        idlePolls = job ? 0 : idlePolls + 1;
        if (job && !stopped) {
          nextMs = 4_000;
          if (alreadyAttempted(job.id)) {
            await command({
              action: "fail", job_id: job.id, agent_attempt_id: job.agent_attempt_id,
              error_code: "windows_duplicate_prevented",
              error_message: "This job was submitted previously or the Windows attempt ledger is unavailable."
            }, abort.signal);
          } else {
            try {
              markAttempted(job.id);
            } catch {
              await command({
                action: "fail", job_id: job.id, agent_attempt_id: job.agent_attempt_id,
                error_code: "windows_ledger_unavailable",
                error_message: "Cannot persist the duplicate-prevention ledger."
              }, abort.signal);
              return;
            }
            try {
              const spool = await printWindowsReceiptHtml(job.html, {
                orderNo: job.order_no,
                orderId: job.order_id,
                reprint: job.reprint === true,
                plainText: job.text ?? null
              });
              await command({
                action: "ack", job_id: job.id, agent_attempt_id: job.agent_attempt_id,
                provider_job_id: spool.spoolJobId
              }, abort.signal);
            } catch (error) {
              await command({
                action: "fail", job_id: job.id, agent_attempt_id: job.agent_attempt_id,
                error_code: "windows_spool_failed_or_unknown",
                error_message: error instanceof Error ? error.message.slice(0, 190) : "unknown spool error"
              }, abort.signal);
            }
          }
        }
      } catch (error) {
        // No automatic retries of a claimed print; a later poll only claims a
        // different fresh job. On disconnect, the lease expires and server
        // rejects jobs too old for safe automatic printing.
        if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("[windows-print-agent] unavailable", error instanceof Error ? error.message : "unknown");
        }
        nextMs = 15_000;
      } finally {
        inFlight = false;
        if (!stopped) timer = setTimeout(() => { void poll(); }, nextMs);
      }
    }

    function wake() {
      if (stopped || inFlight) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void poll(); }, 500);
    }
    window.addEventListener("cpi-windows-print-agent-wake", wake);
    void poll();
    return () => {
      stopped = true;
      window.removeEventListener("cpi-windows-print-agent-wake", wake);
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
}
