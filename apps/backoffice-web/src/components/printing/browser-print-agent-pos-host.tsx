"use client";

import { usePathname } from "next/navigation";
import { BrowserPrintAgent } from "@/components/printing/browser-print-agent";
import { BrowserPrintAgentAlert } from "@/components/printing/browser-print-agent-alert";

const POS_PATH_PREFIX = "/preview/pos";

export function BrowserPrintAgentPosHost() {
  const pathname = usePathname();

  if (!pathname?.startsWith(POS_PATH_PREFIX)) {
    return null;
  }

  return (
    <>
      <BrowserPrintAgent />
      <BrowserPrintAgentAlert />
    </>
  );
}
