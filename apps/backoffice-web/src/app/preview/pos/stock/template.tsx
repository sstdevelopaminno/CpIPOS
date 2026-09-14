import type { ReactNode } from "react";
import { StockCatalogMutationReload } from "@/components/pos-preview/stock-catalog-mutation-reload";

export default async function StockTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      <StockCatalogMutationReload />
      {children}
    </>
  );
}
