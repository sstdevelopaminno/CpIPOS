import { DataTable } from "@/components/data-table";
import { AppShell, EmptyState } from "@/components/shell";
import { requireSession } from "@/lib/auth";
import { DataSourceNotConfiguredError, getBankReport } from "@/lib/accounting";

function objectsToRows(rows: Record<string, string>[]) {
  if (!rows.length) return [];
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
}

export default async function BankPage() {
  const session = await requireSession(["cfo"]);

  try {
    const report = await getBankReport();

    return (
      <AppShell role={session.role} title="ธนาคาร" subtitle="กระทบยอดและรายการเดินบัญชีแบบ Read-only">
        <section className="panel">
          <div className="panelHeader"><h2>กระทบยอดธนาคาร</h2></div>
          <DataTable rows={objectsToRows(report.recon)} />
        </section>

        <section className="panel">
          <div className="panelHeader"><h2>เดินบัญชีธนาคาร</h2></div>
          <DataTable rows={objectsToRows(report.bank.slice(0, 80))} />
        </section>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof DataSourceNotConfiguredError) {
      return (
        <AppShell role={session.role} title="ธนาคาร">
          <EmptyState title="ยังไม่ได้เชื่อมข้อมูลธนาคาร" detail="หน้านี้จะอ่านเฉพาะข้อมูลที่บันทึกไว้ใน Google Sheets และจะไม่เชื่อมเขียนกลับธนาคารหรือ POS" />
        </AppShell>
      );
    }
    throw error;
  }
}
