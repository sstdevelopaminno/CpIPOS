import { AppShell, EmptyState } from "@/components/shell";
import { requireSession } from "@/lib/auth";
import { createFileGrant } from "@/lib/files";
import { DataSourceNotConfiguredError, getSalesDocuments } from "@/lib/accounting";

export default async function DocumentsPage() {
  const session = await requireSession();

  try {
    const documents = await getSalesDocuments();

    return (
      <AppShell role={session.role} title="เอกสารบริษัท" subtitle="ใบเสนอราคา ใบแจ้งหนี้ ใบรับเงินมัดจำ ใบเสร็จ และหลักฐาน">
        <section className="stack">
          {documents.map((doc, index) => (
            <article className="listCard" key={`${doc.documentNo}-${index}`}>
              <div className="listTop">
                <div>
                  <p className="listTitle">{doc.documentNo || doc.type || "เอกสาร"}</p>
                  <div className="listMeta">
                    <span>{doc.date || "-"}</span>
                    {doc.type ? <span>{doc.type}</span> : null}
                    {doc.customer ? <span>{doc.customer}</span> : null}
                  </div>
                </div>
                <p className="listAmount">{doc.total || "-"}</p>
              </div>

              {doc.subject ? <p className="muted">{doc.subject}</p> : null}
              <div className="listMeta">
                {doc.status ? <span className="chip">{doc.status}</span> : null}
                {doc.paymentStatus ? <span className="chip">{doc.paymentStatus}</span> : null}
                {session.role === "cfo" && doc.accountingStatus ? <span className="chip">{doc.accountingStatus}</span> : null}
              </div>

              {doc.fileIds.length ? (
                <div className="actions">
                  {doc.fileIds.map((fileId, fileIndex) => {
                    const grant = createFileGrant(fileId, session.role);
                    return (
                      <span key={fileId} style={{ display: "inline-flex", gap: 6 }}>
                        <a className="smallButton" href={`/api/files/${grant}`} target="_blank" rel="noreferrer">
                          ดูเอกสาร {doc.fileIds.length > 1 ? fileIndex + 1 : ""}
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
        <AppShell role={session.role} title="เอกสารบริษัท">
          <EmptyState title="ยังไม่ได้เชื่อมทะเบียนเอกสาร" detail="ตั้งค่า Sales Document Spreadsheet ID และ Google Service Account แบบ Viewer ใน Accounting Project" />
        </AppShell>
      );
    }
    throw error;
  }
}
