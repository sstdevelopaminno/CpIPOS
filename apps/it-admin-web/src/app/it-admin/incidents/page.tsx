import { requireOperator } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  await requireOperator();
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("pos_device_incidents")
    .select("id,tenant_id,branch_id,pos_device_id,severity,title,message,created_at,resolved_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const open = rows.filter((row) => !row.resolved_at);
  const critical = open.filter((row) => String(row.severity).toLowerCase() === "critical").length;
  const resolved = rows.length - open.length;

  return (
    <div className="pageStack">
      <section className="hero">
        <div className="eyebrow">INCIDENT CENTER</div>
        <h1 className="pageTitle">เหตุขัดข้องและการเฝ้าระวัง</h1>
        <p className="pageSubtitle">รวมเหตุ POS, MDM, Printer และ Runtime แบบ tenant → branch → device scoped เพื่อให้ทีม IT เห็นสิ่งที่ต้องจัดการก่อน โดยรอบนี้ยังเป็น read-only</p>
        <div className="heroMeta"><span className="softPill">No auto-resolve mutation</span><span className="softPill">Scoped incident visibility</span></div>
      </section>

      <section className="grid metrics">
        <article className="surface metric"><div className="metricTop"><span>Open Incidents</span><i className={`metricAccent ${open.length > 0 ? "warn" : "ok"}`} /></div><strong>{open.length}</strong><small>awaiting response</small></article>
        <article className="surface metric"><div className="metricTop"><span>Critical Open</span><i className={`metricAccent ${critical > 0 ? "danger" : "ok"}`} /></div><strong>{critical}</strong><small>highest priority</small></article>
        <article className="surface metric"><div className="metricTop"><span>Resolved</span><i className="metricAccent ok" /></div><strong>{resolved}</strong><small>within current result set</small></article>
      </section>

      <section className="surface">
        <div className="sectionHeader"><div><h2>Incident Timeline</h2><p>ล่าสุดสูงสุด 200 รายการ</p></div><span className="badge badgeInfo">READ ONLY</span></div>
        <div className="tableWrap">
          <table className="table">
            <thead><tr><th>Severity</th><th>Incident</th><th>Created</th><th>Device</th><th>Tenant / Branch</th><th>Status</th></tr></thead>
            <tbody>{rows.map((row) => {
              const severity = String(row.severity ?? "info").toLowerCase();
              const severityClass = severity === "critical" ? "badgeDanger" : severity === "warning" || severity === "warn" ? "badgeWarn" : "badgeInfo";
              return <tr key={String(row.id)}>
                <td><span className={`badge ${severityClass}`}><span className="statusDot" />{severity.toUpperCase()}</span></td>
                <td><strong>{String(row.title ?? "Incident")}</strong><br/><small>{String(row.message ?? "")}</small></td>
                <td>{row.created_at ? new Date(String(row.created_at)).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "-"}</td>
                <td><span className="mono">{String(row.pos_device_id ?? "-").slice(0,10)}</span></td>
                <td><span className="mono">{String(row.tenant_id ?? "-").slice(0,7)}… / {String(row.branch_id ?? "-").slice(0,7)}…</span></td>
                <td><span className={`badge ${row.resolved_at ? "badgeOk" : "badgeWarn"}`}>{row.resolved_at ? "RESOLVED" : "OPEN"}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {rows.length === 0 ? <div className="empty">ไม่พบ Incident ในช่วงข้อมูลปัจจุบัน</div> : null}
      </section>
    </div>
  );
}
