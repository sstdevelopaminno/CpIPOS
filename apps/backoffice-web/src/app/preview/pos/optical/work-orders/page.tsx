import { PosOpticalWorkOrdersWorkspace } from "@/components/pos/pos-optical-work-orders-workspace";

export const dynamic="force-dynamic";

/**
 * Separate Optical cashier route. It is never exposed to regular tenants:
 * platform switch + tenant custom-feature grants + POS login/shift permissions
 * must all pass before any customer, inventory or financial data is returned.
 * The original food order / kitchen / table routing is not imported here.
 */
export default function OpticalWorkOrdersPage() {
  if(process.env.OPTICAL_FINANCE_V1_ENABLED!=="true"){
    return <main className="mx-auto max-w-2xl p-6" role="status">
      <h1 className="text-xl font-bold">Optical Work Orders</h1>
      <p className="mt-3">ระบบใบสั่งงานและเงินมัดจำอยู่ระหว่างตรวจสอบ โดยยังไม่เปิดใช้งานสำหรับร้าน Production</p>
    </main>;
  }
  return <PosOpticalWorkOrdersWorkspace/>;
}
