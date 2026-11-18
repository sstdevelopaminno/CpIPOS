"use client";

import { useState } from "react";
import { FinanceAccountingRegister } from "./finance-accounting-register";
import { FinanceSalesDashboard } from "./finance-sales-dashboard";

export function FinanceBankingWorkspace() {
  const [tab, setTab] = useState<"transfer" | "pos">("transfer");
  return (
    <div className="w-full min-w-0 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#cbd8e9] bg-[#edf3fa] px-5 py-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="การเงินและธนาคาร">
          <button type="button" role="tab" aria-selected={tab === "transfer"}
            onClick={() => setTab("transfer")}
            className={"min-h-10 rounded-md border px-4 text-[13px] font-bold " +
              (tab === "transfer" ? "border-blue-700 bg-blue-700 text-white" :
                "border-[#bcd0e9] bg-white text-[#28517b] hover:bg-blue-50")}>
            โอนเงินระหว่างบัญชี
          </button>
          <button type="button" role="tab" aria-selected={tab === "pos"}
            onClick={() => setTab("pos")}
            className={"min-h-10 rounded-md border px-4 text-[13px] font-bold " +
              (tab === "pos" ? "border-blue-700 bg-blue-700 text-white" :
                "border-[#bcd0e9] bg-white text-[#28517b] hover:bg-blue-50")}>
            ตรวจสอบยอดรับจาก POS
          </button>
        </div>
      </div>
      {tab === "transfer" ? (
        <div role="tabpanel" aria-label="โอนเงินระหว่างบัญชี">
          <div className="border-b border-[#dbe6f2] bg-[#f8fbff] px-5 py-3 text-xs leading-6 text-slate-600">
            การโอนเงินต้องผ่านการอนุมัติและระบุบัญชีสินทรัพย์ต้นทาง–ปลายทางก่อนลงบัญชี
            การบันทึกนี้ยังไม่ถือเป็นการกระทบยอด Bank Statement
          </div>
          <FinanceAccountingRegister module="banking" />
        </div>
      ) : (
        <div role="tabpanel" aria-label="ตรวจสอบยอดรับจาก POS">
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs leading-5 text-amber-900">
            รายงานนี้เปรียบเทียบยอดตามบิลกับ Payment ที่ POS บันทึก ไม่ใช่การเทียบ Bank Statement จริง
          </div>
          <FinanceSalesDashboard actor="accountant" initialTab="reconcile" showTabs={false} />
        </div>
      )}
    </div>
  );
}
