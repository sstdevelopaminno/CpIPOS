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
  const open = (data ?? []).filter((row) => !row.resolved_at);
  return <div className="grid" style={{gap:18}}>
    <section className="surface"><div style={{fontSize:12,fontWeight:900,color:"#246af0"}}>INCIDENT CENTER</div><h1 style={{margin:"7px 0"}}>Open Incidents: {open.length}</h1><p style={{margin:0,color:"#607089"}}>รวมเหตุ POS / MDM / Printer / Runtime แบบ tenant-branch-device scoped รอบนี้อ่านอย่างเดียว ยังไม่มี acknowledge/contain/resolve mutation</p></section>
    <section className="surface"><div className="tableWrap"><table className="table"><thead><tr><th>Severity</th><th>Incident</th><th>Created</th><th>Device</th><th>Status</th></tr></thead><tbody>{(data??[]).map((row)=><tr key={String(row.id)}><td><span className={`badge ${String(row.severity)==="critical"?"warn":""}`}>{String(row.severity)}</span></td><td><strong>{String(row.title??"Incident")}</strong><br/><small>{String(row.message??"")}</small></td><td>{row.created_at?new Date(String(row.created_at)).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}):"-"}</td><td><code>{String(row.pos_device_id??"-").slice(0,10)}</code></td><td>{row.resolved_at?"Resolved":"Open"}</td></tr>)}</tbody></table></div></section>
  </div>;
}
