import "server-only";

const THAI_ADDRESS_DATA_URL =
  "https://raw.githubusercontent.com/thailand-geography-data/thailand-geography-json/main/src/geography.json";
const THAI_ADDRESS_CACHE_MS = 24 * 60 * 60 * 1000;

export type TaxEntityType = "company" | "limited_partnership" | "shop" | "individual";

export type ThaiAddressOption = {
  postal_code: string;
  subdistrict: string;
  district: string;
  province: string;
  subdistrict_code: string;
  district_code: string;
  province_code: string;
};

export type TaxBuyerSnapshot = {
  entity_type: TaxEntityType;
  display_name: string;
  tax_id: string;
  address_line: string;
  subdistrict: string;
  district: string;
  province: string;
  postal_code: string;
};

export type TaxSellerSnapshot = {
  display_name: string;
  tax_id: string;
  branch_no: string;
  address: string;
  phone: string;
};

export type TaxInvoiceOrderSnapshot = {
  order_id: string;
  order_no: string;
  created_at: string;
  paid_at: string | null;
  subtotal: number;
  discount_amount: number;
  tax_total: number;
  grand_total: number;
  paid_total: number;
  customer_name: string | null;
};

export type TaxInvoiceItemSnapshot = {
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes?: string | null;
};

export type TaxInvoiceTaxLine = {
  label: string;
  rate_pct: number;
  mode: string;
  amount: number;
};

export type TaxInvoiceTaxSnapshot = {
  source: "order_snapshot";
  tax_total: number;
  lines: TaxInvoiceTaxLine[];
  warning: string | null;
};

type GeographyRow = {
  provinceCode?: number | string;
  provinceNameTh?: string;
  districtCode?: number | string;
  districtNameTh?: string;
  subdistrictCode?: number | string;
  subdistrictNameTh?: string;
  postalCode?: number | string;
};

type AddressCache = { expiresAt: number; rows: GeographyRow[] };

function addressCache(): AddressCache | null {
  const scoped = globalThis as typeof globalThis & { __cpiposThaiAddressCache?: AddressCache };
  return scoped.__cpiposThaiAddressCache ?? null;
}

function writeAddressCache(rows: GeographyRow[]) {
  const scoped = globalThis as typeof globalThis & { __cpiposThaiAddressCache?: AddressCache };
  scoped.__cpiposThaiAddressCache = { rows, expiresAt: Date.now() + THAI_ADDRESS_CACHE_MS };
}

export function normalizeDigits(value: unknown) {
  return String(value ?? "").replace(/[^0-9]/g, "");
}

export function isValidThaiTaxId(value: unknown) {
  const digits = normalizeDigits(value);
  if (!/^\d{13}$/.test(digits)) return false;
  const sum = digits
    .slice(0, 12)
    .split("")
    .reduce((acc, digit, index) => acc + Number(digit) * (13 - index), 0);
  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === Number(digits[12]);
}

export function isTaxEntityType(value: unknown): value is TaxEntityType {
  return value === "company" || value === "limited_partnership" || value === "shop" || value === "individual";
}

async function loadThaiGeography(): Promise<GeographyRow[]> {
  const cached = addressCache();
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const response = await fetch(THAI_ADDRESS_DATA_URL, {
    headers: { Accept: "application/json", "User-Agent": "CpIPOS/1.0 tax-address-lookup" },
    next: { revalidate: 86400 }
  });
  if (!response.ok) throw new Error(`thai_address_source_unavailable:${response.status}`);
  const rows = (await response.json().catch(() => null)) as GeographyRow[] | null;
  if (!Array.isArray(rows)) throw new Error("thai_address_source_invalid");
  writeAddressCache(rows);
  return rows;
}

export async function lookupThaiAddressByPostalCode(postalCodeInput: unknown): Promise<ThaiAddressOption[]> {
  const postalCode = normalizeDigits(postalCodeInput);
  if (!/^\d{5}$/.test(postalCode)) return [];
  const rows = await loadThaiGeography();
  const seen = new Set<string>();
  const options: ThaiAddressOption[] = [];
  for (const row of rows) {
    if (String(row.postalCode ?? "").padStart(5, "0") !== postalCode) continue;
    const subdistrict = String(row.subdistrictNameTh ?? "").trim();
    const district = String(row.districtNameTh ?? "").trim();
    const province = String(row.provinceNameTh ?? "").trim();
    if (!subdistrict || !district || !province) continue;
    const key = `${postalCode}|${subdistrict}|${district}|${province}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      postal_code: postalCode,
      subdistrict,
      district,
      province,
      subdistrict_code: String(row.subdistrictCode ?? ""),
      district_code: String(row.districtCode ?? ""),
      province_code: String(row.provinceCode ?? "")
    });
  }
  return options.sort((a, b) =>
    `${a.province}${a.district}${a.subdistrict}`.localeCompare(`${b.province}${b.district}${b.subdistrict}`, "th")
  );
}

export async function assertThaiAddressOption(input: {
  postal_code: unknown;
  subdistrict: unknown;
  district: unknown;
  province: unknown;
}) {
  const postalCode = normalizeDigits(input.postal_code);
  const subdistrict = String(input.subdistrict ?? "").trim();
  const district = String(input.district ?? "").trim();
  const province = String(input.province ?? "").trim();
  const options = await lookupThaiAddressByPostalCode(postalCode);
  const exact = options.find(
    (option) =>
      option.subdistrict === subdistrict && option.district === district && option.province === province
  );
  if (!exact) throw new Error("thai_address_selection_invalid");
  return exact;
}

export function readOrderTaxLines(metadata: unknown): TaxInvoiceTaxLine[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const source = (metadata as Record<string, unknown>).tax_lines;
  if (!Array.isArray(source)) return [];
  return source
    .map((entry): TaxInvoiceTaxLine | null => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const row = entry as Record<string, unknown>;
      const amount = Number(row.amount ?? 0);
      const rate = Number(row.rate_pct ?? 0);
      if (!Number.isFinite(amount)) return null;
      return {
        label: String(row.label ?? "ภาษี").trim() || "ภาษี",
        rate_pct: Number.isFinite(rate) ? rate : 0,
        mode: String(row.mode ?? "add_to_bill"),
        amount: Number(amount.toFixed(2))
      };
    })
    .filter((line): line is TaxInvoiceTaxLine => Boolean(line));
}

export function buildOrderTaxSnapshot(taxTotalInput: unknown, metadata: unknown): TaxInvoiceTaxSnapshot {
  const taxTotal = Number(Number(taxTotalInput ?? 0).toFixed(2));
  const lines = readOrderTaxLines(metadata);
  return {
    source: "order_snapshot",
    tax_total: Number.isFinite(taxTotal) ? taxTotal : 0,
    lines,
    warning:
      lines.length === 0 && Math.abs(Number.isFinite(taxTotal) ? taxTotal : 0) < 0.005
        ? "บิลนี้ไม่มีภาษีที่บันทึกไว้ ระบบจะไม่สมมติ VAT ย้อนหลัง"
        : null
  };
}

export function taxInvoiceNumber(orderNo: string) {
  const normalized = String(orderNo ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9ก-๙_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `TAX-${normalized || "BILL"}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value: unknown) {
  const number = Number(value ?? 0);
  return (Number.isFinite(number) ? number : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function entityTypeLabel(type: TaxEntityType) {
  if (type === "company") return "บริษัท";
  if (type === "limited_partnership") return "หจก.";
  if (type === "shop") return "ร้านค้า";
  return "บุคคลธรรมดา";
}

export function buildTaxInvoicePrintHtml(args: {
  invoiceNo: string;
  issuedAt: string;
  paperWidthMm: 58 | 80;
  seller: TaxSellerSnapshot;
  buyer: TaxBuyerSnapshot;
  order: TaxInvoiceOrderSnapshot;
  items: TaxInvoiceItemSnapshot[];
  tax: TaxInvoiceTaxSnapshot;
}) {
  const width = args.paperWidthMm === 80 ? 80 : 58;
  const printable = width === 80 ? 72 : 50;
  const fontSize = width === 80 ? 11.5 : 10.5;
  const itemRows = args.items
    .map(
      (item) => `<tr><td><b>${escapeHtml(item.name)}</b><div class="muted">${money(item.unit_price)} × ${escapeHtml(item.quantity)}</div></td><td class="right">${money(item.line_total)}</td></tr>`
    )
    .join("");
  const taxRows = args.tax.lines.length
    ? args.tax.lines
        .map(
          (line) => `<div class="sum muted"><span>${escapeHtml(line.label)}${line.rate_pct > 0 ? ` ${money(line.rate_pct)}%` : ""}</span><b>${line.amount < 0 ? "-" : ""}฿${money(Math.abs(line.amount))}</b></div>`
        )
        .join("")
    : `<div class="sum muted"><span>VAT / ภาษี</span><b>฿${money(args.tax.tax_total)}</b></div>`;
  const buyerAddress = `${args.buyer.address_line} ${args.buyer.subdistrict} ${args.buyer.district} ${args.buyer.province} ${args.buyer.postal_code}`;
  const issuedDate = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(args.issuedAt));
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(args.invoiceNo)}</title><style>
@page{size:${width}mm auto;margin:0}html,body{margin:0;padding:0;width:${width}mm;background:#fff;color:#000;font-family:"Noto Sans Thai",Tahoma,"Segoe UI",sans-serif}.doc{width:${printable}mm;margin:0 auto;padding:2mm 0 3mm;font-size:${fontSize}px;line-height:1.32}.center{text-align:center}.right{text-align:right}.title{font-size:${width === 80 ? 18 : 16}px;font-weight:900}.bold{font-weight:900}.muted{color:#222}.line{border-top:1px dashed #000;margin:1.7mm 0}.meta{display:flex;justify-content:space-between;gap:2mm}.box{border:1px solid #000;border-radius:1mm;padding:1.5mm;margin:1.5mm 0}.box div{margin:.5mm 0}table{width:100%;border-collapse:collapse}td{padding:1mm 0;vertical-align:top;border-bottom:1px dotted #aaa}.sum{display:flex;justify-content:space-between;gap:2mm;margin:.8mm 0}.grand{font-size:${width === 80 ? 15 : 13}px}.warning{border:1px solid #000;padding:1mm;margin-top:1mm;font-weight:700}</style></head><body><main class="doc">
<div class="center title">ใบกำกับภาษี</div><div class="center bold">TAX INVOICE</div><div class="center">เลขที่ ${escapeHtml(args.invoiceNo)}</div>
<div class="line"></div><div class="center bold">${escapeHtml(args.seller.display_name)}</div><div class="center">เลขผู้เสียภาษี ${escapeHtml(args.seller.tax_id)}</div>${args.seller.branch_no ? `<div class="center">สาขา ${escapeHtml(args.seller.branch_no)}</div>` : ""}<div class="center">${escapeHtml(args.seller.address)}</div>${args.seller.phone ? `<div class="center">โทร. ${escapeHtml(args.seller.phone)}</div>` : ""}
<div class="line"></div><div class="box"><div class="bold">ผู้ซื้อ / ผู้รับใบกำกับภาษี</div><div>${escapeHtml(entityTypeLabel(args.buyer.entity_type))}: <b>${escapeHtml(args.buyer.display_name)}</b></div><div>เลขผู้เสียภาษี: ${escapeHtml(args.buyer.tax_id)}</div><div>${escapeHtml(buyerAddress)}</div></div>
<div class="meta"><span>เลขที่บิล</span><b>${escapeHtml(args.order.order_no)}</b></div><div class="meta"><span>วันที่ออก</span><b>${escapeHtml(issuedDate)}</b></div><div class="line"></div>
<table>${itemRows || `<tr><td>ไม่มีรายการสินค้า</td><td class="right">0.00</td></tr>`}</table>
<div class="line"></div><div class="sum"><span>ยอดสินค้า</span><b>฿${money(args.order.subtotal)}</b></div><div class="sum"><span>ส่วนลด</span><b>-฿${money(args.order.discount_amount)}</b></div>${taxRows}<div class="sum grand"><span class="bold">ยอดสุทธิ</span><b>฿${money(args.order.grand_total)}</b></div><div class="sum"><span>ชำระแล้ว</span><b>฿${money(args.order.paid_total)}</b></div>
${args.tax.warning ? `<div class="warning">${escapeHtml(args.tax.warning)}</div>` : ""}<div class="line"></div><div class="center muted">เอกสารอ้างอิงจากข้อมูลบิลที่บันทึกใน CpIPOS</div></main></body></html>`;
}
