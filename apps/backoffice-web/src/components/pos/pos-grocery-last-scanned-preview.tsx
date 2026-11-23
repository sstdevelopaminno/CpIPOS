"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { resolveProductMediaCardUrls, type ProductMediaCardAsset } from "@/lib/pos/product-media-cache";
import type { GeneralSaleLastScannedProduct } from "@/lib/pos-general-sale-mode";

type ProductMediaResponse = {
  data?: {
    images?: Record<string, ProductMediaCardAsset>;
    device_cache_enabled?: boolean;
    quota?: { device_cache_quota_bytes?: number } | null;
  } | null;
};

type Props = {
  product: GeneralSaleLastScannedProduct | null;
  language: "th" | "en" | "lo";
};

export function PosGroceryLastScannedPreview({ product, language }: Props) {
  const productId = product?.id ?? null;
  const [resolved, setResolved] = useState<{ productId: string; url: string } | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let releaseMedia: () => void = () => undefined;
    const controller = new AbortController();
    setResolved(null);
    setImageFailed(false);

    if (productId) {
      // Fetch only the accepted last-scanned product. Media is optional:
      // a missing photo, failed request or offline session displays the logo.
      void fetch(`/api/pos/product-media?product_ids=${encodeURIComponent(productId)}`, {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal
      }).then(async (response) => {
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as ProductMediaResponse | null;
      }).then(async (body) => {
        if (!body?.data || disposed) return;
        const media = await resolveProductMediaCardUrls(body.data.images ?? {}, {
          enabled: body.data.device_cache_enabled === true,
          maxBytes: Math.max(0, Number(body.data.quota?.device_cache_quota_bytes ?? 0))
        });
        if (disposed) {
          media.revoke();
          return;
        }
        releaseMedia = media.revoke;
        const url = media.urls[productId] ?? "";
        if (url) setResolved({ productId, url });
      }).catch(() => {
        // The checkout flow must never depend on the image service.
      });
    }
    return () => {
      disposed = true;
      controller.abort();
      releaseMedia();
    };
  }, [productId]);

  const useProductPhoto = Boolean(productId && resolved?.productId === productId && resolved.url && !imageFailed);
  const label = language === "en" ? "Last scanned product"
    : language === "lo" ? "ສິນຄ້າສະແກນລ່າສຸດ"
    : "สินค้าที่สแกนล่าสุด";
  const logoAlt = language === "en" ? "CpiPOS logo" : "โลโก้ CpiPOS";

  return (
    <section data-testid="pos-grocery-last-scanned-product"
      aria-label={label}
      className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden bg-white px-3 py-3">
      <p className="m-0 text-center text-xs font-bold text-slate-500">{label}</p>
      <div className="relative flex min-h-[100px] h-full max-h-[min(42vh,320px)] w-full max-w-[320px] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
        {useProductPhoto ? (
          <Image
            key={productId}
            src={resolved!.url}
            alt={product?.name || label}
            fill
            unoptimized
            sizes="(max-width: 860px) 90vw, 320px"
            className="object-contain p-3"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Image
            src="/brand/cpipos-logo.png"
            alt={logoAlt}
            width={280}
            height={105}
            unoptimized
            className="h-auto max-h-full w-full max-w-[230px] object-contain opacity-90"
          />
        )}
      </div>
      <p aria-live="polite" className="m-0 max-w-full truncate text-center text-sm font-bold text-slate-800">
        {product?.name ?? (language === "en" ? "Ready to scan" : language === "lo" ? "ພ້ອມສະແກນ" : "พร้อมสแกนสินค้า")}
      </p>
      {product?.sku ? <small className="max-w-full break-all text-center font-mono text-xs text-slate-500">{product.sku}</small> : null}
    </section>
  );
}
