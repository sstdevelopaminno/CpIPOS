import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { OrdersListClient, type MobileOrderListItem } from "@/components/orders/orders-list-client";
import { requireOpenShift } from "@/lib/permissions/guard";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type OrderRow = {
  id: string;
  order_no: string | null;
  order_type: string | null;
  status: string | null;
  grand_total: number | null;
  total_amount: number | null;
  created_at: string | null;
};

export default async function OrdersPage() {
  const { scope, shift } = await requireOpenShift("sales:list:view");
  const supabase = createServiceClient();
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id,order_no,order_type,status,grand_total,total_amount,created_at")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("shift_id", shift.id)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) throw new Error(error.message);

  const orderItems: MobileOrderListItem[] = ((orders ?? []) as OrderRow[]).map((order) => ({
    id: order.id,
    orderNo: order.order_no ?? "-",
    orderType: order.order_type,
    status: order.status,
    total: Number(order.grand_total ?? order.total_amount ?? 0),
    createdAt: order.created_at,
  }));

  return (
    <MobileAppShell title="รายการขาย" scope={scope}>
      <OrdersListClient orders={orderItems} />
    </MobileAppShell>
  );
}
