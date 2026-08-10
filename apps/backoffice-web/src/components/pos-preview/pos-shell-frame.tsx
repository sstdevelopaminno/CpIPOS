"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BrowserPrintAgent } from "@/components/printing/browser-print-agent";
import { PosShellSidebar } from "@/components/pos-preview/pos-shell-sidebar";
import type { Language } from "@/lib/i18n";

export type MainMenuPlacement = "left" | "top" | "bottom";

const POS_MAIN_MENU_PLACEMENT_KEY = "pos_main_menu_bar_position_v2";
const POS_MAIN_MENU_PLACEMENT_EVENT = "pos-main-menu-placement-updated";

function parseMenuPlacement(value: string | null | undefined): MainMenuPlacement | null {
  if (value === "left" || value === "top" || value === "bottom") return value;
  return null;
}

function persistPlacementCookie(placement: MainMenuPlacement) {
  document.cookie = `${POS_MAIN_MENU_PLACEMENT_KEY}=${placement}; path=/; max-age=31536000; SameSite=Lax`;
}

export function PosShellFrame({
  children,
  lang,
  settingsLabel,
  initialPlacement = "left"
}: {
  children: ReactNode;
  lang: Language;
  settingsLabel: string;
  initialPlacement?: MainMenuPlacement;
}) {
  const [placement, setPlacement] = useState<MainMenuPlacement>(initialPlacement);

  useEffect(() => {
    const applyPlacement = (nextPlacement: MainMenuPlacement) => {
      setPlacement((current) => (current === nextPlacement ? current : nextPlacement));
      persistPlacementCookie(nextPlacement);
    };

    const readPlacement = () => {
      try {
        const storedPlacement = parseMenuPlacement(window.localStorage.getItem(POS_MAIN_MENU_PLACEMENT_KEY));
        const nextPlacement = storedPlacement ?? initialPlacement;
        if (!storedPlacement) {
          window.localStorage.setItem(POS_MAIN_MENU_PLACEMENT_KEY, nextPlacement);
        }
        applyPlacement(nextPlacement);
      } catch {
        applyPlacement(initialPlacement);
      }
    };

    const onPlacementUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ placement?: string | null }>).detail;
      const nextPlacement = parseMenuPlacement(detail?.placement);
      if (!nextPlacement) return;
      applyPlacement(nextPlacement);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== POS_MAIN_MENU_PLACEMENT_KEY) return;
      applyPlacement(parseMenuPlacement(event.newValue) ?? "left");
    };

    readPlacement();
    window.addEventListener(POS_MAIN_MENU_PLACEMENT_EVENT, onPlacementUpdated as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(POS_MAIN_MENU_PLACEMENT_EVENT, onPlacementUpdated as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [initialPlacement]);

  const sidebar = <PosShellSidebar lang={lang} settingsLabel={settingsLabel} placement={placement} />;
  const content = (
    <section className={`pos-app-content-area pos-app-content-area--${placement} flex min-h-0 min-w-0 flex-1 overflow-hidden`}>
      {children}
    </section>
  );

  return (
    <div className={`pos-app-frame pos-app-frame--${placement} flex h-full min-h-0 w-full overflow-hidden`} data-menu-placement={placement}>
      <BrowserPrintAgent />
      {placement === "bottom" ? (
        <>
          {content}
          {sidebar}
        </>
      ) : (
        <>
          {sidebar}
          {content}
        </>
      )}
    </div>
  );
}
