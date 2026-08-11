"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { PosProductCard } from "@/components/pos-ui/pos-product-card";
import { PosProductGrid } from "@/components/pos-ui/pos-product-grid";
import { resolveProductMediaCardUrls, type ProductMediaCardAsset } from "@/lib/pos/product-media-cache";

type ProductCatalogItem = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  is_active: boolean;
  stock_on_hand_units?: number | null;
  is_out_of_stock?: boolean;
  has_recipe_deduction?: boolean;
};

type Props = {
  products: ProductCatalogItem[];
  isDeliveryMode: boolean;
  storefrontPriceLabel: string;
  stockRemainingLabel?: string;
  outOfStockLabel?: string;
  getProductPrice: (product: ProductCatalogItem) => number;
  onAddProduct: (product: ProductCatalogItem) => void;
};

type MediaResponse = {
  data?: {
    images?: Record<string, ProductMediaCardAsset>;
    quota?: { device_cache_quota_bytes?: number } | null;
    device_cache_enabled?: boolean;
  } | null;
};

function PosProductCatalogInner({ products, isDeliveryMode, storefrontPriceLabel, stockRemainingLabel = "Stock", outOfStockLabel = "Out of stock", getProductPrice, onAddProduct }: Props) {
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const productIdsKey = useMemo(() => products.map((product) => product.id).join(","), [products]);

  useEffect(() => {
    let cancelled = false;
    let dispose: () => void = () => undefined;
    if (!productIdsKey) {
      setImageUrls({});
      return () => undefined;
    }

    void fetch(`/api/pos/product-media?product_ids=${encodeURIComponent(productIdsKey)}`, {
      cache: "no-store",
      credentials: "include"
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as MediaResponse | null;
      })
      .then(async (body) => {
        if (cancelled || !body?.data) return;
        const resolved = await resolveProductMediaCardUrls(body.data.images ?? {}, {
          enabled: body.data.device_cache_enabled === true,
          maxBytes: Math.max(0, Number(body.data.quota?.device_cache_quota_bytes ?? 0))
        });
        if (cancelled) {
          resolved.revoke();
          return;
        }
        dispose = resolved.revoke;
        setImageUrls(resolved.urls);
      })
      .catch(() => {
        if (!cancelled) setImageUrls({});
      });

    return () => {
      cancelled = true;
      dispose();
    };
  }, [productIdsKey]);

  return (
    <PosProductGrid>
      {products.map((product) => (
        <PosProductCard
          key={product.id}
          title={product.name}
          subtitle={product.sku && product.sku !== product.id ? product.sku : undefined}
          imageUrl={imageUrls[product.id] || undefined}
          price={getProductPrice(product)}
          secondaryPrice={isDeliveryMode ? Number(product.price) : null}
          secondaryLabel={isDeliveryMode ? storefrontPriceLabel : undefined}
          badge={
            product.is_out_of_stock
              ? outOfStockLabel
              : product.stock_on_hand_units !== null && product.stock_on_hand_units !== undefined
                ? `${stockRemainingLabel}: ${product.stock_on_hand_units}`
                : undefined
          }
          disabled={product.is_out_of_stock === true}
          onAdd={() => onAddProduct(product)}
        />
      ))}
    </PosProductGrid>
  );
}

export const PosProductCatalog = memo(PosProductCatalogInner);
