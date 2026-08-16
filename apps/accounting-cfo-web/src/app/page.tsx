import { AppShell, EmptyState } from "@/components/shell";
import { requireSession } from "@/lib/auth";
import { DataSourceNotConfiguredError, getDashboard } from "@/lib/accounting";

const MARKETING_ALLOWED = new Set([
  "รายได้ที่รับรู้แล้ว",
  "เงินมัดจำลูกค้า",
  "ยอดคงเหลือสัญญาลูกค้าที่รอเรียกเก็บ"
]);

function toneClass(status: string) {
  const value = status.toLowerCase();
  if (value.includes("รอ") || value.includes("pending")) return "statusWarn";
  if (value.includes("ผิด") || value.includes("ขาดทุน") || value.includes("error")) return "statusBad";
  if (value.includes("ยืนยัน") || value.includes("รายได้") || value.includes("ปกติ")) return "statusGood";
  return "";
}

export default async function DashboardPage() {
  const session = await requireSession();

  try {
    const allMetrics = await getDashboard();
    const metrics = session.role === "marketing"
      ? allMetrics.filter((item) => MARKETING_ALLOWED.has(item.label))
      : allMetrics;

    const hero = metrics[0];

    return (
      <AppShell
        role={session.role}
        title={session.role === "cfo" ? "CFO Dashboard" : "Marketing Dashboard"}
        subtitle="อ่านข้อมูลสดจาก Google Sheets แบบ Read-only"
      >
        {hero ? (
          <section className="heroCard">
            <p className="heroLabel">{hero.label}</p>
            <p className="heroValue">{hero.value || "-"}</p>
            <p className="muted">{hero.note || hero.status}</p>
          </section>
        ) : null}

        <div className="sectionHeader">
          <div>
            <h2>ตัวชี้วัดบริษัท</h2>
            <p>แสดงตามค่าที่บันทึกอยู่ใน Source of Truth โดยไม่ปรับตัวเลขในแอป</p>
          </div>
        </div>

        <section className="cardGrid">
          {metrics.slice(1).map((item) => (
            <article className="metricCard" key={item.label}>
              <p className="metricLabel">{item.label}</p>
              <p className="metricValue">{item.value || "-"}</p>
              {item.status ? <span className={`metricStatus ${toneClass(item.status)}`}>{item.status}</span> : null}
            </article>
          ))}
        </section>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof DataSourceNotConfiguredError) {
      return (
        <AppShell role={session.role} title="Accounting & CFO">
          <EmptyState
            title="ยังไม่ได้เชื่อม Google Accounting Source"
            detail="ตัวแอปแยกจาก POS เรียบร้อยแล้ว ขั้นต่อไปให้ตั้งค่า Service Account แบบ Viewer และ Spreadsheet IDs ใน Vercel ของ Accounting App เท่านั้น"
          />
        </AppShell>
      );
    }
    throw error;
  }
}
