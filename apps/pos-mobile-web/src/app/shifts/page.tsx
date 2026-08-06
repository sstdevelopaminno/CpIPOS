import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { ShiftActions } from "@/components/shifts/shift-actions";
import { requireMobileSession } from "@/lib/permissions/guard";
import { createServiceClient } from "@/lib/supabase/server";
import { Banknote, Clock, Landmark, Monitor, Store } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function ShiftsPage() {
  const scope = await requireMobileSession(["owner", "manager", "staff"]);
  const supabase = createServiceClient();
  const [{ data: branch }, { data: shift }] = await Promise.all([
    supabase.from("branches").select("name,code").eq("id", scope.branchId).maybeSingle(),
    supabase
      .from("shifts")
      .select("id,status,opened_at,closed_at,device_code,opening_cash,expected_cash")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("device_code", scope.deviceCode)
      .eq("status", "open")
      .maybeSingle<{ id: string; status: string; opened_at: string | null; closed_at: string | null; device_code: string | null; opening_cash: number | null; expected_cash: number | null }>(),
  ]);

  let cashTotal = 0;
  let transferTotal = 0;
  let orderCount = 0;
  if (shift?.id) {
    const [{ data: orders }, { data: payments }] = await Promise.all([
      supabase
        .from("orders")
        .select("id,status")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .eq("shift_id", shift.id),
      supabase
        .from("payments")
        .select("method,amount")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .eq("shift_id", shift.id)
        .eq("status", "paid"),
    ]);
    orderCount = (orders ?? []).filter((order) => order.status !== "cancelled").length;
    for (const payment of payments ?? []) {
      if (payment.method === "cash") cashTotal += Number(payment.amount ?? 0);
      if (payment.method === "bank_transfer") transferTotal += Number(payment.amount ?? 0);
    }
  }
  const expectedCash = Number(shift?.opening_cash ?? 0) + cashTotal;

  return (
    <MobileAppShell title="ปิดยอด" scope={scope} showBottomNav={Boolean(shift)}>
      <section className="space-y-4">
        <div className="card rounded-[20px] p-4">
          <div className="mb-4 flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-[#eef6ff] text-[#1677d9]">
              <Clock className="h-7 w-7" />
            </span>
            <div>
              <h2 className="m-0 text-[22px] font-black leading-tight text-[#0f2745]">{shift ? "กะเปิดอยู่" : "ยังไม่เปิดกะ"}</h2>
              <p className="mt-2 text-[14px] font-semibold leading-relaxed text-[#587398]">เปิดกะของเครื่องนี้ก่อนเริ่มขาย และปิดยอดเมื่อจบงาน</p>
            </div>
          </div>
          <div className="grid gap-3 text-[14px] font-semibold text-[#0f2745]">
            <p className="m-0 flex items-center gap-2">
              <Store className="h-5 w-5 text-[#1677d9]" />
              <span>สาขา: <b>{String(branch?.name ?? branch?.code ?? "-")}</b></span>
            </p>
            <p className="m-0 flex items-center gap-2">
              <Monitor className="h-5 w-5 text-[#1677d9]" />
              <span>เครื่องแคชเชียร์: <b>{scope.deviceName ?? scope.deviceCode}</b></span>
            </p>
            <p className="m-0 flex items-center gap-2">
              <Clock className="h-5 w-5 text-[#1677d9]" />
              <span>เวลาเปิด: <b>{shift?.opened_at ? new Date(shift.opened_at).toLocaleString("th-TH") : "-"}</b></span>
            </p>
          </div>
        </div>

        {shift ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="card rounded-[18px] p-4">
              <p className="m-0 flex items-center gap-2 text-[13px] font-black text-[#587398]"><Banknote className="h-5 w-5 text-[#1677d9]" /> เงินสดในกะ</p>
              <b className="mt-2 block text-[22px] text-[#0f2745]">{money(cashTotal)} ฿</b>
            </div>
            <div className="card rounded-[18px] p-4">
              <p className="m-0 flex items-center gap-2 text-[13px] font-black text-[#587398]"><Landmark className="h-5 w-5 text-[#1677d9]" /> เงินโอน</p>
              <b className="mt-2 block text-[22px] text-[#0f2745]">{money(transferTotal)} ฿</b>
            </div>
            <div className="card rounded-[18px] p-4">
              <p className="m-0 text-[13px] font-black text-[#587398]">เงินสดคาดหวัง</p>
              <b className="mt-2 block text-[22px] text-[#0f2745]">{money(expectedCash)} ฿</b>
            </div>
            <div className="card rounded-[18px] p-4">
              <p className="m-0 text-[13px] font-black text-[#587398]">บิลในกะ</p>
              <b className="mt-2 block text-[22px] text-[#0f2745]">{orderCount}</b>
            </div>
          </div>
        ) : null}

        <ShiftActions hasOpenShift={Boolean(shift)} expectedCash={expectedCash} />
      </section>
    </MobileAppShell>
  );
}
