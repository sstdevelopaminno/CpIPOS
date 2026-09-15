"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BestSellersPopupButton } from "@/components/pos-preview/best-sellers-popup-button";

type BranchOption = {
  id: string;
  name: string;
  code: string | null;
};

type Props = {
  th: boolean;
};

const TOOLBAR_ID = "stock-page-action-toolbar";
const BRANCH_SELECTOR_ID = "stock-branch-selector-control";

function readBranchSelector() {
  const select = document.getElementById(BRANCH_SELECTOR_ID) as HTMLSelectElement | null;
  if (!select) {
    return {
      branchId: "",
      branchOptions: [] as BranchOption[],
      canViewAllBranches: false,
      select: null as HTMLSelectElement | null
    };
  }

  const branchOptions = Array.from(select.options).map((option) => ({
    id: option.value,
    name: option.textContent?.trim() || option.value,
    code: null
  }));

  return {
    branchId: select.value,
    branchOptions,
    canViewAllBranches: !select.disabled,
    select
  };
}

export function StockBestSellersToolbarBridge({ th }: Props) {
  const [mountTarget, setMountTarget] = useState<HTMLElement | null>(null);
  const [branchId, setBranchId] = useState("");
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([]);
  const [canViewAllBranches, setCanViewAllBranches] = useState(false);

  useEffect(() => {
    let selectorObserver: MutationObserver | null = null;

    const sync = () => {
      const toolbar = document.getElementById(TOOLBAR_ID);
      const branchState = readBranchSelector();
      setMountTarget(toolbar);
      setBranchId(branchState.branchId);
      setBranchOptions(branchState.branchOptions);
      setCanViewAllBranches(branchState.canViewAllBranches);

      selectorObserver?.disconnect();
      if (branchState.select) {
        selectorObserver = new MutationObserver(sync);
        selectorObserver.observe(branchState.select, {
          attributes: true,
          attributeFilter: ["disabled"]
        });
      }
    };

    const handleChange = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.id === BRANCH_SELECTOR_ID) {
        sync();
      }
    };

    const bodyObserver = new MutationObserver(sync);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", handleChange, true);
    const frameId = window.requestAnimationFrame(sync);

    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener("change", handleChange, true);
      bodyObserver.disconnect();
      selectorObserver?.disconnect();
    };
  }, []);

  if (!mountTarget || !branchId) return null;

  return createPortal(
    <BestSellersPopupButton
      th={th}
      branchId={branchId}
      branchOptions={branchOptions}
      canViewAllBranches={canViewAllBranches}
    />,
    mountTarget
  );
}
