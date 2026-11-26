"use client";

import { useEffect } from "react";
import { withWindowsAgentDeadline } from "@/lib/printing/windows-agent-request";
import { confirmWindowsSpoolAck } from "@/lib/printing/windows-spool-ack-recovery";
import { hasLocalWindowsPrintBridge, openWindowsCashDrawerJob, prewarmWindowsHtmlRenderer, printWindowsReceiptHtml } from "@/lib/printing/windows-local-printer-test";

type Job = {
  id: string;
  agent_attempt_id: string;
  order_no: string | null;
  reprint?: boolean;
  kind: "html" | "cash_drawer";
  render_mode?: "html" | "native_text";
  fast_html?: boolean;
  sale_receipt?: boolean;
  html: string | null;
  text?: string | null;
  drawer?: { kickPin: 0 | 1; pulseOnMs: number; pulseOffMs: number } | null;
};
type Reply = { data?: { jobs?: Job[]; prewarm_fast_html?: boolean; status?: string }; error?: { code?: string; message?: string } };
const PRINTED_ATTEMPTS_LEDGER = "cpi_windows_native_agent_attempted_v1";
const AGENT_ENDPOINT = "/api/pos/windows-print/agent";

async function command(payload: Record<string, unknown>, signal?: AbortSignal) {
  return withWindowsAgentDeadline(async (requestSignal) => {
    const response = await fetch(AGENT_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
      signal: requestSignal
    });
    const body = await response.json() as Reply | null;
    if (!response.ok || body?.error) throw new Error(body?.error?.code ?? `windows_agent_http_${response.status}`);
    if (!body?.data || typeof body.data !== "object" || Array.isArray(body.data)) {
      throw new Error("windows_agent_invalid_response");
    }
    return body.data;
  }, signal);
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
    let priorityPollUntil = 0;
    let urgentWakePending = false;
    let warmRequested = false;
    // Only the authenticated Windows POS profile flagged for fast HTML
    // printing gets a shorter *idle* safety poll. Other tenants retain the
    // existing 12/30s cadence, and no polling occurs without local bridge.
    let enrolledFastPrinter = false;
    let authenticatedFastIdlePollMs: 5000 | null = null;
    // Do not run 5-second polls all day when the cashier station is idle:
    // only accelerate during a short, recently active cashier window.
    let fastPollingActiveUntil = 0;
    let nextPollAt = 0;

    const abort = new AbortController();

    async function poll() {
      if (stopped || inFlight) return;
      inFlight = true;
      // A payment response arrives before its after() print jobs are enqueued.
      // A short bounded burst keeps Windows printing fast without duplicating
      // any job. Idle stations retain the original low-frequency polling.
      let nextMs = Date.now() < priorityPollUntil ? 1_000 : (idlePolls > 7 ? 30_000 : 12_000);
      try {
        const data = await command({ action: "claim" }, abort.signal);
        const response = data as { jobs?: Job[]; prewarm_fast_html?: boolean; fast_idle_poll_ms?: number | null };
        if (!Array.isArray(response.jobs)) throw new Error("windows_agent_invalid_claim");
        enrolledFastPrinter = response.prewarm_fast_html === true;
        authenticatedFastIdlePollMs = response.fast_idle_poll_ms === 5000 ? 5000 : null;
        // Only prewarm when the authenticated claim identifies a printer
        // enrolled in fast HTML mode for this exact Windows POS session.
        if (response.prewarm_fast_html === true && !warmRequested) {
          warmRequested = true;
          void prewarmWindowsHtmlRenderer();
        }
        const jobs = response.jobs ?? [];
        const job = jobs[0];
        idlePolls = job ? 0 : idlePolls + 1;
        if (job && !stopped) {
          // Claim the next receipt/drawer job immediately after the previous
          // job has reached a terminal state. Agent still processes one at a time.
          nextMs = 350;
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
            let spoolAccepted = false;
            try {
              const spool = job.kind === "cash_drawer"
                ? await openWindowsCashDrawerJob(job.drawer)
                : job.kind === "html" && job.html
                  ? await printWindowsReceiptHtml(job.html, {
                      orderNo: job.sale_receipt === true ? job.order_no : null,
                      reprint: job.reprint === true,
                      plainText: job.text ?? null,
                      renderMode: job.render_mode === "native_text" ? "native_text" : "html",
                      fastHtml: job.fast_html === true
                    })
                  : (() => { throw new Error("windows_job_payload_invalid"); })();
              spoolAccepted = true;
              const ackPayload = {
                action: "ack", job_id: job.id, agent_attempt_id: job.agent_attempt_id,
                provider_job_id: spool.spoolJobId
              };
              const acknowledgement = await confirmWindowsSpoolAck(
                () => command(ackPayload, abort.signal), abort.signal
              );
              if (acknowledgement.status !== "printed") throw new Error("windows_agent_ack_unconfirmed");
              if (job.kind === "html" && job.sale_receipt && job.order_no) {
                window.dispatchEvent(new CustomEvent("cpi-windows-print-agent-result", {
                  detail: { orderNo: job.order_no, status: "spooled" }
                }));
              }
            } catch (error) {
              // A lost ACK is not a failed physical submission. Never send fail
              // or replay after the bridge accepted the spool job.
              if (spoolAccepted) throw error;
              await command({
                action: "fail", job_id: job.id, agent_attempt_id: job.agent_attempt_id,
                error_code: "windows_spool_failed_or_unknown",
                error_message: error instanceof Error ? error.message.slice(0, 190) : "unknown spool error"
              }, abort.signal);
              if (job.kind === "html" && job.sale_receipt && job.order_no) {
                window.dispatchEvent(new CustomEvent("cpi-windows-print-agent-result", {
                  detail: { orderNo: job.order_no, status: "failed" }
                }));
              }
            }
          }
        }
      } catch (error) {
        // Never increase polling against an unhealthy/unreachable endpoint.
        enrolledFastPrinter = false;
        authenticatedFastIdlePollMs = null;
        // No automatic retries of a claimed print; a later poll only claims a
        // different fresh job. On disconnect, the lease expires and server
        // rejects jobs too old for safe automatic printing.
        if (!stopped) {
          console.warn("[windows-print-agent] unavailable", error instanceof Error ? error.message : "unknown");
        }
        // The server's 180s device-health authorization is independent of the
        // print-agent heartbeat. Ask the existing sender to refresh actual
        // loopback health rather than bypassing the printer/session check.
        if (!stopped && error instanceof Error && error.message === "windows_agent_offline") {
          window.dispatchEvent(new Event("cpi-windows-print-health-recovery"));
        }
        priorityPollUntil = 0;
        nextMs = 15_000;
      } finally {
        inFlight = false;
        if (!stopped) {
          if (Date.now() < priorityPollUntil) nextMs = Math.min(nextMs, 1_000);
          else if (enrolledFastPrinter && authenticatedFastIdlePollMs === 5000 &&
                   document.visibilityState === "visible" &&
                   Date.now() < fastPollingActiveUntil)
            nextMs = Math.min(nextMs, authenticatedFastIdlePollMs);
          // A receipt can be enqueued while an earlier empty claim request
          // is still in flight. Honor the wake after that claim completes;
          // never claim concurrently or replay a prior job.
          const waitMs = urgentWakePending ? 0 : nextMs;
          urgentWakePending = false;
          if (timer) clearTimeout(timer);
          nextPollAt = Date.now() + waitMs;
          timer = setTimeout(() => { void poll(); }, waitMs);
        }
      }
    }

    // UI can signal that it is ABOUT to enqueue a new receipt/barcode/report.
    // Prime the agent only for the explicitly enrolled fast Windows profile;
    // other stores retain their original network/idle polling behavior.
    function primeFastPrint() {
      if (!enrolledFastPrinter || authenticatedFastIdlePollMs !== 5000 ||
          document.visibilityState !== "visible") return;
      wake(new Event("cpi-windows-print-agent-wake"));
    }
    function wake(event?: Event) {
      if (stopped) return;
      fastPollingActiveUntil = Date.now() + 120_000;
      priorityPollUntil = Date.now() + 16_000;
      idlePolls = 0;
      const urgent = event?.type === "cpi-windows-print-agent-wake";
      if (inFlight) {
        if (urgent) urgentWakePending = true;
        return;
      }
      if (timer) clearTimeout(timer);
      nextPollAt = Date.now() + (urgent ? 0 : 150);
      timer = setTimeout(() => { void poll(); }, urgent ? 0 : 150);
    }
    // Native host and local JS watchdog share the SAME serialized worker.
    // Only wake a genuinely overdue timer, never release an in-flight spool.
    function onWatchdogTick() {
      if (stopped || inFlight || !navigator.onLine || nextPollAt === 0 ||
          Date.now() - nextPollAt < 5_000) return;
      if (timer) clearTimeout(timer);
      nextPollAt = Date.now();
      void poll();
    }
    const watchdogTimer = setInterval(onWatchdogTick, 10_000);
    window.addEventListener("cpi-windows-native-watchdog", onWatchdogTick);
    function onVisibilityChange() {
      if (document.visibilityState === "visible") wake();
    }
    // WebView2 may throttle background fetch/timers or stay offline after the
    // Windows network adapter wakes. Recover on browser connectivity/page
    // lifecycle events without changing the idle polling schedule or replaying
    // an already-attempted Windows spool job.
    function onConnectivityRestored() {
      wake(new Event("cpi-windows-print-agent-wake"));
    }
    function onCashierActivity() {
      fastPollingActiveUntil = Date.now() + 120_000;
      // An idle 30s timer may already be armed. Shorten it on actual cashier
      // activity only for an authenticated, enrolled foreground printer.
      if (!inFlight && enrolledFastPrinter && authenticatedFastIdlePollMs === 5000 &&
          document.visibilityState === "visible" && nextPollAt - Date.now() > 5000) {
        wake();
      }
    }
    window.addEventListener("pointerdown", onCashierActivity, { passive: true });
    window.addEventListener("keydown", onCashierActivity);
    window.addEventListener("cpi-windows-print-agent-wake", wake);
    window.addEventListener("cpi-windows-fast-print-prime", primeFastPrint);
    window.addEventListener("focus", wake);
    window.addEventListener("online", onConnectivityRestored);
    window.addEventListener("pageshow", onConnectivityRestored);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      stopped = true;
      clearInterval(watchdogTimer);
      window.removeEventListener("cpi-windows-native-watchdog", onWatchdogTick);
      window.removeEventListener("pointerdown", onCashierActivity);
      window.removeEventListener("keydown", onCashierActivity);
      window.removeEventListener("cpi-windows-fast-print-prime", primeFastPrint);
      window.removeEventListener("cpi-windows-print-agent-wake", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", onConnectivityRestored);
      window.removeEventListener("pageshow", onConnectivityRestored);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
}
