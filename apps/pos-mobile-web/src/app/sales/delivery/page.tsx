import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { requireOpenShift } from "@/lib/permissions/guard";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function deliveryStatus(status: string | null | undefined) {
  if (status === "pending") return "รอจัดส่ง";
  if (status === "assigned") return "รับงานแล้ว";
  if (status === "delivered") return "ส่งสำเร็จ";
  if (status === "cancelled") return "ยกเลิก";
  return status ?? "รอจัดส่ง";
}

export default async function DeliverySalesPage() {
  const { scope, shift } = await requireOpenShift("delivery:create");
  const supabase = createServiceClient();
  const { data: orders } = await supabase
    .from("orders")
    .select("id,order_no,status,delivery_status,customer_name,external_order_code,grand_total,total_amount,created_at")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("shift_id", shift.id)
    .eq("order_type", "delivery")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <MobileAppShell title="เดลิเวอรี่" subtitle="ออเดอร์ส่งในกะนี้" scope={scope}>
      <section className="grid gap-3">
        {(orders ?? []).length ? (
          (orders ?? []).map((order) => (
            <article key={order.id} className="card rounded-[18px] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 text-[13px] font-bold text-[#7a8fa8]">{order.external_order_code ?? "delivery"}</p>
                  <h2 className="m-0 mt-1 truncate text-[18px] font-black text-[#0f2745]">{order.order_no}</h2>
                  <p className="m-0 mt-1 text-[13px] font-semibold text-[#587398]">{order.customer_name ?? "ไม่ระบุลูกค้า"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <b className="block text-[18px] text-[#1677d9]">{money(order.grand_total ?? order.total_amount)} ฿</b>
                  <span className="mt-2 inline-flex rounded-full bg-[#fff6e8] px-3 py-1 text-[12px] font-black text-[#9a5b00]">{deliveryStatus(order.delivery_status)}</span>
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="card rounded-[18px] p-5 text-[15px] font-bold text-[#587398]">ยังไม่มีออเดอร์เดลิเวอรี่ในกะนี้</div>
        )}
      </section>
    </MobileAppShell>
  );
}
