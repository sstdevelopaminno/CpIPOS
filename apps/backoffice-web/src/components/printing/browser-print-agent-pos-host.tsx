"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { BrowserPrintAgent } from "@/components/printing/browser-print-agent";
import { BrowserPrintAgentAlert } from "@/components/printing/browser-print-agent-alert";
import { BrowserPrintAgentDeployReset } from "@/components/printing/browser-print-agent-deploy-reset";
import { BrowserPrintAgentSerialRecovery } from "@/components/printing/browser-print-agent-serial-recovery";
import { BrowserPrintAgentSerialSetupGuard } from "@/components/printing/browser-print-agent-serial-setup-guard";

const POS_PATH_PREFIX = "/preview/pos";
const WEB_SERIAL_EXPERIMENTAL_KEY = "cpi_browser_print_agent_web_serial_experimental_v1";
const LEGACY_MOBILE_DIRECT_AGENT_KEY = "cpi_browser_print_agent_mobile_direct_v1";
const PRINT_AGENT_MODE_EVENT = "cpi-browser-print-agent-mode";

type PrintAgentMode = "bridge_print_station" | "mobile_remote_station" | "web_serial_experimental" | "unsupported_remote_station";

type PlatformInfo = {
  isMobile: boolean;
  isIos: boolean;
  isAndroid: boolean;
  isDesktop: boolean;
  webSerialSupported: boolean;
  userAgent: string;
};

function readWebSerialExperimentalOverride() {
  if (typeof window === "undefined") return false;
  return (
    window.localStorage.getItem(WEB_SERIAL_EXPERIMENTAL_KEY) === "1" ||
    window.localStorage.getItem(LEGACY_MOBILE_DIRECT_AGENT_KEY) === "1"
  );
}

function detectPlatform(): PlatformInfo {
  if (typeof window === "undefined") {
    return {
      isMobile: false,
      isIos: false,
      isAndroid: false,
      isDesktop: true,
      webSerialSupported: false,
      userAgent: ""
    };
  }

  const userAgent = window.navigator.userAgent || "";
  const platform = window.navigator.platform || "";
  const maxTouchPoints = window.navigator.maxTouchPoints ?? 0;
  const isAndroid = /Android/i.test(userAgent);
  const isIpadOs = platform === "MacIntel" && maxTouchPoints > 1;
  const isIos = /iPad|iPhone|iPod/i.test(userAgent) || isIpadOs;
  const isMobile = isAndroid || isIos || /Mobile|Tablet/i.test(userAgent);
  const webSerialSupported = "serial" in window.navigator;

  return {
    isMobile,
    isIos,
    isAndroid,
    isDesktop: !isMobile,
    webSerialSupported,
    userAgent
  };
}

function resolveMode(platform: PlatformInfo, allowWebSerialExperimental: boolean): PrintAgentMode {
  if (allowWebSerialExperimental && platform.webSerialSupported) return "web_serial_experimental";
  if (platform.isDesktop) return "bridge_print_station";
  if (platform.isMobile) return "mobile_remote_station";
  return "unsupported_remote_station";
}

function publishMode(mode: PrintAgentMode, platform: PlatformInfo) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PRINT_AGENT_MODE_EVENT, {
      detail: {
        mode,
        platform: platform.isIos ? "ios" : platform.isAndroid ? "android" : platform.isDesktop ? "desktop" : "unknown",
        webSerialSupported: platform.webSerialSupported,
        recommendedAdapter:
          mode === "web_serial_experimental"
            ? "WEB_SERIAL_EXPERIMENTAL"
            : platform.isAndroid
              ? "ANDROID_PRINT_BRIDGE"
              : platform.isIos
                ? "AIRPRINT_OR_LAN_BRIDGE"
                : "LOCAL_BRIDGE_WINDOWS",
        updatedAt: new Date().toISOString()
      }
    })
  );
}

export function BrowserPrintAgentPosHost() {
  const pathname = usePathname();
  const [allowWebSerialExperimental, setAllowWebSerialExperimental] = useState(false);
  const platform = useMemo(() => detectPlatform(), []);
  const mode = resolveMode(platform, allowWebSerialExperimental);
  const isPosPath = Boolean(pathname?.startsWith(POS_PATH_PREFIX));
  const shouldRunWebSerialAgent = mode === "web_serial_experimental";

  useEffect(() => {
    setAllowWebSerialExperimental(readWebSerialExperimentalOverride());

    function handleStorage(event: StorageEvent) {
      if (event.key === WEB_SERIAL_EXPERIMENTAL_KEY || event.key === LEGACY_MOBILE_DIRECT_AGENT_KEY) {
        setAllowWebSerialExperimental(readWebSerialExperimentalOverride());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!isPosPath) return;
    publishMode(mode, platform);
  }, [isPosPath, mode, platform]);

  if (!isPosPath) {
    return null;
  }

  return (
    <>
      {shouldRunWebSerialAgent ? <BrowserPrintAgentSerialSetupGuard /> : null}
      {shouldRunWebSerialAgent ? <BrowserPrintAgentDeployReset /> : null}
      {shouldRunWebSerialAgent ? <BrowserPrintAgentSerialRecovery /> : null}
      {shouldRunWebSerialAgent ? <BrowserPrintAgent /> : null}
      {shouldRunWebSerialAgent ? <BrowserPrintAgentAlert /> : null}
    </>
  );
}
