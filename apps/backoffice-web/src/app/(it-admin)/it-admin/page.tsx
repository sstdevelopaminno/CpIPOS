import Link from "next/link";
import { requireItSupport } from "@/lib/it-admin-guard";
import styles from "./control-plane.module.css";

async function count(query: PromiseLike<{ count:number|null; error:{message:string}|null }>) { const result=await query; if(result.error) return 0; return result.count??0 }
export const dynamic="force-dynamic";
export default async function ItAdminPage(){
 const {supabase,auth}=await requireItSupport();
 const now=new Date(); const liveSince=new Date(now.getTime()-5*60_000).toISOString();
 const [tenants,branches,devices,liveDevices,critical,openIncidents]=await Promise.all([
  count(supabase.from("tenants").select("id",{count:"exact",head:true}).eq("is_active",true)),
  count(supabase.from("branches").select("id",{count:"exact",head:true}).eq("is_active",true)),
  count(supabase.from("branch_devices").select("id",{count:"exact",head:true}).eq("is_active",true)),
  count(supabase.from("branch_devices").select("id",{count:"exact",head:true}).eq("is_active",true).gte("last_seen_at",liveSince)),
  count(supabase.from("pos_device_health_latest").select("id",{count:"exact",head:true}).eq("status","critical")),
  count(supabase.from("pos_device_incidents").select("id",{count:"exact",head:true}).is("resolved_at",null))
 ]);
 const cards=[
  ["Operations Center","ดู Store Registry, MDM/POS, Print Agent, QR และ Incident จากหน้าเดียว","/it-admin/operations","เปิด Operations"],
  ["ศูนย์บริการ 24/7","ค้นหารหัสร้าน ดู MDM, POS, Print, KDS และ Incident","/it-admin/support","เปิด Support"],
  ["Monitoring","ดู Queue, API 4xx/409/5xx และ health ทุกสาขา","/it-admin/monitoring","เปิด Monitoring"],
  ["ร้านค้าและรหัสร้าน","จัดการ Tenant, Store Code, สาขา และแพ็กเกจ","/it-admin/tenants","จัดการร้านค้า"],
  ["แพ็กเกจและสิทธิ์","ตรวจ package catalog, quota และ feature entitlement","/it-admin/packages","เปิดแพ็กเกจ"]
 ];
 return <div className={styles.page}><section className={styles.hero}><div><span>PLATFORM OVERVIEW</span><h1>CpIPOS Control Plane</h1><p>หน้าหลักสำหรับควบคุมแพลตฟอร์มและภาพรวมลูกค้าทั้งระบบ — แยกจากหน้าช่วยเหลือรายร้านอย่างชัดเจน</p></div><div className={styles.role}>{auth.platformRole==="it_admin"?"IT ADMIN · FULL CONTROL":"IT SUPPORT · READ ONLY"}</div></section><section className={styles.metrics}><div><span>ร้าน Active</span><strong>{tenants}</strong></div><div><span>สาขา Active</span><strong>{branches}</strong></div><div><span>POS Devices</span><strong>{devices}</strong><small>{liveDevices} live ≤ 5 นาที</small></div><div><span>Critical MDM</span><strong>{critical}</strong><small>{openIncidents} open incidents</small></div></section><section className={styles.grid}>{cards.map(([title,desc,href,action])=><article key={href}><h2>{title}</h2><p>{desc}</p><Link href={href}>{action} →</Link></article>)}</section><section className={styles.routes}><h2>เส้นทางใช้งาน</h2><div><code>/it-admin</code><span>Control Plane หน้าหลัก — ภาพรวมระบบ ลูกค้า แพ็กเกจ และการปฏิบัติการ</span></div><div><code>/it-admin/operations</code><span>Operations Center — fleet/store health, product code family และ launch gate แบบ read-only</span></div><div><code>/it-admin/support</code><span>Support Center — ค้นหารหัสร้านและแก้ปัญหารายร้าน</span></div></section></div>
}
