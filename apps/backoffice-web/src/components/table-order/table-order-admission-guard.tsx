"use client";

import { useEffect, useRef, useState } from "react";
import {
  TABLE_ORDER_CONTENTION_MAX_ATTEMPTS,
  resolveTableOrderContentionRetryMs
} from "@/lib/table-order-admission-policy";

type SubmitPhase = "sending" | "queued";

type ErrorEnvelope = {
  error?: {
    code?: string;
  };
};

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function requestAction(init?: RequestInit) {
  if (typeof init?.body !== "string") return null;
  try {
    const body = JSON.parse(init.body) as { action?: unknown };
    return typeof body.action === "string" ? body.action : null;
  } catch {
    return null;
  }
}

function isFoodOrderSubmission(input: RequestInfo | URL, init?: RequestInit) {
  return (
    requestMethod(input, init) === "POST" &&
    requestUrl(input).includes("/api/table-order/") &&
    requestAction(init) === "order"
  );
}

async function readErrorCode(response: Response) {
  try {
    const body = (await response.clone().json()) as ErrorEnvelope;
    return body?.error?.code ?? null;
  } catch {
    return null;
  }
}

function waitForRetry(delayMs: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function TableOrderAdmissionGuard() {
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>("sending");
  const activeRequestsRef = useRef(0);

  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isFoodOrderSubmission(input, init)) return nativeFetch(input, init);

      activeRequestsRef.current += 1;
      setPhase("sending");
      setBusy(true);

      try {
        for (let attempt = 1; attempt <= TABLE_ORDER_CONTENTION_MAX_ATTEMPTS; attempt += 1) {
          const response = await nativeFetch(input, init);
          const errorCode = response.ok ? null : await readErrorCode(response);
          const retryMs = resolveTableOrderContentionRetryMs({
            status: response.status,
            errorCode,
            retryAfter: response.headers.get("retry-after"),
            attempt
          });

          if (retryMs === null) return response;

          setPhase("queued");
          await waitForRetry(retryMs, init?.signal);
        }

        return nativeFetch(input, init);
      } finally {
        activeRequestsRef.current = Math.max(0, activeRequestsRef.current - 1);
        if (activeRequestsRef.current === 0) setBusy(false);
      }
    };

    return () => {
      window.fetch = nativeFetch;
      activeRequestsRef.current = 0;
    };
  }, []);

  if (!busy) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "rgba(15, 23, 42, 0.48)",
        backdropFilter: "blur(3px)"
      }}
    >
      <div
        style={{
          width: "min(420px, 92vw)",
          borderRadius: 22,
          background: "#ffffff",
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.24)",
          padding: "28px 24px",
          textAlign: "center",
          color: "#0f172a"
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 46,
            height: 46,
            margin: "0 auto 16px",
            borderRadius: "50%",
            border: "4px solid #dbeafe",
            borderTopColor: "#2563eb",
            animation: "cpipos-table-order-spin 0.8s linear infinite"
          }}
        />
        <strong style={{ display: "block", fontSize: 20, lineHeight: 1.35 }}>
          {phase === "queued" ? "กำลังจัดส่งอาหารตามคิว" : "กำลังส่งรายการอาหาร"}
        </strong>
        <span style={{ display: "block", marginTop: 8, color: "#64748b", fontSize: 14, lineHeight: 1.55 }}>
          โปรดรอสักครู่ ระบบกำลังประมวลผลรายการ และป้องกันการส่งซ้ำ
        </span>
        <style>{`@keyframes cpipos-table-order-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
