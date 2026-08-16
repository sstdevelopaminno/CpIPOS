import { DataTable } from "@/components/data-table";
import { AppShell, EmptyState } from "@/components/shell";
import { requireSession } from "@/lib/auth";
import { DataSourceNotConfiguredError, getManagementReports } from "@/lib/accounting";

export default async function ReportsPage() {
  const session = await requireSession(["cfo"]);

  try {
    const reports = await getManagementReports();

    return (
      <AppShell role={session.role} title="รายงาน CFO" subtitle="P&L งบดุล Cash Flow และสรุปรายเดือน">
        <section className="panel">
          <div className="panelHeader"><h2>งบกำไรขาดทุนบริหาร</h2></div>
          <DataTable rows={reports.profitLoss} />
        </section>
        <section className="panel">
          <div className="panelHeader"><h2>งบดุลบริหาร</h2></div>
          <DataTable rows={reports.balanceSheet} />
        </section>
        <section className="panel">
          <div className="panelHeader"><h2>Cash Flow CFO</h2></div>
          <DataTable rows={reports.cashFlow} />
        </section>
        <section className="panel">
          <div className="panelHeader"><h2>สรุปรายเดือน</h2></div>
          <DataTable rows={reports.monthly} />
        </section>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof DataSourceNotConfiguredError) {
      return (
        <AppShell role={session.role} title="รายงาน CFO">
          <EmptyState title="ยังไม่ได้เชื่อมรายงาน" detail="ระบบพร้อมอ่านรายงานจาก Google Sheets เมื่อเพิ่มค่า environment ของ Accounting Project" />
        </AppShell>
      );
    }
    throw error;
  }
}
