type KitchenTicketHtmlItem = {
  name: string;
  quantity: number;
  notes?: string | null;
  action?: string | null;
};

export type KitchenTicketHtmlInput = {
  storeName: string;
  branchName: string;
  zoneName: string;
  zoneCode: string;
  queueNo: number;
  roundNo: number;
  orderNo: string;
  orderType: string;
  tableLabel?: string | null;
  ticketId: string;
  eventType: string;
  createdAtIso: string;
  paperWidthMm: 58 | 80;
  items: KitchenTicketHtmlItem[];
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function eventLabel(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "add") return "เพิ่มรายการ";
  if (normalized === "cancel") return "ยกเลิกรายการ";
  if (normalized === "reprint") return "พิมพ์ซ้ำ";
  return "รายการใหม่";
}

function orderTypeLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "dine_in") return "ทานที่ร้าน";
  if (normalized === "takeaway") return "กลับบ้าน";
  if (normalized === "delivery_manual") return "เดลิเวอรี";
  return value || "-";
}

function thaiDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Bangkok"
  }).format(date);
}

export function renderKitchenTicketHtml(input: KitchenTicketHtmlInput) {
  const width = input.paperWidthMm === 58 ? "58mm" : "80mm";
  const tableLabel = input.tableLabel?.trim() || null;
  const itemRows = input.items
    .map((item) => {
      const notes = item.notes?.trim()
        ? `<div class="notes"><span>หมายเหตุ:</span> ${escapeHtml(item.notes)}</div>`
        : "";
      return `<div class="item">
        <div class="item-main">
          <span class="qty">${escapeHtml(item.quantity)} x</span>
          <span class="name">${escapeHtml(item.name)}</span>
        </div>
        ${notes}
      </div>`;
    })
    .join("");

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #fff;
      color: #111;
      font-family: "Noto Sans Thai", "Tahoma", "Arial", sans-serif;
      font-size: ${input.paperWidthMm === 58 ? "10.5px" : "14px"};
      line-height: ${input.paperWidthMm === 58 ? "1.24" : "1.35"};
    }
    .ticket { width: ${width}; padding: ${input.paperWidthMm === 58 ? "7px 6px" : "10px"}; }
    .center { text-align: center; }
    .title { font-size: ${input.paperWidthMm === 58 ? "1.35em" : "1.45em"}; font-weight: 900; }
    .store { font-weight: 800; font-size: 1.05em; }
    .zone { margin-top: ${input.paperWidthMm === 58 ? "5px" : "6px"}; font-size: ${input.paperWidthMm === 58 ? "1.55em" : "1.7em"}; font-weight: 900; line-height: 1.1; }
    .badge { display: inline-block; margin-top: 4px; border: 2px solid #111; padding: ${input.paperWidthMm === 58 ? "2px 7px" : "2px 8px"}; font-weight: 900; }
    .table-box { margin: ${input.paperWidthMm === 58 ? "7px 0" : "9px 0"}; border: 3px solid #111; padding: ${input.paperWidthMm === 58 ? "5px" : "7px"}; text-align: center; }
    .table-box span { display: block; font-weight: 800; }
    .table-box strong { display: block; font-size: ${input.paperWidthMm === 58 ? "2.2em" : "2.5em"}; line-height: 1.05; overflow-wrap: anywhere; }
    .queue { display: grid; grid-template-columns: 1fr 1fr; gap: ${input.paperWidthMm === 58 ? "5px" : "6px"}; margin: ${tableLabel ? "0 0 7px" : input.paperWidthMm === 58 ? "7px 0" : "10px 0"}; }
    .queue div { border: 2px solid #111; padding: ${input.paperWidthMm === 58 ? "4px" : "6px"}; text-align: center; }
    .queue strong { display: block; font-size: ${input.paperWidthMm === 58 ? "2.1em" : "2.25em"}; line-height: 1; }
    .meta { border-top: 1px dashed #111; border-bottom: 1px dashed #111; padding: ${input.paperWidthMm === 58 ? "4px 0" : "6px 0"}; }
    .row { display: flex; justify-content: space-between; gap: ${input.paperWidthMm === 58 ? "6px" : "8px"}; }
    .row strong { text-align: right; overflow-wrap: anywhere; }
    .items { margin-top: ${input.paperWidthMm === 58 ? "5px" : "8px"}; }
    .item { padding: ${input.paperWidthMm === 58 ? "4px 0" : "7px 0"}; border-bottom: 1px solid #ddd; }
    .item-main { display: flex; gap: ${input.paperWidthMm === 58 ? "5px" : "8px"}; align-items: baseline; min-width: 0; }
    .qty { min-width: ${input.paperWidthMm === 58 ? "2.8em" : "3.2em"}; font-size: ${input.paperWidthMm === 58 ? "1.22em" : "1.35em"}; font-weight: 900; }
    .name { flex: 1; min-width: 0; font-size: ${input.paperWidthMm === 58 ? "1.18em" : "1.25em"}; font-weight: 800; line-height: ${input.paperWidthMm === 58 ? "1.22" : "normal"}; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
    .notes { margin-left: ${input.paperWidthMm === 58 ? "3.2em" : "3.8em"}; margin-top: 2px; font-weight: 700; overflow-wrap: anywhere; }
    .notes span { font-weight: 900; }
    .footer { margin-top: ${input.paperWidthMm === 58 ? "5px" : "8px"}; font-size: ${input.paperWidthMm === 58 ? ".8em" : ".85em"}; border-top: 1px dashed #111; padding-top: ${input.paperWidthMm === 58 ? "4px" : "6px"}; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main class="ticket">
    <section class="center">
      <div class="title">ใบสั่งอาหารเข้าครัว</div>
      <div class="store">${escapeHtml(input.storeName)}</div>
      <div>${escapeHtml(input.branchName)}</div>
      <div class="zone">${escapeHtml(input.zoneName)}</div>
      <div class="badge">${eventLabel(input.eventType)}</div>
    </section>
    ${tableLabel ? `<section class="table-box"><span>โต๊ะ</span><strong>${escapeHtml(tableLabel)}</strong></section>` : ""}
    <section class="queue">
      <div><span>คิว</span><strong>${escapeHtml(input.queueNo)}</strong></div>
      <div><span>รอบ</span><strong>${escapeHtml(input.roundNo)}</strong></div>
    </section>
    <section class="meta">
      <div class="row"><span>เลขที่ออเดอร์</span><strong>${escapeHtml(input.orderNo)}</strong></div>
      <div class="row"><span>ประเภท</span><strong>${escapeHtml(orderTypeLabel(input.orderType))}</strong></div>
      <div class="row"><span>เวลา</span><strong>${escapeHtml(thaiDateTime(input.createdAtIso))}</strong></div>
    </section>
    <section class="items">${itemRows}</section>
    <section class="footer">
      <div>เลขที่ใบครัว: ${escapeHtml(input.ticketId)}</div>
      <div>โซนครัว: ${escapeHtml(input.zoneCode)}</div>
    </section>
  </main>
</body>
</html>`;
}
