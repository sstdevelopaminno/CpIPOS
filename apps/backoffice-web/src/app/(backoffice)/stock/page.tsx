import { StockModule } from "@/components/backoffice/stock-module";
import { CatalogBundleTools } from "@/components/backoffice/catalog-bundle-tools";

export default function StockPage() {
  return (
    <div className="space-y-6">
      <StockModule />
      <CatalogBundleTools />
    </div>
  );
}
