"use client";

import { useEffect } from "react";
import { KitchenKds } from "@/components/kitchen/kitchen-kds";

const KITCHEN_RETURN_MARKER_KEY = "pos_returning_from_kitchen_v1";

export default function PosKitchenPage() {
  useEffect(() => {
    window.sessionStorage.setItem(KITCHEN_RETURN_MARKER_KEY, "1");
  }, []);

  return <KitchenKds />;
}
