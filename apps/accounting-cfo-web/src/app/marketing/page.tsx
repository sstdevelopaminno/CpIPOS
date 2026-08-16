import { DataTable } from "@/components/data-table";
import { AppShell, EmptyState } from "@/components/shell";
import { requireSession } from "@/lib/auth";
import { DataSourceNotConfiguredError, getMarketingView } from "@/lib/accounting";

export default async function MarketingPage() {
  const session = await requireSession(["cfo", "marketing"]);

  try {
    const data = await getMarketingView();

    return (
      <AppShell role={session.role} title="ฝ่ายบริหารการตลาด" subtitle="ยอดขาย รายรับ และค่าคอมมิชัน โดยไม่เปิดข้อมูลธนาคาร/รายจ่ายภายใน">
        <div className="sectionHeader"><div><h2>รายรับล่าสุด</h2><p>ไม่แสดงหมายเหตุธนาคารหรือข้อมูลรายจ่าย</p></div></div>
        <section className="stack">
          {data.income.slice(0, 40).map((row, index) => (
            <article className="listCard" key={`${row.documentNo}-${index}`}>
              <div className="listTop">
                <div>
                  <p className="listTitle">{row.description || row.category}</p>
                  <div className="listMeta">
                    <span>{row.date}</span>
                    {row.documentNo ? <span>{row.documentNo}</span> : null}
                    {row.counterparty ? <span>{row.counterparty}</span> : null}
                  </div>
                </div>
                <p className="listAmount">{row.total || "-"}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="panel" style={{ marginTop: 20 }}>
          <div className="panelHeader"><h2>ค่าคอมมิชันขาย</h2></div>
          <DataTable rows={data.commission} />
        </section>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof DataSourceNotConfiguredError) {
      return (
        <AppShell role={session.role} title="ฝ่ายบริหารการตลาด">
          <EmptyState title="ยังไม่ได้เชื่อมข้อมูลการตลาด" detail="เมื่อเชื่อม Accounting Source ฝ่ายการตลาดจะเห็นเฉพาะยอดขาย/รายรับและค่าคอมมิชันที่กำหนดไว้" />
        </AppShell>
      );
    }
    throw error;
  }
}
