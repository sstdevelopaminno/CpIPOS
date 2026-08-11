"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ProductMediaManagerProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
};

type MediaAsset = {
  asset_id: string;
  product_id: string;
  image_url: string;
  thumbnail_url: string;
  display_bytes: number;
  thumbnail_bytes: number;
  updated_at: string;
};

type MediaQuota = {
  package_code: string | null;
  package_name: string | null;
  cloud_quota_bytes: number;
  device_cache_quota_bytes: number;
  cloud_used_bytes: number;
  cloud_remaining_bytes: number;
};

type MediaResponse = {
  data?: {
    images?: Record<string, MediaAsset>;
    image_count?: number;
    quota?: MediaQuota;
    device_cache_enabled?: boolean;
  } | null;
  error?: { code?: string; message?: string } | null;
};

type UploadResponse = {
  data?: { product_id?: string; asset?: MediaAsset | null; quota?: MediaQuota } | null;
  error?: { code?: string; message?: string } | null;
};

type Props = {
  th: boolean;
  branchId: string;
  branchName: string;
  products: ProductMediaManagerProduct[];
  canManage: boolean;
};

type OptimizedImage = {
  display: Blob;
  thumbnail: Blob;
  displayWidth: number;
  displayHeight: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
};

type DeviceEstimate = {
  usage: number;
  quota: number;
};

const ACCEPTED_SOURCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SOURCE_MAX_BYTES = 20 * 1024 * 1024;
const PAGE_SIZE = 10;

function formatBytes(value: number) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 100 ? 0 : 1)} KB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(mib >= 100 ? 0 : 1)} MB`;
  return `${(mib / 1024).toFixed(2)} GB`;
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_decode_failed"));
    };
    image.src = url;
  });
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== "image/webp") reject(new Error("webp_encode_failed"));
      else resolve(blob);
    }, "image/webp", quality);
  });
}

async function renderSquare(image: HTMLImageElement, maxSize: number, quality: number) {
  const sourceWidth = Math.max(1, image.naturalWidth || image.width);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height);
  const crop = Math.min(sourceWidth, sourceHeight);
  const sx = Math.max(0, (sourceWidth - crop) / 2);
  const sy = Math.max(0, (sourceHeight - crop) / 2);
  const outputSize = Math.min(maxSize, Math.max(320, crop));
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("canvas_unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, outputSize, outputSize);
  context.drawImage(image, sx, sy, crop, crop, 0, 0, outputSize, outputSize);
  return { blob: await canvasToWebp(canvas, quality), width: outputSize, height: outputSize };
}

async function optimizeProductImage(file: File): Promise<OptimizedImage> {
  if (!ACCEPTED_SOURCE_TYPES.has(file.type)) throw new Error("รองรับเฉพาะ JPG, PNG และ WebP");
  if (file.size <= 0 || file.size > SOURCE_MAX_BYTES) throw new Error("ไฟล์ต้นฉบับต้องมีขนาดไม่เกิน 20 MB");
  const image = await loadImage(file);
  const [display, thumbnail] = await Promise.all([
    renderSquare(image, 1200, 0.82),
    renderSquare(image, 400, 0.76)
  ]);
  if (display.blob.size > 1_572_864) throw new Error("รูปหลังปรับขนาดยังใหญ่เกิน 1.5 MB กรุณาเลือกรูปที่รายละเอียดน้อยลง");
  if (thumbnail.blob.size > 524_288) throw new Error("Thumbnail หลังปรับขนาดใหญ่เกิน 512 KB");
  return {
    display: display.blob,
    thumbnail: thumbnail.blob,
    displayWidth: display.width,
    displayHeight: display.height,
    thumbnailWidth: thumbnail.width,
    thumbnailHeight: thumbnail.height
  };
}

export function ProductMediaManager({ th, branchId, branchName, products, canManage }: Props) {
  const [images, setImages] = useState<Record<string, MediaAsset>>({});
  const [quota, setQuota] = useState<MediaQuota | null>(null);
  const [deviceCacheEnabled, setDeviceCacheEnabled] = useState(false);
  const [deviceEstimate, setDeviceEstimate] = useState<DeviceEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showSummary, setShowSummary] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pickerProductRef = useRef<ProductMediaManagerProduct | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ids = products.map((product) => product.id).join(",");
    const url = `/api/pos/product-media?branch_id=${encodeURIComponent(branchId)}${ids ? `&product_ids=${encodeURIComponent(ids)}` : ""}`;
    setLoading(true);
    void fetch(url, { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as MediaResponse | null;
        if (!response.ok || body?.error || !body?.data) throw new Error(body?.error?.message ?? "โหลดข้อมูลรูปสินค้าไม่สำเร็จ");
        if (!cancelled) {
          setImages(body.data.images ?? {});
          setQuota(body.data.quota ?? null);
          setDeviceCacheEnabled(body.data.device_cache_enabled === true);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "โหลดข้อมูลรูปสินค้าไม่สำเร็จ");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      void navigator.storage.estimate().then((estimate) => {
        if (cancelled) return;
        setDeviceEstimate({ usage: Number(estimate.usage ?? 0), quota: Number(estimate.quota ?? 0) });
      }).catch(() => undefined);
    }

    return () => { cancelled = true; };
  }, [branchId, products]);

  useEffect(() => {
    setPage(1);
    listScrollRef.current?.scrollTo({ top: 0 });
  }, [search]);

  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return products;
    return products.filter((product) => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(needle));
  }, [products, search]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedProducts = filteredProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = filteredProducts.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filteredProducts.length, safePage * PAGE_SIZE);
  const imageCount = Object.keys(images).length;
  const cloudPercent = quota?.cloud_quota_bytes ? Math.min(100, (quota.cloud_used_bytes / quota.cloud_quota_bytes) * 100) : 0;
  const devicePackagePercent = quota?.device_cache_quota_bytes && deviceEstimate
    ? Math.min(100, (deviceEstimate.usage / quota.device_cache_quota_bytes) * 100)
    : 0;

  function movePage(nextPage: number) {
    const resolvedPage = Math.max(1, Math.min(totalPages, nextPage));
    setPage(resolvedPage);
    window.requestAnimationFrame(() => listScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function openFilePicker(product: ProductMediaManagerProduct) {
    if (!canManage || busyProductId) return;
    const input = fileInputRef.current;
    if (!input) {
      setError(th ? "ไม่สามารถเปิดตัวเลือกรูปได้ กรุณารีเฟรชแล้วลองใหม่" : "Image picker is unavailable. Refresh and try again.");
      return;
    }

    pickerProductRef.current = product;
    input.value = "";
    setError("");
    setNotice("");

    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    try {
      if (typeof pickerInput.showPicker === "function") pickerInput.showPicker();
      else input.click();
    } catch {
      try {
        input.click();
      } catch {
        setError(th ? "เครื่องนี้ไม่สามารถเปิดตัวเลือกรูปจากหน้าเว็บได้" : "This device cannot open the image picker from the Web POS.");
      }
    }
  }

  async function upload(product: ProductMediaManagerProduct, file: File | null) {
    if (!file || !canManage || busyProductId) return;
    setBusyProductId(product.id);
    setError("");
    setNotice("");
    try {
      const optimized = await optimizeProductImage(file);
      const form = new FormData();
      form.set("branch_id", branchId);
      form.set("display", optimized.display, "display.webp");
      form.set("thumbnail", optimized.thumbnail, "thumbnail.webp");
      form.set("display_width", String(optimized.displayWidth));
      form.set("display_height", String(optimized.displayHeight));
      form.set("thumbnail_width", String(optimized.thumbnailWidth));
      form.set("thumbnail_height", String(optimized.thumbnailHeight));
      const response = await fetch(`/api/pos/product-media/${encodeURIComponent(product.id)}`, {
        method: "POST",
        credentials: "include",
        body: form
      });
      const body = (await response.json().catch(() => null)) as UploadResponse | null;
      if (!response.ok || body?.error || !body?.data) throw new Error(body?.error?.message ?? "อัปโหลดรูปสินค้าไม่สำเร็จ");
      if (body.data.asset) setImages((current) => ({ ...current, [product.id]: body.data!.asset! }));
      if (body.data.quota) setQuota(body.data.quota);
      setNotice(th ? `บันทึกรูป ${product.name} แล้ว ระบบปรับเป็น WebP สำหรับ POS/QR อัตโนมัติ` : `Saved ${product.name}. Image was optimized for POS/QR.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : (th ? "อัปโหลดรูปสินค้าไม่สำเร็จ" : "Product image upload failed."));
    } finally {
      setBusyProductId(null);
    }
  }

  async function remove(product: ProductMediaManagerProduct) {
    if (!canManage || busyProductId || !images[product.id]) return;
    const confirmed = window.confirm(th ? `ลบรูปของ “${product.name}” ใช่หรือไม่?` : `Delete the image for “${product.name}”?`);
    if (!confirmed) return;
    setBusyProductId(product.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/pos/product-media/${encodeURIComponent(product.id)}?branch_id=${encodeURIComponent(branchId)}`, {
        method: "DELETE",
        credentials: "include"
      });
      const body = (await response.json().catch(() => null)) as UploadResponse | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "ลบรูปสินค้าไม่สำเร็จ");
      setImages((current) => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
      if (body?.data?.quota) setQuota(body.data.quota);
      setNotice(th ? `ลบรูป ${product.name} แล้ว` : `Deleted image for ${product.name}.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : (th ? "ลบรูปสินค้าไม่สำเร็จ" : "Product image delete failed."));
    } finally {
      setBusyProductId(null);
    }
  }

  return (
    <div className="grid gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="fixed -left-[9999px] top-0 h-px w-px opacity-0"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const product = pickerProductRef.current;
          const file = event.currentTarget.files?.[0] ?? null;
          event.currentTarget.value = "";
          if (product && file) void upload(product, file);
        }}
      />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowSummary((current) => !current)}
          className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
          aria-expanded={showSummary}
        >
          {showSummary ? (th ? "ซ่อนสรุป" : "Hide Summary") : (th ? "แสดงสรุป" : "Show Summary")}
        </button>
      </div>

      {showSummary ? (
        <section className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
            <div className="flex items-center justify-between gap-3"><strong className="text-sm text-blue-950">{th ? "พื้นที่ Cloud ตามแพ็กเกจ" : "Package Cloud Storage"}</strong><span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-blue-700">{quota?.package_name ?? quota?.package_code ?? "-"}</span></div>
            <p className="mt-3 text-xl font-extrabold text-slate-950">{formatBytes(quota?.cloud_used_bytes ?? 0)} <span className="text-sm font-semibold text-slate-500">/ {formatBytes(quota?.cloud_quota_bytes ?? 0)}</span></p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${cloudPercent}%` }} /></div>
            <p className="mt-2 text-xs text-slate-600">{th ? `${imageCount} รูป · รูป Cloud แสดงได้ทั้ง Web, POS และ QR โต๊ะ` : `${imageCount} images · Cloud images are shared by Web, POS and Table QR.`}</p>
          </div>

          <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
            <strong className="text-sm text-violet-950">{th ? "พื้นที่แคชเครื่อง POS ตามแพ็กเกจ" : "POS Device Media Cache"}</strong>
            <p className="mt-3 text-xl font-extrabold text-slate-950">{formatBytes(quota?.device_cache_quota_bytes ?? 0)}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${devicePackagePercent}%` }} /></div>
            <p className="mt-2 text-xs text-slate-600">{deviceCacheEnabled ? (th ? "เครื่องนี้มี POS device session: ระบบสามารถเก็บสำเนารูปเพื่อเร่งโหลด/ออฟไลน์ได้" : "Registered POS device: local media caching can be used for faster/offline display.") : (th ? "เว็บทั่วไปใช้ Cloud เป็นหลักและไม่นับพื้นที่เครื่องเพิ่ม" : "Regular Web uses Cloud as the source of truth.")}</p>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
            <strong className="text-sm text-emerald-950">{th ? "พื้นที่เครื่อง/เบราว์เซอร์นี้" : "This Device / Browser"}</strong>
            <p className="mt-3 text-xl font-extrabold text-slate-950">{deviceEstimate ? formatBytes(Math.max(0, deviceEstimate.quota - deviceEstimate.usage)) : "-"}</p>
            <p className="mt-1 text-xs font-semibold text-slate-600">{deviceEstimate ? (th ? `คงเหลือโดยประมาณ · ใช้แล้ว ${formatBytes(deviceEstimate.usage)}` : `Approx. free · ${formatBytes(deviceEstimate.usage)} currently used`) : (th ? "เบราว์เซอร์ไม่รายงานพื้นที่ Storage" : "Storage estimate is unavailable.")}</p>
            <p className="mt-2 text-xs text-slate-500">{th ? "พื้นที่เครื่องเป็น cache เพิ่ม ไม่แทน Cloud; มือถือ QR จะอ่านรูปจาก Cloud เสมอ" : "Device space is additional cache, not a Cloud replacement; QR clients always read Cloud media."}</p>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="text-base font-extrabold text-slate-900">{th ? `รูปสินค้า · ${branchName}` : `Product Images · ${branchName}`}</h3><p className="mt-1 text-xs text-slate-500">{th ? "JPG/PNG/WebP สูงสุด 20 MB · ระบบครอป 1:1 และบีบอัดเป็น WebP อัตโนมัติ" : "JPG/PNG/WebP up to 20 MB · auto-cropped 1:1 and optimized to WebP."}</p></div>
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder={th ? "ค้นหาชื่อ, SKU, หมวดหมู่..." : "Search name, SKU, category..."} className="min-h-10 w-full max-w-sm rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none ring-blue-200 focus:ring-2" />
        </div>

        {error ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
        {notice ? <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{notice}</p> : null}
        {!canManage ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{th ? "สิทธิ์ปัจจุบันดูรูปได้ แต่การเพิ่ม/เปลี่ยน/ลบรูปต้องเป็น Owner หรือ Manager" : "Current role can view images; Owner or Manager is required to change them."}</p> : null}

        {loading ? <div className="py-12 text-center text-sm font-semibold text-slate-500">{th ? "กำลังโหลดรูปสินค้า..." : "Loading product images..."}</div> : (
          <div ref={listScrollRef} className="mt-4 max-h-[46vh] overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
            <div className="grid gap-2">
              {pagedProducts.map((product) => {
                const asset = images[product.id];
                const busy = busyProductId === product.id;
                const disabled = !canManage || Boolean(busyProductId);
                return (
                  <article key={product.id} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-[88px_minmax(0,1fr)_auto] sm:items-center">
                    <div className="h-[88px] w-[88px] overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {asset ? <img src={asset.thumbnail_url} alt={product.name} className="h-full w-full object-cover" loading="lazy" /> : <div className="grid h-full w-full place-items-center text-xs font-bold text-slate-400">{th ? "ไม่มีรูป" : "No image"}</div>}
                    </div>
                    <div className="min-w-0"><strong className="block truncate text-sm text-slate-950">{product.name}</strong><p className="mt-1 truncate text-xs text-slate-500">{product.sku || "-"} · {product.category || (th ? "ไม่ระบุหมวดหมู่" : "Uncategorized")}</p>{asset ? <p className="mt-1 text-[11px] font-semibold text-emerald-700">Cloud Published · {formatBytes(asset.display_bytes + asset.thumbnail_bytes)}</p> : <p className="mt-1 text-[11px] font-semibold text-slate-400">{th ? "ยังไม่เผยแพร่รูป" : "No published image"}</p>}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openFilePicker(product)}
                        disabled={disabled}
                        className="inline-flex min-h-10 items-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {busy ? (th ? "กำลังประมวลผล..." : "Processing...") : asset ? (th ? "เปลี่ยนรูป" : "Replace") : (th ? "เพิ่มรูป" : "Add Image")}
                      </button>
                      {asset ? <button type="button" onClick={() => void remove(product)} disabled={!canManage || Boolean(busyProductId)} className="inline-flex min-h-10 items-center rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">{th ? "ลบรูป" : "Delete"}</button> : null}
                    </div>
                  </article>
                );
              })}
              {filteredProducts.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">{th ? "ไม่พบสินค้า" : "No products found."}</p> : null}
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <span className="text-xs font-semibold text-slate-600">
            {th ? `${rangeStart} - ${rangeEnd} / ${filteredProducts.length} รายการ · มีรูป ${imageCount}` : `${rangeStart} - ${rangeEnd} / ${filteredProducts.length} items · ${imageCount} with images`}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => movePage(safePage - 1)} disabled={safePage <= 1} className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm disabled:opacity-40">{th ? "ก่อนหน้า" : "Previous"}</button>
            <strong className="min-w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-xs text-slate-700">{th ? `หน้า ${safePage} / ${totalPages}` : `Page ${safePage} / ${totalPages}`}</strong>
            <button type="button" onClick={() => movePage(safePage + 1)} disabled={safePage >= totalPages} className="min-h-9 rounded-lg border border-blue-600 bg-blue-600 px-4 text-xs font-bold text-white shadow-sm disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400">{th ? "ถัดไป" : "Next"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}