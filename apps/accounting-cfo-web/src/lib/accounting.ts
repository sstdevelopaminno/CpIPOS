import "server-only";

import { getSheetValues } from "@/lib/google";
import { extractDriveFileIds } from "@/lib/files";

export class DataSourceNotConfiguredError extends Error {
  constructor() {
    super("Accounting Google Sheets data source is not configured.");
  }
}

type RowObject = Record<string, string>;

function accountingSourceId() {
  const value = process.env.ACCOUNTING_SPREADSHEET_ID?.trim();
  if (!value) throw new DataSourceNotConfiguredError();
  return value;
}

function salesSourceId() {
  const value = process.env.SALES_DOCUMENT_SPREADSHEET_ID?.trim();
  if (!value) throw new DataSourceNotConfiguredError();
  return value;
}

function rowsToObjects(rows: string[][]): RowObject[] {
  const [header = [], ...data] = rows;
  return data
    .filter((row) => row.some((value) => value.trim() !== ""))
    .map((row) =>
      Object.fromEntries(header.map((key, index) => [key.trim() || `COL_${index + 1}`, row[index] ?? ""]))
    );
}

function pick(row: RowObject, names: string[]) {
  for (const name of names) {
    if (row[name]) return row[name];
  }
  return "";
}

export async function getDashboard() {
  const accounting = accountingSourceId();
  const rows = await getSheetValues(accounting, "'CFO Dashboard'!A3:D50");
  return rows.slice(1).filter((row) => row[0]).map((row) => ({
    label: row[0] ?? "",
    value: row[1] ?? "",
    status: row[2] ?? "",
    note: row[3] ?? ""
  }));
}

export async function getTransactions(kind: "income" | "expense") {
  const accounting = accountingSourceId();
  const tab = kind === "income" ? "รายรับ" : "รายจ่าย";
  const rows = rowsToObjects(await getSheetValues(accounting, `'${tab}'!A3:Z250`));

  return rows.map((row) => ({
    date: pick(row, ["วันที่เอกสาร"]),
    type: pick(row, ["ประเภท"]),
    category: pick(row, ["หมวดหมู่"]),
    description: pick(row, ["รายการ"]),
    counterparty: pick(row, ["ลูกค้า", "ผู้ขาย/ผู้รับเงิน"]),
    documentNo: pick(row, ["เลขที่เอกสาร"]),
    total: pick(row, ["ยอดรวมสุทธิ"]),
    documentType: pick(row, ["ประเภทเอกสาร"]),
    taxStatus: pick(row, ["สถานะ VAT"]),
    paymentStatus: pick(row, ["สถานะการจ่ายจากเดินบัญชี"]),
    evidence: pick(row, ["ไฟล์หลักฐาน"]),
    evidenceIds: extractDriveFileIds(pick(row, ["ไฟล์หลักฐาน", "หมายเหตุ/จุดตรวจสอบ", "หมายเหตุ"]))
  })).reverse();
}

export async function getSalesDocuments() {
  const sales = salesSourceId();
  const rows = rowsToObjects(await getSheetValues(sales, "'รายการเอกสาร'!A3:AF250"));

  return rows.map((row) => ({
    documentNo: pick(row, ["เลขที่เอกสาร"]),
    date: pick(row, ["วันที่เอกสาร"]),
    type: pick(row, ["ประเภทเอกสาร"]),
    customer: pick(row, ["ลูกค้า"]),
    subject: pick(row, ["เรื่อง/รายการหลัก"]),
    status: pick(row, ["สถานะเอกสาร"]),
    paymentStatus: pick(row, ["สถานะรับเงิน"]),
    total: pick(row, ["ยอดรวมรวม VAT"]),
    accountingStatus: pick(row, ["สถานะเข้าบัญชี"]),
    fileCell: pick(row, ["ไฟล์เอกสาร/หลักฐาน"]),
    fileIds: [
      ...new Set([
        ...extractDriveFileIds(pick(row, ["ไฟล์เอกสาร/หลักฐาน"])),
        ...(pick(row, ["File ID"]) ? [pick(row, ["File ID"])] : [])
      ])
    ]
  })).reverse();
}

export async function getBankReport() {
  const accounting = accountingSourceId();
  const recon = rowsToObjects(await getSheetValues(accounting, "'กระทบยอดธนาคาร'!A3:L120"));
  const bank = rowsToObjects(await getSheetValues(accounting, "'เดินบัญชีธนาคาร'!A3:Z160"));
  return { recon, bank: bank.reverse() };
}

export async function getManagementReports() {
  const accounting = accountingSourceId();
  const [profitLoss, balanceSheet, cashFlow, monthly] = await Promise.all([
    getSheetValues(accounting, "'งบกำไรขาดทุนบริหาร'!A3:H80"),
    getSheetValues(accounting, "'งบดุลบริหาร'!A3:H80"),
    getSheetValues(accounting, "'Cash Flow CFO'!A3:L140"),
    getSheetValues(accounting, "'สรุปรายเดือน'!A3:J40")
  ]);

  return { profitLoss, balanceSheet, cashFlow, monthly };
}

export async function getMarketingView() {
  const accounting = accountingSourceId();
  const [income, commission] = await Promise.all([
    getTransactions("income"),
    getSheetValues(accounting, "'ค่าคอมมิชันขาย'!A3:Q160")
  ]);

  return { income, commission };
}
