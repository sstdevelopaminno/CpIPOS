import { TableOrderMobile } from "@/components/table-order/table-order-mobile";
import { TableQrCountdownGuard } from "@/components/table-order/table-qr-countdown-guard";

export default async function TableOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <TableQrCountdownGuard token={token} />
      <TableOrderMobile token={token} />
    </>
  );
}
