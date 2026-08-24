import Link from "next/link";
import { requireOperator } from "@/lib/auth";
import { loadOperationsSnapshot } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function ItAdminPage() {
  await requireOperator();
  const snapshot = await loadOperationsSnapshot();
  const cards = [
    ["Active Stores", snapshot.totals.active_stores, "เปิดใช้งานจริง"],
    ["Provisioning", snapshot.totals.provisioning_stores, "inactive / onboarding"],
    ["Live POS", snapshot.totals.live_devices, `ทั้งหมด ${snapshot.totals.devices}`],
    ["Print Backlog", snapshot.totals.print_backlog ?? "N/A", "pending + retrying"],
    ["Open Incidents", snapshot.totals.open_incidents ?? "N/A", "ยังไม่ resolved"],
    ["QR Failures 15m", snapshot.totals.qr_failures_15m ?? "N/A", "ล่าสุด 15 นาที"]
  ];
  return <div className="grid" style={{gap:18}}>
    <section className="surface"><div style={{fontSize:12,fontWeight:900,color:"#246af0"}}>PLATFORM OVERVIEW</div><h1 style={{margin:"7px 0"}}>CpIPOS IT Control Plane</h1><p style={{margin:0,color:"#607089"}}>แยก deployment ออกจาก POS เพื่อให้แก้ UI, Monitoring, MDM และ Provisioning โดยไม่ redeploy ระบบขายร้านค้า</p></section>
    <section className="grid metrics">{cards.map(([label,value,note])=><article className="surface metric" key={String(label)}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</section>
    <section className="surface"><h2 style={{marginTop:0}}>ทางลัด</h2><div style={{display:"flex",gap:14,flexWrap:"wrap"}}><Link className="code" href="/it-admin/operations">Operations Center →</Link><Link className="code" href="/it-admin/stores">Store Registry →</Link><Link className="code" href="/it-admin/mdm">MDM Control →</Link><Link className="code" href="/it-admin/incidents">Incidents →</Link></div></section>
  </div>;
}
