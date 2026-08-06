import { MobileAppShell } from "@/components/layout/mobile-app-shell";
import { requireOpenShift } from "@/lib/permissions/guard";
import { createServiceClient } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type OrderRow = {
  id: string;
  order_no: string;
  order_type: string | null;
  channel: string | null;
  status: string | null;
  subtotal: number | null;
  discount_amount: number | null;
  total_amount: number | null;
  grand_total: number | null;
  tax_total: number | null;
  paid_total: number | null;
  cash_received: number | null;
  change_amount: number | null;
  customer_name: string | null;
  notes: string | null;
  created_by: string | null;
  payment_completed_by: string | null;
  created_at: string | null;
  payment_completed_at: string | null;
  metadata: Record<string, unknown> | null;
};

type OrderItemRow = {
  id: string;
  name: string | null;
  product_id: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  notes: string | null;
};

type PaymentRow = {
  id: string;
  method: string | null;
  amount: number | null;
  reference_no: string | null;
  status: string | null;
  received_at: string | null;
};

type ProductNameRow = {
  id: string;
  name: string | null;
};

type TenantStoreProfileRow = {
  name: string | null;
  display_name: string | null;
  company_address: string | null;
  contact_phone: string | null;
  owner_phone: string | null;
};

type BranchRow = {
  name: string | null;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type PageProps = {
  params: Promise<{ orderId: string }>;
};

function money(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusLabel(status: string | null | undefined) {
  if (status === "paid" || status === "completed") return "ชำระแล้ว";
  if (status === "draft") return "กำลังขาย";
  if (status === "held") return "พักบิล";
  if (status === "cancelled") return "ยกเลิก";
  return status ?? "-";
}

function orderTypeLabel(type: string | null | undefined) {
  if (type === "takeaway") return "กลับบ้าน";
  if (type === "dine_in") return "โต๊ะ";
  if (type === "delivery" || type === "delivery_manual") return "เดลิเวอรี่";
  return type ?? "order";
}

function paymentMethodLabel(method: string | null | undefined) {
  if (method === "cash") return "เงินสด";
  if (method === "bank_transfer" || method === "transfer") return "โอน";
  return method ?? "-";
}

function receiptMethodLabel(payments: PaymentRow[]) {
  if (!payments.length) return "-";
  const methods = Array.from(new Set(payments.map((payment) => paymentMethodLabel(payment.method))));
  return methods.join(", ");
}

function storeName(profile: TenantStoreProfileRow | null | undefined) {
  return String(profile?.display_name || profile?.name || "ร้านค้า");
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { orderId } = await params;
  const { scope, shift } = await requireOpenShift("sales:list:view");
  const supabase = createServiceClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,order_no,order_type,channel,status,subtotal,discount_amount,total_amount,grand_total,tax_total,paid_total,cash_received,change_amount,customer_name,notes,created_by,payment_completed_by,created_at,payment_completed_at,metadata")
    .eq("id", orderId)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("shift_id", shift.id)
    .maybeSingle<OrderRow>();

  if (orderError) throw new Error(orderError.message);
  if (!order) notFound();

  const [{ data: items, error: itemsError }, { data: payments, error: paymentsError }, { data: tenantProfile }, { data: branchProfile }] = await Promise.all([
    supabase
      .from("order_items")
      .select("id,name,product_id,quantity,unit_price,line_total,notes")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("order_id", order.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("payments")
      .select("id,method,amount,reference_no,status,received_at")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("order_id", order.id)
      .order("received_at", { ascending: true }),
    supabase
      .from("tenants")
      .select("name,display_name,company_address,contact_phone,owner_phone")
      .eq("id", scope.tenantId)
      .maybeSingle<TenantStoreProfileRow>(),
    supabase
      .from("branches")
      .select("name")
      .eq("id", scope.branchId)
      .eq("tenant_id", scope.tenantId)
      .maybeSingle<BranchRow>(),
  ]);

  if (itemsError) throw new Error(itemsError.message);
  if (paymentsError) throw new Error(paymentsError.message);

  const itemRows = (items ?? []) as OrderItemRow[];
  const paymentRows = (payments ?? []) as PaymentRow[];
  const productIds = itemRows.map((item) => item.product_id).filter((id): id is string => Boolean(id));
  const userIds = Array.from(new Set([order.created_by, order.payment_completed_by].filter((id): id is string => Boolean(id))));
  const [{ data: productRows }, { data: userRows }] = await Promise.all([
    productIds.length
      ? supabase
        .from("products")
        .select("id,name")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .in("id", productIds)
      : Promise.resolve({ data: [] as ProductNameRow[] }),
    userIds.length
      ? supabase
        .from("users_profiles")
        .select("id,full_name,email")
        .in("id", userIds)
      : Promise.resolve({ data: [] as UserRow[] }),
  ]);

  const productNames = new Map(((productRows ?? []) as ProductNameRow[]).map((product) => [product.id, product.name]));
  const userNames = new Map(((userRows ?? []) as UserRow[]).map((user) => [user.id, user.full_name || user.email || user.id]));
  const receiptSubtotal = Number(order.subtotal ?? order.total_amount ?? 0);
  const receiptDiscount = Number(order.discount_amount ?? 0);
  const receiptTax = Number(order.tax_total ?? 0);
  const receiptTotal = Number(order.grand_total ?? order.total_amount ?? 0);
  const paidAt = order.payment_completed_at ?? paymentRows[0]?.received_at ?? order.created_at;
  const cashierName = userNames.get(order.payment_completed_by ?? "") ?? userNames.get(order.created_by ?? "") ?? "-";
  const branchName = String(branchProfile?.name || scope.branchId);
  const contactPhone = String(tenantProfile?.contact_phone || tenantProfile?.owner_phone || "");

  return (
    <MobileAppShell scope={scope}>
      <section className="grid w-full max-w-full min-w-0 gap-4 pb-8">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="m-0 text-[22px] font-black leading-tight text-[#0f2745]">รายละเอียดบิล</h1>
            <p className="m-0 mt-1 text-[12px] font-bold text-[#7a8fa8]">รูปแบบใบเสร็จ 58 mm</p>
          </div>
          <Link href="/orders" className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-[14px] border border-[#d4e5f8] bg-white px-3 text-[13px] font-black text-[#17416f] no-underline shadow-sm">
            <ArrowLeft size={17} />
            กลับ
          </Link>
        </div>

        <section className="rounded-[20px] border border-[#d4e5f8] bg-white p-3 shadow-[0_8px_20px_rgba(15,39,69,0.06)]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="m-0 truncate text-[18px] font-black text-[#0f2745]">{order.order_no}</h2>
              <p className="m-0 mt-1 text-[12px] font-bold text-[#587398]">{orderTypeLabel(order.order_type)} / {order.channel ?? "-"}</p>
            </div>
            <span className="shrink-0 rounded-full bg-[#eef6ff] px-3 py-1 text-[12px] font-black text-[#17416f]">{statusLabel(order.status)}</span>
          </div>

          <div className="mx-auto w-full max-w-[300px] rounded-[8px] border border-[#d8e6f5] bg-[#fffdf8] px-4 py-4 text-[#111827] shadow-[0_14px_28px_rgba(15,39,69,0.10)]">
            <div className="text-center font-mono">
              <p className="m-0 text-[14px] font-black leading-tight">{storeName(tenantProfile)}</p>
              {tenantProfile?.company_address ? <p className="m-0 mt-1 text-[10px] font-bold leading-snug">{tenantProfile.company_address}</p> : null}
              {contactPhone ? <p className="m-0 mt-1 text-[10px] font-bold leading-snug">Tel: {contactPhone}</p> : null}
              <p className="m-0 mt-1 text-[11px] font-bold leading-snug">{branchName}</p>
              <p className="m-0 mt-2 text-[13px] font-black tracking-[0.08em]">RECEIPT</p>
            </div>

            <div className="my-3 border-t border-dashed border-[#9ca3af]" />

            <div className="grid gap-1 font-mono text-[10px] font-bold leading-snug text-[#1f2937]">
              <div className="grid grid-cols-[1fr_auto] gap-2"><span>Order: {order.order_no}</span><span>{paidAt ? new Date(paidAt).toISOString().slice(0, 16).replace("T", " ") : "-"}</span></div>
              <div className="grid grid-cols-[1fr_auto] gap-2"><span>Cashier</span><span className="truncate text-right">{cashierName}</span></div>
            </div>

            <div className="my-3 border-t border-dashed border-[#9ca3af]" />

            <div className="grid gap-2 font-mono">
              {itemRows.length ? itemRows.map((item) => {
                const itemName = item.name || (item.product_id ? productNames.get(item.product_id) : null) || "-";
                return (
                  <div key={item.id}>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[11px] font-black leading-snug">
                      <span className="min-w-0 truncate">{Number(item.quantity ?? 0).toLocaleString("th-TH")}x {itemName}</span>
                      <span>{money(item.line_total)}</span>
                    </div>
                    <div className="mt-0.5 grid grid-cols-[1fr_auto] gap-2 text-[9px] font-bold text-[#6b7280]">
                      <span>@ {money(item.unit_price)}</span>
                      {item.notes ? <span className="truncate text-right">{item.notes}</span> : <span />}
                    </div>
                  </div>
                );
              }) : (
                <p className="m-0 rounded-[8px] bg-[#f8fbff] p-3 text-center text-[11px] font-bold text-[#7a8fa8]">ยังไม่มีรายการสินค้า</p>
              )}
            </div>

            <div className="my-3 border-t border-dashed border-[#9ca3af]" />

            <div className="grid gap-1 font-mono text-[11px] font-bold text-[#111827]">
              <div className="grid grid-cols-[1fr_auto] gap-2"><span>Subtotal</span><b>{money(receiptSubtotal)}</b></div>
              <div className="grid grid-cols-[1fr_auto] gap-2"><span>Discount</span><b>- {money(receiptDiscount)}</b></div>
              <div className="grid grid-cols-[1fr_auto] gap-2"><span>Tax</span><b>{money(receiptTax)}</b></div>
              <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-dashed border-[#9ca3af] pt-1 text-[13px]"><span>TOTAL</span><b>{money(receiptTotal)}</b></div>
              <div className="grid grid-cols-[1fr_auto] gap-2"><span>Payment</span><b>{receiptMethodLabel(paymentRows)}</b></div>
              {order.cash_received !== null ? <div className="grid grid-cols-[1fr_auto] gap-2"><span>Cash</span><b>{money(order.cash_received)}</b></div> : null}
              {order.change_amount !== null ? <div className="grid grid-cols-[1fr_auto] gap-2"><span>Change</span><b>{money(order.change_amount)}</b></div> : null}
            </div>

            {order.notes ? (
              <>
                <div className="my-3 border-t border-dashed border-[#9ca3af]" />
                <p className="m-0 font-mono text-[10px] font-bold text-[#1f2937]">{order.notes}</p>
              </>
            ) : null}

            <div className="my-3 border-t border-dashed border-[#9ca3af]" />
            <p className="m-0 text-center font-mono text-[11px] font-black">Thank you (THB)</p>
          </div>
        </section>

      </section>
    </MobileAppShell>
  );
}
