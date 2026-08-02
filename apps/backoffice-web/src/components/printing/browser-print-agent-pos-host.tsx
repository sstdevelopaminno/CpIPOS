"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { BrowserPrintAgent } from "@/components/printing/browser-print-agent";
import { BrowserPrintAgentAlert } from "@/components/printing/browser-print-agent-alert";
import { BrowserPrintAgentDeployReset } from "@/components/printing/browser-print-agent-deploy-reset";
import { BrowserPrintAgentSerialRecovery } from "@/components/printing/browser-print-agent-serial-recovery";

const POS_PATH_PREFIX = "/preview/pos";
const MOBILE_DIRECT_AGENT_KEY = "cpi_browser_print_agent_mobile_direct_v1";
const PRINT_AGENT_MODE_EVENT = "cpi-browser-print-agent-mode";

type PrintAgentMode = "desktop_local_agent" | "mobile_remote_station" | "unsupported_remote_station";

type PlatformInfo = {
  isMobile: boolean;
  isIos: boolean;
  isAndroid: boolean;
  isDesktop: boolean;
  webSerialSupported: boolean;
  userAgent: string;
};

function readMobileDirectOverride() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MOBILE_DIRECT_AGENT_KEY) === "1";
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

function resolveMode(platform: PlatformInfo, allowMobileDirectAgent: boolean): PrintAgentMode {
  if (platform.isDesktop && platform.webSerialSupported) return "desktop_local_agent";
  if (platform.isMobile && allowMobileDirectAgent && platform.webSerialSupported) return "desktop_local_agent";
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
        updatedAt: new Date().toISOString()
      }
    })
  );
}

export function BrowserPrintAgentPosHost() {
  const pathname = usePathname();
  const [allowMobileDirectAgent, setAllowMobileDirectAgent] = useState(false);
  const platform = useMemo(() => detectPlatform(), []);
  const mode = resolveMode(platform, allowMobileDirectAgent);
  const isPosPath = Boolean(pathname?.startsWith(POS_PATH_PREFIX));
  const shouldRunLocalAgent = mode === "desktop_local_agent";

  useEffect(() => {
    setAllowMobileDirectAgent(readMobileDirectOverride());

    function handleStorage(event: StorageEvent) {
      if (event.key === MOBILE_DIRECT_AGENT_KEY) {
        setAllowMobileDirectAgent(readMobileDirectOverride());
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
      {shouldRunLocalAgent ? <BrowserPrintAgentDeployReset /> : null}
      {shouldRunLocalAgent ? <BrowserPrintAgentSerialRecovery /> : null}
      {shouldRunLocalAgent ? <BrowserPrintAgent /> : null}
      {shouldRunLocalAgent ? <BrowserPrintAgentAlert /> : null}
    </>
  );
}
