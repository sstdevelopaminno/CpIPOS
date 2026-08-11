"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";

export function PosProductMediaToolbarLink({ th }: { th: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (pathname !== "/preview/pos/stock") {
      setTarget(null);
      return;
    }

    const findTarget = () => {
      const actions = document.querySelector<HTMLElement>("#stock-page-action-toolbar > div > div:last-child");
      const fallback = document.getElementById("stock-page-action-toolbar");
      setTarget(actions ?? fallback);
    };

    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  if (pathname !== "/preview/pos/stock" || !target) return null;
  const branchId = searchParams.get("branch_id")?.trim();
  const href = branchId
    ? `/preview/pos/stock/media?branch_id=${encodeURIComponent(branchId)}`
    : "/preview/pos/stock/media";

  return createPortal(
    <a
      href={href}
      className="inline-flex min-h-8 items-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-bold text-violet-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-100"
    >
      {th ? "รูปสินค้า" : "Product Images"}
    </a>,
    target
  );
}
