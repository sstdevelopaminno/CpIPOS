"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PosShiftCycleGuard as PosShiftCycleGuardCore } from "@/components/pos/pos-shift-cycle-guard-core";

type Lang = "th" | "en";

export function PosShiftCycleGuard({ lang }: { lang: Lang }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted) return null;

  return createPortal(<PosShiftCycleGuardCore lang={lang} />, document.body);
}
