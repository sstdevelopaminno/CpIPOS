"use client";

import { useEffect } from "react";
import { KitchenKds } from "@/components/kitchen/kitchen-kds";
import type { AppLanguage } from "@/lib/app-language-client";

const KITCHEN_RETURN_MARKER_KEY = "pos_returning_from_kitchen_v1";

export function PosKitchenScreen({ language = "th" }: { language?: AppLanguage }) {
  useEffect(() => {
    window.sessionStorage.setItem(KITCHEN_RETURN_MARKER_KEY, "1");
  }, []);

  return <KitchenKds defaultLanguage={language} />;
}
