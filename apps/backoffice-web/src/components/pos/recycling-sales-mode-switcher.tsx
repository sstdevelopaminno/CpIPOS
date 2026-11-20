"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

const RECYCLING_URL = "/preview/pos";
const GENERAL_URL = "/preview/pos/general";

function RecyclingModeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" width="23" height="23"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 4 2-2 3 5-2 3-3-1-2 3M17 6l3 1 1 5-5-1-2-4 3-1ZM8 20l-3-3 3-5 4 1 1 4-2 3H8Z"/>
    <path d="M5 17h6m6-6 3 3M9 4l-1 5"/>
  </svg>;
}

/**
 * Reuses the existing CpiPOS sales header and mode-selector classes.
 * The recycling workspace remains separate financially, not as a second
 * overlapping menu or a negative ordinary POS sale.
 */
export function RecyclingSalesModeSwitcher({
  storeName, branchName, deviceCode, generalSaleEnabled
}: {
  storeName: string;
  branchName: string;
  deviceCode: string | null;
  generalSaleEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  return <>
    <section className={`posui-sales-topbar rounded-xl border border-slate-200 bg-white shadow-sm ${collapsed ? "is-collapsed" : ""}`}
      data-pos-react-sales-mode="recycling" data-testid="recycling-original-sales-toolbar">
      <div className="posui-mode-header-row">
        {/* The original 3-column grid requires its first 34px toggle column.
            Without it the mode button is squeezed into 34px and metadata
            into the 184px column, producing the broken Windows layout. */}
        <button type="button" className="posui-topbar-collapse-toggle"
          onClick={() => setCollapsed(current => !current)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "ขยายแถบข้อมูลด้านบน" : "หุบแถบข้อมูลด้านบน"}
          title={collapsed ? "ขยายแถบบน" : "หุบแถบบน"}>
          <span className="posui-topbar-collapse-toggle__chevron" aria-hidden="true" />
        </button>
        <div className="posui-filter-group">
          <div className="posui-top-actions-card">
            <button type="button" className="posui-mode-switch-button"
              onClick={() => setOpen(true)} aria-haspopup="dialog"
              aria-label="สลับโหมดขาย: ร้านค้าของเก่า Recycling">
              <span className="posui-mode-switch-button__icon" aria-hidden="true"><RecyclingModeIcon/></span>
              <span className="posui-mode-switch-button__action">สลับโหมดขาย</span>
            </button>
            <div className="posui-mode-stack-meta">
              <span className="rounded-lg bg-blue-50 px-3 py-1 text-xs font-extrabold text-blue-900">
                ร้านค้าของเก่า · Recycling
              </span>
            </div>
          </div>
        </div>
        <div className="posui-filter-group posui-sales-meta-group">
          <section className="posui-sales-meta-card" aria-label="ข้อมูลหน้าขาย">
            <div className="posui-sales-meta-columns">
              <dl className="posui-sales-meta-list posui-sales-meta-list--left">
                <div className="posui-sales-meta-row"><dt>ร้าน</dt><dd>{storeName}</dd></div>
                <div className="posui-sales-meta-row"><dt>สาขา</dt><dd>{branchName}</dd></div>
              </dl>
              <dl className="posui-sales-meta-list posui-sales-meta-list--right">
                <div className="posui-sales-meta-row"><dt>เครื่องแคชเชียร์</dt><dd>{deviceCode || "—"}</dd></div>
                <div className="posui-sales-meta-row"><dt>โหมด</dt><dd>รับซื้อ / ขายออก</dd></div>
              </dl>
            </div>
          </section>
        </div>
      </div>
    </section>
    {open && <div role="dialog" aria-modal="true" aria-labelledby="recycling-mode-picker-title"
      className="posui-mode-selector-backdrop" onClick={() => setOpen(false)}>
      <section className="posui-mode-selector" onClick={(event) => event.stopPropagation()}>
        <header className="posui-mode-selector__header">
          <div><p>POS SALES MODES</p><h2 id="recycling-mode-picker-title">เลือกโหมดขาย</h2>
            <span>แสดงเฉพาะโหมดที่ฝ่าย IT เปิดสิทธิ์สำหรับร้านนี้</span></div>
          <button type="button" className="posui-mode-selector__close" onClick={() => setOpen(false)}
            aria-label="ปิด">×</button>
        </header>
        <div className="posui-mode-selector__grid">
          <button type="button" data-pos-sale-mode="recycling"
            className="posui-mode-option is-active" aria-current="page"
            onClick={() => setOpen(false)}>
            <span className="posui-mode-option__icon"><RecyclingModeIcon/></span>
            <span className="posui-mode-option__copy"><strong>ร้านค้าของเก่า · Recycling</strong>
              <small>สแกนบาร์โค้ด · รับซื้อ / ขายออก · ชั่งน้ำหนักภายนอก</small></span>
            <span className="posui-mode-option__check" aria-hidden="true">✓</span>
          </button>
          {generalSaleEnabled && <Link href={GENERAL_URL} data-pos-sale-mode="general_sale"
            className="posui-mode-option" onClick={(event) => {
              if (!window.confirm("เปลี่ยนไปโหมดขายทั่วไป? กรุณาตรวจสอบรายการที่ยังไม่บันทึกก่อนเปลี่ยนโหมด")) event.preventDefault();
            }}>
            <span className="posui-mode-option__icon" aria-hidden="true">▦</span>
            <span className="posui-mode-option__copy"><strong>ขายทั่วไป (SD)</strong>
              <small>หน้าขายร้านของชำและสินค้า SKU แบบเดิม</small></span>
            <span className="posui-mode-option__check" aria-hidden="true">✓</span>
          </Link>}
        </div>
      </section>
    </div>}
  </>;
}

/**
 * Mount a true mode card into the existing POS selector, instead of adding a
 * duplicate bar over the old General Sale UI. The original React sales module
 * still owns its own cashier, cart and mode state.
 */
export function RecyclingLegacyModeOption() {
  const [grid, setGrid] = useState<Element | null>(null);

  useEffect(() => {
    const sync = () => {
      const next = document.querySelector(".posui-mode-selector__grid");
      setGrid(current => current === next ? current : next);
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }, []);

  if (!grid) return null;
  return createPortal(<Link href={RECYCLING_URL} data-pos-sale-mode="recycling"
    className="posui-mode-option" data-testid="native-recycling-mode-entry"
    onClick={(event) => {
      if (!window.confirm("สลับไปโหมดร้านค้าของเก่า Recycling? ตรวจสอบบิลที่ยังไม่บันทึกก่อนเปลี่ยนโหมด"))
        event.preventDefault();
    }}>
    <span className="posui-mode-option__icon" aria-hidden="true"><RecyclingModeIcon/></span>
    <span className="posui-mode-option__copy"><strong>ร้านค้าของเก่า · Recycling</strong>
      <small>สแกนบาร์โค้ด · ตารางรับซื้อ / ขายออก · น้ำหนัก</small></span>
    <span className="posui-mode-option__check" aria-hidden="true">✓</span>
  </Link>, grid);
}
