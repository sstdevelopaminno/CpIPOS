import { LogoutButton } from "@/components/auth/logout-button";
import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { DevelopmentFeatureButton } from "@/components/sales/development-feature-notice";
import { HeldOrdersLauncher } from "@/components/sales/held-orders-launcher";
import { SalesModeActions, type SalesModeActivity } from "@/components/sales/sales-mode-actions";
import { SalesNotificationBell, type SalesNotification } from "@/components/sales/sales-notification-bell";
import { requireOpenShift } from "@/lib/permissions/guard";
import { createServiceClient } from "@/lib/supabase/server";
import { ChartNoAxesColumnIncreasing, CircleCheck, ClipboardList, PackageOpen, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ActiveModeOrderRow = {
  id: string;
  order_type: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
};

function money(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatCard({ icon: Icon, label, value, tone, href }: { icon: LucideIcon; label: string; value: string; tone: string; href?: string }) {
  const content = (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[12px] font-black leading-tight text-[#6a7f99]">{label}</span>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] ${tone}`}>
          <Icon size={20} strokeWidth={2.3} />
        </span>
      </div>
      <p className="m-0 text-[20px] font-black leading-tight text-[#031f3d]">{value}</p>
    </>
  );
  const className = "min-h-[104px] rounded-[18px] border border-[#d4e5f8] bg-white p-3.5 shadow-[0_8px_20px_rgba(15,39,69,0.06)] outline-none transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2";

  if (href) {
    return (
      <Link href={href} className={`${className} block no-underline`} aria-label={`${label} ${value}`}>
        {content}
      </Link>
    );
  }

  return (
    <div className={className}>
      {content}
    </div>
  );
}

export default async function SalesPage() {
  const { scope, shift } = await requireOpenShift("sales:view");
  const supabase = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: orders }, { count: productCount }, { count: heldOrderCount }, { data: activeModeOrders }, { count: activeTableSessionCount }] = await Promise.all([
    supabase
      .from("orders")
      .select("id,status,grand_total,total_amount")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("shift_id", shift.id)
      .gte("created_at", `${today}T00:00:00.000Z`)
      .limit(100),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("is_active", true),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("order_type", "takeaway")
      .eq("status", "draft")
      .contains("metadata", { hold_state: "held" }),
    supabase
      .from("orders")
      .select("id,order_type,status,metadata")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .not("status", "in", "(completed,cancelled)")
      .in("order_type", ["takeaway", "dine_in", "delivery_manual"])
      .limit(200),
    supabase
      .from("table_bill_sessions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .in("status", ["open", "ordering", "pending_payment"]),
  ]);

  const paidOrders = (orders ?? []).filter((order) => order.status === "paid" || order.status === "completed");
  const activeOrders = (orders ?? []).filter((order) => order.status !== "cancelled");
  const todayTotal = paidOrders.reduce((sum, order) => sum + Number(order.grand_total ?? order.total_amount ?? 0), 0);
  const activeModeRows = (activeModeOrders ?? []) as ActiveModeOrderRow[];
  const modeActivity: SalesModeActivity = {
    takeaway: activeModeRows.some((order) => order.order_type === "takeaway"),
    dineIn: Number(activeTableSessionCount ?? 0) > 0 || activeModeRows.some((order) => order.order_type === "dine_in"),
    delivery: activeModeRows.some((order) => order.order_type === "delivery_manual"),
  };
  const salesNotifications: SalesNotification[] = [
    {
      id: `shift-open-${shift.id}`,
      title: "กะพร้อมขาย",
      message: "เครื่องแคชเชียร์นี้เปิดกะแล้ว สามารถรับออเดอร์ได้",
      tone: "success",
    },
  ];
  if (activeOrders.length > 0) {
    salesNotifications.push({
      id: `active-orders-${shift.id}-${activeOrders.length}`,
      title: "มีออเดอร์ในกะ",
      message: `มีออเดอร์ในกะนี้ ${activeOrders.length} รายการ`,
      tone: "info",
    });
  }
  if (Number(productCount ?? 0) <= 0) {
    salesNotifications.push({
      id: `no-products-${scope.branchId}`,
      title: "ยังไม่มีสินค้าพร้อมขาย",
      message: "ตรวจสอบรายการสินค้าในเมนูสินค้า ก่อนเริ่มขายจริง",
      tone: "warning",
    });
  }

  return (
    <MobileAppShell
      brand={
        <div className="mb-1 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] bg-white shadow-[0_8px_18px_rgba(15,39,69,0.06)]">
            <Image src="/brand/cpipos-icon-transparent-180.png" alt="CpIPOS" width={36} height={36} className="h-8 w-8 object-contain" priority />
          </span>
          <span className="text-[20px] font-black leading-none text-[#031f3d]">
            CpI<span className="text-[#1677d9]">POS</span>
          </span>
        </div>
      }
      scope={scope}
      action={
        <>
          <SalesNotificationBell notifications={salesNotifications} />
          <LogoutButton />
        </>
      }
    >
      <section className="grid gap-5">
        <div className="relative overflow-hidden rounded-[22px] border border-[#cfe3fa] bg-[#eaf6ff] p-4 shadow-[0_10px_26px_rgba(15,39,69,0.08)]">
          <Image src="/brand/cpipos-icon-transparent-512.png" alt="" width={180} height={180} className="pointer-events-none absolute -right-9 -top-9 h-28 w-28 object-contain opacity-[0.08]" aria-hidden="true" />
          <div className="relative flex items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-white text-[#1677d9] shadow-sm">
              <Image src="/brand/pos-terminal.svg" alt="" width={52} height={52} className="h-12 w-12 object-contain" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-[20px] font-black leading-tight text-[#0f2745]">พร้อมขาย</h2>
                <span className="rounded-full bg-[#dffbea] px-3 py-1 text-[12px] font-black text-[#0f8d46]">ออนไลน์</span>
              </div>
              <p className="mt-2 text-[14px] font-semibold leading-snug text-[#587398]">ระบบเชื่อมกับกะและเครื่องแคชเชียร์นี้แล้ว</p>
            </div>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#1fbd73] shadow-sm">
              <CircleCheck size={24} strokeWidth={2.4} />
            </span>
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-[16px] font-black leading-tight text-[#0f2745]">ทางลัด</h2>
          <SalesModeActions activity={modeActivity} />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-3">
          <HeldOrdersLauncher heldCount={heldOrderCount ?? 0} />
          <DevelopmentFeatureButton
            iconName="user"
            label="สมาชิก"
            title="สมาชิกอยู่ระหว่างพัฒนา"
            message="ระบบสมาชิกฝั่ง CpIPOS ยังอยู่ในช่วงจัดรูปแบบและตรวจ schema Mobile จึงแสดงเป็นโหมดพัฒนาไว้ก่อน"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={ChartNoAxesColumnIncreasing} label="ยอดขายวันนี้" value={`${money(todayTotal)} ฿`} tone="bg-[#f0f6ff] text-[#1677d9]" />
          <StatCard icon={ClipboardList} label="ออเดอร์ในกะ" value={String(activeOrders.length)} tone="bg-[#f0f6ff] text-[#1677d9]" href="/orders" />
          <StatCard icon={PackageOpen} label="สินค้าพร้อมขาย" value={String(productCount ?? 0)} tone="bg-[#f0f6ff] text-[#1677d9]" href="/sales/stock-readiness" />
        </div>
      </section>
    </MobileAppShell>
  );
}
