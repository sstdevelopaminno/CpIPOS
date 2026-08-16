import Link from "next/link";
import { AppShell, EmptyState } from "@/components/shell";
import { requireSession } from "@/lib/auth";
import { createFileGrant } from "@/lib/files";
import { DataSourceNotConfiguredError, getTransactions } from "@/lib/accounting";

export default async function TransactionsPage({
  searchParams
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const session = await requireSession(["cfo"]);
  const params = await searchParams;
  const kind = params.type === "expense" ? "expense" : "income";

  try {
    const rows = await getTransactions(kind);

    return (
      <AppShell role={session.role} title={kind === "income" ? "รายรับ" : "รายจ่าย"} subtitle="ข้อมูลจากสมุดรายรับ-รายจ่ายบริษัท">
        <div className="tabBar">
          <Link className={`tab ${kind === "income" ? "active" : ""}`} href="/transactions?type=income">รายรับ</Link>
          <Link className={`tab ${kind === "expense" ? "active" : ""}`} href="/transactions?type=expense">รายจ่าย</Link>
        </div>

        <section className="stack">
          {rows.map((row, index) => (
            <article className="listCard" key={`${row.documentNo}-${row.date}-${index}`}>
              <div className="listTop">
                <div>
                  <p className="listTitle">{row.description || row.category || "รายการบัญชี"}</p>
                  <div className="listMeta">
                    <span>{row.date || "-"}</span>
                    {row.documentNo ? <span>{row.documentNo}</span> : null}
                    {row.category ? <span>{row.category}</span> : null}
                  </div>
                </div>
                <p className="listAmount">{row.total || "-"}</p>
              </div>

              <div className="listMeta">
                {row.counterparty ? <span className="chip">{row.counterparty}</span> : null}
                {row.taxStatus ? <span className="chip">{row.taxStatus}</span> : null}
                {row.paymentStatus ? <span className="chip">{row.paymentStatus}</span> : null}
              </div>

              {row.evidenceIds.length ? (
                <div className="actions">
                  {row.evidenceIds.map((fileId, fileIndex) => {
                    const grant = createFileGrant(fileId, session.role);
                    return (
                      <span key={fileId} style={{ display: "inline-flex", gap: 6 }}>
                        <a className="smallButton" href={`/api/files/${grant}`} target="_blank" rel="noreferrer">
                          ดูหลักฐาน {row.evidenceIds.length > 1 ? fileIndex + 1 : ""}
                        </a>
                        <a className="smallButton" href={`/api/files/${grant}?download=1`}>
                          ดาวน์โหลด
                        </a>
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </article>
          ))}
        </section>
      </AppShell>
    );
  } catch (error) {
    if (error instanceof DataSourceNotConfiguredError) {
      return (
        <AppShell role={session.role} title="รายรับ / รายจ่าย">
          <EmptyState title="ยังไม่ได้เชื่อมข้อมูล" detail="ตั้งค่า Google Sheets read-only ใน Accounting Vercel Project ก่อนใช้งานหน้ารายการ" />
        </AppShell>
      );
    }
    throw error;
  }
}
