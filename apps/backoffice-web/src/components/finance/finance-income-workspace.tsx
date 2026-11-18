"use client";

import { useState } from "react";
import { FinanceSalesDashboard } from "./finance-sales-dashboard";
import { FinanceOtherIncomeRegister } from "./finance-other-income-register";

export function FinanceIncomeWorkspace() {
  const [tab, setTab] = useState<"pos" | "other">("pos");
  return (
    <div className="w-full min-w-0 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#cbd8e9] bg-[#edf3fa] px-5 py-3">
        <div role="tablist" aria-label="ประเภททะเบียนรายรับ" className="flex flex-wrap gap-2">
          <button type="button" role="tab" aria-selected={tab === "pos"}
            onClick={() => setTab("pos")}
            className={"min-h-10 rounded-md border px-4 text-[13px] font-bold transition-colors " +
              (tab === "pos" ? "border-blue-700 bg-blue-700 text-white" :
                "border-[#bcd0e9] bg-white text-[#28517b] hover:bg-blue-50")}>
            รายรับจาก POS
          </button>
          <button type="button" role="tab" aria-selected={tab === "other"}
            onClick={() => setTab("other")}
            className={"min-h-10 rounded-md border px-4 text-[13px] font-bold transition-colors " +
              (tab === "other" ? "border-blue-700 bg-blue-700 text-white" :
                "border-[#bcd0e9] bg-white text-[#28517b] hover:bg-blue-50")}>
            รายรับอื่น ๆ
          </button>
        </div>
        <span className="text-xs text-slate-500">แยกทะเบียนชัดเจน · ไม่ลงยอดขาย POS ซ้ำ</span>
      </div>
      {tab === "pos" ? (
        <div role="tabpanel" aria-label="ทะเบียนรายรับจาก POS">
          <FinanceSalesDashboard actor="accountant" initialTab="sales" showTabs={false} />
        </div>
      ) : (
        <div role="tabpanel" aria-label="ทะเบียนรายรับอื่น ๆ">
          <FinanceOtherIncomeRegister />
        </div>
      )}
    </div>
  );
}
