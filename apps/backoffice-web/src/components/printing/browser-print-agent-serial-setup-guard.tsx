"use client";

import { useEffect } from "react";

const BROWSER_PRINT_AGENT_CONFIG_EVENT = "cpi-browser-print-agent-config";
const BROWSER_PRINT_AGENT_RESET_EVENT = "cpi-browser-print-agent-reset";
const BROWSER_PRINT_AGENT_FORGET_PORTS_EVENT = "cpi-browser-print-agent-forget-ports";
const BROWSER_PRINT_AGENT_ENABLED_KEY = "cpi_browser_print_agent_enabled_v1";
const BROWSER_PRINT_AGENT_SETUP_GUARD_ACTIVE_KEY = "cpi_browser_print_agent_setup_guard_active_until_v1";
const BROWSER_PRINT_AGENT_SETUP_GUARD_PREVIOUS_ENABLED_KEY = "cpi_browser_print_agent_setup_guard_previous_enabled_v1";

const MANUAL_SETUP_PAUSE_MS = 25000;

type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
  forget?: () => Promise<void>;
};

type SerialLike = {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: unknown): Promise<SerialPortLike>;
};

declare global {
  interface Navigator {
    serial?: SerialLike;
  }
}

function nowPlus(ms: number) {
  return String(Date.now() + ms);
}

function dispatchConfigReload(delayMs = 0) {
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_CONFIG_EVENT)), delayMs);
}

function dispatchReset(delayMs = 0) {
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_RESET_EVENT)), delayMs);
}

function dispatchForgetPorts(delayMs = 0) {
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_FORGET_PORTS_EVENT)), delayMs);
}

function rememberAndPauseAgent() {
  const currentlyEnabled = window.localStorage.getItem(BROWSER_PRINT_AGENT_ENABLED_KEY);
  window.localStorage.setItem(BROWSER_PRINT_AGENT_SETUP_GUARD_PREVIOUS_ENABLED_KEY, currentlyEnabled ?? "");
  window.localStorage.setItem(BROWSER_PRINT_AGENT_SETUP_GUARD_ACTIVE_KEY, nowPlus(MANUAL_SETUP_PAUSE_MS));
  window.localStorage.setItem(BROWSER_PRINT_AGENT_ENABLED_KEY, "0");
  dispatchReset();
  dispatchForgetPorts(150);
  dispatchConfigReload(250);
}

function resumeAgentLater() {
  const previousEnabled = window.localStorage.getItem(BROWSER_PRINT_AGENT_SETUP_GUARD_PREVIOUS_ENABLED_KEY);
  window.setTimeout(() => {
    window.localStorage.removeItem(BROWSER_PRINT_AGENT_SETUP_GUARD_ACTIVE_KEY);
    window.localStorage.removeItem(BROWSER_PRINT_AGENT_SETUP_GUARD_PREVIOUS_ENABLED_KEY);
    if (previousEnabled === "1" || previousEnabled === "true") {
      window.localStorage.setItem(BROWSER_PRINT_AGENT_ENABLED_KEY, "1");
    }
    dispatchConfigReload();
    dispatchConfigReload(1500);
  }, MANUAL_SETUP_PAUSE_MS);
}

async function forgetAuthorizedPorts(serial: SerialLike) {
  const ports = await serial.getPorts().catch(() => []);
  await Promise.allSettled(
    ports.map(async (port) => {
      try {
        await port.close();
      } catch {
        // ignore stale close errors
      }
      if (typeof port.forget === "function") {
        await port.forget().catch(() => undefined);
      }
    })
  );
}

export function BrowserPrintAgentSerialSetupGuard() {
  useEffect(() => {
    const serial = window.navigator.serial;
    if (!serial) return undefined;

    const originalRequestPort = serial.requestPort.bind(serial);
    let patched = true;

    serial.requestPort = async (options?: unknown) => {
      rememberAndPauseAgent();
      await forgetAuthorizedPorts(serial);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      try {
        const port = await originalRequestPort(options);
        window.localStorage.setItem(BROWSER_PRINT_AGENT_SETUP_GUARD_ACTIVE_KEY, nowPlus(MANUAL_SETUP_PAUSE_MS));
        return port;
      } finally {
        resumeAgentLater();
      }
    };

    return () => {
      if (!patched) return;
      patched = false;
      serial.requestPort = originalRequestPort;
    };
  }, []);

  return null;
}
