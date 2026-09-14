import type { ReactNode } from "react";
import { StockBestSellersToolbarBridge } from "@/components/pos-preview/stock-best-sellers-toolbar-bridge";
import { StockCatalogMutationReload } from "@/components/pos-preview/stock-catalog-mutation-reload";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function StockTemplate({ children }: { children: ReactNode }) {
  const lang = await getCurrentLanguage();

  return (
    <>
      <StockCatalogMutationReload />
      <StockBestSellersToolbarBridge th={lang === "th"} />
      {children}
    </>
  );
}
