"use client";

import { useEffect } from "react";
import { PosGeneralSaleFrontCashPanel } from "@/components/pos/pos-general-sale-front-cash-panel";
import { GENERAL_SALE_MODE_ID, GENERAL_SALE_ROOT_ATTRIBUTE } from "@/lib/pos-general-sale-mode";

const REVIEW_CART_KEY = "pos_sales_cart_v012";
const REVIEW_CASH_DRAFT_KEY = "cpipos_general_sale_cash_draft_v1";

export default function SdUiReviewPage() {
  useEffect(() => {
    const previousMode = document.documentElement.getAttribute(GENERAL_SALE_ROOT_ATTRIBUTE);
    const previousCart = window.localStorage.getItem(REVIEW_CART_KEY);
    const previousDraft = window.sessionStorage.getItem(REVIEW_CASH_DRAFT_KEY);

    document.documentElement.setAttribute(GENERAL_SALE_ROOT_ATTRIBUTE, GENERAL_SALE_MODE_ID);
    window.localStorage.setItem(
      REVIEW_CART_KEY,
      JSON.stringify([
        {
          product_id: "review-product-001",
          name: "ขนมปัง",
          quantity: 2,
          price: 29,
          notes: null
        }
      ])
    );
    window.sessionStorage.removeItem(REVIEW_CASH_DRAFT_KEY);

    return () => {
      if (previousMode) document.documentElement.setAttribute(GENERAL_SALE_ROOT_ATTRIBUTE, previousMode);
      else document.documentElement.removeAttribute(GENERAL_SALE_ROOT_ATTRIBUTE);

      if (previousCart == null) window.localStorage.removeItem(REVIEW_CART_KEY);
      else window.localStorage.setItem(REVIEW_CART_KEY, previousCart);

      if (previousDraft == null) window.sessionStorage.removeItem(REVIEW_CASH_DRAFT_KEY);
      else window.sessionStorage.setItem(REVIEW_CASH_DRAFT_KEY, previousDraft);
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-950">
      <PosGeneralSaleFrontCashPanel />

      <section className="mx-auto grid min-h-[820px] w-full max-w-[1580px] grid-cols-[minmax(0,1fr)_380px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="min-w-0 bg-slate-50 p-5">
          <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="grid grid-cols-[160px_1fr_1fr] gap-6 text-sm">
              <div>
                <strong className="block text-slate-500">โหมด</strong>
                <span className="font-bold">ขายทั่วไป</span>
              </div>
              <div>
                <strong className="block text-slate-500">ชื่อผู้ขาย</strong>
                <span className="font-bold">ทดลอง 7 วัน</span>
              </div>
              <div>
                <strong className="block text-slate-500">รหัสเครื่องแคช</strong>
                <span className="font-bold">POS-COUNTER-01</span>
              </div>
            </div>
          </div>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h1 className="text-base font-black">SD • ขายทั่วไป • สแกน SKU</h1>
                <p className="mt-1 text-xs font-semibold text-slate-600">หน้า Review นี้ใช้ component Front Cash ตัวเดียวกับ PR #150 และไม่มีการเรียก API ชำระเงินจริง</p>
              </div>
              <div className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-black text-emerald-700">สินค้า + ตาราง</div>
            </div>

            <div className="flex gap-3">
              <input
                readOnly
                value="1787888008329187873"
                aria-label="ตัวอย่าง SKU"
                className="h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold outline-none"
              />
              <button type="button" className="rounded-xl bg-orange-500 px-5 text-sm font-black text-white">เพิ่มสินค้า</button>
            </div>
          </section>

          <section className="cpipos-sd-table mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 bg-emerald-50 px-4 py-3">
              <strong className="text-sm">ตารางขายสินค้า · 2 ชิ้น · 1 รายการ</strong>
              <strong className="text-xl text-orange-500">฿58.00</strong>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="cpipos-sd-table__sku px-4 py-3">SKU / บาร์โค้ด</th>
                  <th className="cpipos-sd-table__category px-4 py-3">หมวดหมู่</th>
                  <th className="cpipos-sd-table__name px-4 py-3">สินค้า</th>
                  <th className="px-4 py-3">จำนวน</th>
                  <th className="px-4 py-3 text-right">ราคา/หน่วย</th>
                  <th className="px-4 py-3 text-right">ราคารวม</th>
                  <th className="px-4 py-3 text-center">ลบ</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-200">
                  <td className="px-4 py-4">1</td>
                  <td className="cpipos-sd-table__sku px-4 py-4 font-black" title="1787888008329187873">1787888008329187873</td>
                  <td className="cpipos-sd-table__category px-4 py-4">ขนมปัง</td>
                  <td className="cpipos-sd-table__name px-4 py-4 font-bold">ขนมปัง</td>
                  <td className="px-4 py-4">
                    <div className="inline-grid grid-cols-3 overflow-hidden rounded-lg border border-slate-300 bg-white">
                      <button type="button" className="h-9 w-10 border-r border-slate-200 font-black">−</button>
                      <span className="grid h-9 w-10 place-items-center font-black">2</span>
                      <button type="button" className="h-9 w-10 border-l border-slate-200 font-black">+</button>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right">฿29.00</td>
                  <td className="px-4 py-4 text-right font-bold">฿58.00</td>
                  <td className="px-4 py-4 text-center"><button type="button" className="rounded-lg border border-red-200 px-3 py-2 text-red-500">×</button></td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        <aside className="posui-cart-col min-h-0 border-l border-slate-200 bg-slate-50 p-3">
          <section className="posui-cart-panel flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white">
            <header className="posui-cart-panel__header flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="font-black">รายการสินค้า (1)</h3>
              <button type="button" className="text-xs font-black text-red-500">ล้างรายการ</button>
            </header>

            <div className="posui-cart-panel__body flex min-h-0 flex-1 flex-col">
              <div className="posui-cart-items flex-1 p-4">
                <article className="posui-cart-item rounded-xl border border-slate-200 p-3">
                  <strong>ขนมปัง</strong>
                  <p className="text-xs text-slate-500">2 × ฿29.00</p>
                </article>
              </div>

              <section className="posui-payment-panel mt-auto p-2">
                <div className="posui-bill-summary-card rounded-xl border border-slate-200 bg-white p-3">
                  <p className="flex items-center justify-between py-1 text-sm"><span>เลขที่บิล</span><strong>TKO-260828-001</strong></p>
                  <p className="flex items-center justify-between py-1 text-sm"><span>การชำระเงิน</span><strong>ยังไม่ชำระ</strong></p>
                  <p className="flex items-center justify-between py-1 text-sm"><span>โหมด</span><strong>กลับบ้าน</strong></p>
                  <p className="flex items-center justify-between py-1 text-sm"><span>สถานะ</span><strong>กลับบ้าน</strong></p>
                  <p className="is-total mt-2 flex items-center justify-between border-t border-dashed border-slate-300 pt-3"><span className="font-black">ยอดรวม</span><strong className="text-2xl text-orange-500">฿58.00</strong></p>
                </div>

                <div className="posui-bill-actions mt-2 grid grid-cols-4 gap-2">
                  <button type="button" className="posui-btn rounded-xl border border-slate-300 bg-white px-2 py-3 text-xs font-black">พักบิล</button>
                  <button type="button" className="posui-btn posui-btn--member rounded-xl border border-slate-300 bg-white px-2 py-3 text-xs font-black">สมาชิก</button>
                  <button type="button" className="posui-btn posui-btn--promo rounded-xl border border-orange-300 bg-white px-2 py-3 text-xs font-black text-orange-500">ส่วนลด</button>
                  <button type="button" className="posui-btn posui-btn--cancel-near-checkout rounded-xl border border-slate-300 bg-white px-2 py-3 text-xs font-black">ยกเลิกบิล</button>
                </div>

                <div className="posui-payment-actions posui-payment-actions--single mt-2 grid gap-2">
                  <button type="button" className="posui-btn posui-btn--primary posui-btn--checkout rounded-xl bg-orange-500 px-4 py-3 text-sm font-black text-white">สร้างออเดอร์ POS</button>
                </div>
              </section>
            </div>
          </section>
        </aside>
      </section>

      <p className="mx-auto mt-3 max-w-[1580px] text-xs font-semibold text-slate-500">
        Visual review only — ปุ่มในหน้านี้ไม่สร้างออเดอร์ ไม่บันทึก DB และไม่เรียก payment API
      </p>
    </main>
  );
}
