import { requireOperator } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { ProvisioningPreflight } from "@/components/provisioning-preflight";

export const dynamic = "force-dynamic";

export default async function ProvisioningPage() {
  await requireOperator();
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("subscription_packages")
    .select("code,name,max_branches,max_devices,is_active,status,display_order")
    .eq("is_active", true)
    .eq("status", "active")
    .order("display_order", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);
  const packages = (data ?? []).map((row) => ({
    code: String(row.code),
    name: String(row.name),
    max_branches: Number(row.max_branches),
    max_devices: row.max_devices == null ? null : Number(row.max_devices)
  }));

  return (
    <div className="pageStack">
      <section className="hero">
        <div className="eyebrow">CONTROLLED STORE PROVISIONING</div>
        <h1 className="pageTitle">Provisioning Center</h1>
        <p className="pageSubtitle">ตรวจรหัสร้าน, tenant, branch, product profile และ package จาก Production แบบ read-only ก่อนสร้างร้านจริง ขั้นนี้ไม่มี write และใช้ได้ทั้ง FG Restaurant QR และ FF Buffet</p>
        <div className="heroMeta"><span className="softPill">Preflight only</span><span className="softPill">0 database writes</span><span className="softPill">FG / FF collision guard</span><span className="softPill">Initial state must be INACTIVE</span></div>
      </section>

      <section className="notice dangerNotice"><span>⚠</span><div><strong>Provision action ยังปิดอยู่.</strong> หน้านี้ตรวจข้อมูลเท่านั้น จะไม่มี tenant, branch, device, QR, payment หรือ user ถูกสร้างจากการกด Preflight</div></section>

      <ProvisioningPreflight packages={packages} />
    </div>
  );
}
