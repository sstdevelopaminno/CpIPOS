import { requireOperator } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type DeviceMetadata = {
  android_mdm_app_version?: string;
  android_mdm_runtime?: { version_name?: string; version_code?: number };
};

export default async function MdmPage() {
  await requireOperator();
  const supabase = getServiceClient();
  const { data: devices, error } = await supabase
    .from("branch_devices")
    .select("id,tenant_id,branch_id,device_code,device_name,status,last_seen_at,metadata")
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return <div className="grid" style={{gap:18}}>
    <section className="surface"><div style={{fontSize:12,fontWeight:900,color:"#246af0"}}>MDM CONTROL CENTER</div><h1 style={{margin:"7px 0"}}>Store → Branch → Device</h1><p style={{margin:0,color:"#607089"}}>Phase separation นี้เป็น read-only ก่อน ปุ่มสั่งงานจะเพิ่มเมื่อมี Target Preview + Confirmation + Audit และจะไม่มี Global Broadcast ใน normal UI</p></section>
    <section className="surface"><div className="tableWrap"><table className="table"><thead><tr><th>Device</th><th>Status</th><th>App</th><th>Last Seen</th><th>Tenant</th><th>Branch</th><th>Target Mode</th></tr></thead><tbody>{(devices??[]).map((d)=>{const metadata=(d.metadata??{}) as DeviceMetadata; const appVersion=metadata.android_mdm_app_version??metadata.android_mdm_runtime?.version_name??"-"; return <tr key={String(d.id)}><td><strong>{String(d.device_name??d.device_code)}</strong><br/><small>{String(d.device_code)}</small></td><td>{String(d.status)}</td><td>{appVersion}</td><td>{d.last_seen_at?new Date(String(d.last_seen_at)).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}):"Never"}</td><td><code>{String(d.tenant_id).slice(0,8)}…</code></td><td><code>{String(d.branch_id).slice(0,8)}…</code></td><td><span className="badge ok">EXACT DEVICE ONLY</span></td></tr>})}</tbody></table></div></section>
  </div>;
}
