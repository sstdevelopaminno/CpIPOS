import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { TableGridPager, type TableGridItem } from "@/components/sales/table-grid-pager";
import { TableZoneSelector, type TableZoneOption } from "@/components/sales/table-zone-selector";
import { requireOpenShift } from "@/lib/permissions/guard";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DiningTableRow = {
  id: string;
  zone_id: string | null;
  table_code: string | null;
  table_name: string | null;
  capacity: number | null;
  status: string | null;
  is_active: boolean | null;
};

type ZoneRow = {
  id: string;
  zone_name: string | null;
  color: string | null;
  display_order: number | null;
  is_active: boolean | null;
};

type SessionRow = {
  id: string;
  table_id: string;
  order_id: string | null;
  status: string | null;
  opened_at: string | null;
};

type PageProps = {
  searchParams?: Promise<{ zone?: string }>;
};

export default async function TableSalesPage({ searchParams }: PageProps) {
  const selectedZoneId = (await searchParams)?.zone ?? "all";
  const { scope } = await requireOpenShift("tables:view");
  const supabase = createServiceClient();
  const [{ data: zoneRows }, { data: tableRows, error: tableError }, { data: sessionRows }] = await Promise.all([
    supabase
      .from("table_zones")
      .select("id,zone_name,color,display_order,is_active")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("dining_tables")
      .select("id,zone_id,table_code,table_name,capacity,status,is_active")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("is_active", true)
      .order("table_code", { ascending: true })
      .limit(120),
    supabase
      .from("table_bill_sessions")
      .select("id,table_id,order_id,status,opened_at")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .in("status", ["open", "ordering", "pending_payment"])
      .order("opened_at", { ascending: false })
      .limit(120),
  ]);

  if (tableError) throw new Error(tableError.message);

  const zones = (zoneRows ?? []) as ZoneRow[];
  const validSelectedZoneId = zones.some((zone) => zone.id === selectedZoneId) ? selectedZoneId : "all";
  const activeSessionByTable = new Map(((sessionRows ?? []) as SessionRow[]).map((session) => [session.table_id, session]));
  const allTables = ((tableRows ?? []) as DiningTableRow[]).map((table) => {
    const session = activeSessionByTable.get(table.id);
    return {
      ...table,
      effectiveStatus: session?.status ?? table.status ?? "available",
      session,
    };
  });
  const tables = validSelectedZoneId === "all" ? allTables : allTables.filter((table) => table.zone_id === validSelectedZoneId);
  const zoneOptions: TableZoneOption[] = zones.map((zone) => ({
    id: zone.id,
    name: zone.zone_name || "โซน",
    color: zone.color,
    count: allTables.filter((table) => table.zone_id === zone.id).length,
  }));
  const tableItems: TableGridItem[] = tables.map((table) => ({
    id: table.id,
    tableCode: table.table_code,
    tableName: table.table_name,
    capacity: table.capacity,
    effectiveStatus: table.effectiveStatus,
    openedAt: table.session?.opened_at ?? null,
  }));

  return (
    <MobileAppShell title="เลือกโต๊ะ" subtitle="เปิดโต๊ะลูกค้า" scope={scope}>
      <section className="grid w-full max-w-full min-w-0 gap-3">
        <TableZoneSelector zones={zoneOptions} selectedZoneId={validSelectedZoneId} totalCount={allTables.length} />

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-[14px] border border-[#d4e5f8] bg-white p-3 shadow-[0_5px_14px_rgba(15,39,69,0.05)]">
            <p className="m-0 text-[10px] font-black text-[#587398]">ทั้งหมด</p>
            <b className="mt-1 block text-[18px] leading-none text-[#0f2745]">{tables.length}</b>
          </div>
          <div className="rounded-[14px] border border-[#d4e5f8] bg-white p-3 shadow-[0_5px_14px_rgba(15,39,69,0.05)]">
            <p className="m-0 text-[10px] font-black text-[#587398]">ว่าง</p>
            <b className="mt-1 block text-[18px] leading-none text-[#0f8d46]">{tables.filter((table) => table.effectiveStatus === "available").length}</b>
          </div>
          <div className="rounded-[14px] border border-[#d4e5f8] bg-white p-3 shadow-[0_5px_14px_rgba(15,39,69,0.05)]">
            <p className="m-0 text-[10px] font-black text-[#587398]">เปิดบิล</p>
            <b className="mt-1 block text-[18px] leading-none text-[#1677d9]">{tables.filter((table) => table.session).length}</b>
          </div>
        </div>

        <TableGridPager tables={tableItems} />
      </section>
    </MobileAppShell>
  );
}
