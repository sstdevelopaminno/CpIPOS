import { fail, ok } from "@/lib/api/response";
import { readMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const scope = await readMobileSession();
  if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const [orders, shift, lowStock, attendance] = await Promise.all([
    supabase.from("orders").select("id,order_no,total_amount,grand_total,status,created_at").eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId).gte("created_at", `${today}T00:00:00.000Z`).order("created_at", { ascending: false }).limit(5),
    supabase.from("shifts").select("id,status,opened_at,expected_cash,device_code").eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId).eq("device_code", scope.deviceCode).eq("status", "open").maybeSingle(),
    supabase.from("ingredients").select("id,name,quantity_on_hand,base_unit").eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId).lt("quantity_on_hand", 10).limit(5),
    supabase.from("staff_attendance_records").select("id,status,check_in_at,check_out_at").eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId).eq("user_id", scope.userId).gte("work_date", today).maybeSingle()
  ]);
  return ok({ scope, todaySales: orders.data?.reduce((sum, order) => sum + Number(order.grand_total ?? order.total_amount ?? 0), 0) ?? 0, recentOrders: orders.data ?? [], shift: shift.data, lowStock: lowStock.data ?? [], attendance: attendance.data });
}
