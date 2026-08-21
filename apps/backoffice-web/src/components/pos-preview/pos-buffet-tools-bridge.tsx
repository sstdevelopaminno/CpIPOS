"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const TOOLBAR_ID = "stock-page-action-toolbar";

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function PosBuffetToolsBridge({ th }: { th: boolean }) {
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const sync = () => setToolbar(document.getElementById(TOOLBAR_ID));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("return_mode") !== "buffet_table") return;
    let cancelled = false;

    const run = async () => {
      for (let index = 0; index < 30 && !cancelled; index += 1) {
        const switchButton = document.querySelector<HTMLButtonElement>(".posui-mode-switch-button");
        if (switchButton && !switchButton.disabled) {
          switchButton.click();
          break;
        }
        await wait(100);
      }
      for (let index = 0; index < 30 && !cancelled; index += 1) {
        const buffetButton = document.querySelector<HTMLElement>('[data-pos-sale-mode="buffet_table"]');
        if (buffetButton && buffetButton.getAttribute("data-pos-mode-hidden") !== "true") {
          buffetButton.click();
          break;
        }
        await wait(100);
      }
      if (!cancelled) {
        const cleaned = new URL(window.location.href);
        cleaned.searchParams.delete("return_mode");
        window.history.replaceState(window.history.state, "", `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!toolbar) return null;
  return createPortal(
    <Link
      href="/preview/pos/stock/buffet-sets"
      prefetch={false}
      className="inline-flex min-h-8 items-center rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-bold text-orange-700 shadow-sm transition hover:bg-orange-100"
    >
      {th ? "จัดชุดบุฟเฟ่" : "Buffet Sets"}
    </Link>,
    toolbar
  );
}
