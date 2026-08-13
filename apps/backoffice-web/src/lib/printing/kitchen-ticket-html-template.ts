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
  if (normalized === "add") return "ADD";
  if (normalized === "cancel") return "CANCEL";
  if (normalized === "reprint") return "REPRINT";
  return "NEW";
}

export function renderKitchenTicketHtml(input: KitchenTicketHtmlInput) {
  const width = input.paperWidthMm === 58 ? "58mm" : "80mm";
  const itemRows = input.items
    .map((item) => {
      const notes = item.notes?.trim()
        ? `<div class="notes">${escapeHtml(item.notes)}</div>`
        : "";
      return `<div class="item">
        <div class="item-main">
          <span class="qty">x${escapeHtml(item.quantity)}</span>
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
      font-size: ${input.paperWidthMm === 58 ? "12px" : "14px"};
      line-height: 1.35;
    }
    .ticket { width: ${width}; padding: 10px; }
    .center { text-align: center; }
    .store { font-weight: 800; font-size: 1.05em; }
    .zone { margin-top: 6px; font-size: 1.75em; font-weight: 900; line-height: 1.1; }
    .badge { display: inline-block; margin-top: 4px; border: 2px solid #111; padding: 2px 8px; font-weight: 900; }
    .queue { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 10px 0; }
    .queue div { border: 2px solid #111; padding: 6px; text-align: center; }
    .queue strong { display: block; font-size: 2.25em; line-height: 1; }
    .meta { border-top: 1px dashed #111; border-bottom: 1px dashed #111; padding: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 8px; }
    .items { margin-top: 8px; }
    .item { padding: 7px 0; border-bottom: 1px solid #ddd; }
    .item-main { display: flex; gap: 8px; align-items: baseline; }
    .qty { min-width: 2.6em; font-size: 1.35em; font-weight: 900; }
    .name { flex: 1; font-size: 1.25em; font-weight: 800; overflow-wrap: anywhere; }
    .notes { margin-left: 3.3em; margin-top: 2px; font-weight: 700; }
    .footer { margin-top: 8px; font-size: .85em; border-top: 1px dashed #111; padding-top: 6px; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main class="ticket">
    <section class="center">
      <div class="store">${escapeHtml(input.storeName)}</div>
      <div>${escapeHtml(input.branchName)}</div>
      <div class="zone">${escapeHtml(input.zoneName)}</div>
      <div class="badge">${eventLabel(input.eventType)}</div>
    </section>
    <section class="queue">
      <div><span>Queue</span><strong>${escapeHtml(input.queueNo)}</strong></div>
      <div><span>Round</span><strong>${escapeHtml(input.roundNo)}</strong></div>
    </section>
    <section class="meta">
      <div class="row"><span>Order</span><strong>${escapeHtml(input.orderNo)}</strong></div>
      <div class="row"><span>Mode</span><strong>${escapeHtml(input.orderType)}</strong></div>
      ${input.tableLabel ? `<div class="row"><span>Table</span><strong>${escapeHtml(input.tableLabel)}</strong></div>` : ""}
      <div class="row"><span>Time</span><strong>${escapeHtml(new Date(input.createdAtIso).toLocaleString("th-TH"))}</strong></div>
    </section>
    <section class="items">${itemRows}</section>
    <section class="footer">
      <div>Ticket: ${escapeHtml(input.ticketId)}</div>
      <div>Zone: ${escapeHtml(input.zoneCode)}</div>
    </section>
  </main>
</body>
</html>`;
}
