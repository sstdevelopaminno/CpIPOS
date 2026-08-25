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

  const now = Date.now();
  const rows = devices ?? [];
  const live = rows.filter((d) => d.last_seen_at && now - new Date(String(d.last_seen_at)).getTime() <= 5 * 60 * 1000).length;
  const stale = Math.max(0, rows.length - live);

  return (
    <div className="pageStack">
      <section className="hero">
        <div className="eyebrow">MDM CONTROL CENTER</div>
        <h1 className="pageTitle">Store → Branch → Device</h1>
        <p className="pageSubtitle">มุมมอง fleet แบบ exact-device scoped ก่อนเปิดคำสั่ง MDM จริง ทุก action ใน Phase ถัดไปจะต้องมี Target Preview, Confirmation และ Audit โดยไม่มี Global Broadcast ใน normal UI</p>
        <div className="heroMeta"><span className="softPill">Exact device targeting</span><span className="softPill">Global broadcast OFF</span><span className="softPill">Commands disabled</span></div>
      </section>

      <section className="grid metrics">
        <article className="surface metric"><div className="metricTop"><span>Total Devices</span><i className="metricAccent" /></div><strong>{rows.length}</strong><small>registered fleet</small></article>
        <article className="surface metric"><div className="metricTop"><span>Live ≤ 5m</span><i className="metricAccent ok" /></div><strong>{live}</strong><small>recent heartbeat</small></article>
        <article className="surface metric"><div className="metricTop"><span>Stale / Offline</span><i className={`metricAccent ${stale > 0 ? "warn" : "ok"}`} /></div><strong>{stale}</strong><small>requires attention</small></article>
      </section>

      <section className="surface">
        <div className="sectionHeader"><div><h2>Device Fleet</h2><p>Android runtime, heartbeat และ target scope</p></div><span className="badge badgeInfo">READ ONLY</span></div>
        <div className="tableWrap">
          <table className="table">
            <thead><tr><th>Device</th><th>Health</th><th>Status</th><th>App</th><th>Last Seen</th><th>Tenant</th><th>Branch</th><th>Target Mode</th></tr></thead>
            <tbody>{rows.map((d) => {
              const metadata = (d.metadata ?? {}) as DeviceMetadata;
              const appVersion = metadata.android_mdm_app_version ?? metadata.android_mdm_runtime?.version_name ?? "-";
              const isLive = Boolean(d.last_seen_at && now - new Date(String(d.last_seen_at)).getTime() <= 5 * 60 * 1000);
              return <tr key={String(d.id)}>
                <td><strong>{String(d.device_name ?? d.device_code)}</strong><br/><small>{String(d.device_code)}</small></td>
                <td><span className={`badge ${isLive ? "badgeOk" : "badgeWarn"}`}><span className="statusDot" />{isLive ? "LIVE" : "STALE"}</span></td>
                <td>{String(d.status)}</td>
                <td>{appVersion}</td>
                <td>{d.last_seen_at ? new Date(String(d.last_seen_at)).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "Never"}</td>
                <td><span className="mono">{String(d.tenant_id).slice(0,8)}…</span></td>
                <td><span className="mono">{String(d.branch_id).slice(0,8)}…</span></td>
                <td><span className="badge badgeOk">EXACT DEVICE ONLY</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <section className="notice dangerNotice"><span>⚠</span><div><strong>MDM mutation ยังปิดอยู่.</strong> รอบนี้ไม่มี Restart, Reload, Update, Clear Data หรือคำสั่งอื่นถูกส่งไปยัง FG0003 หรืออุปกรณ์ใด ๆ</div></section>
    </div>
  );
}
