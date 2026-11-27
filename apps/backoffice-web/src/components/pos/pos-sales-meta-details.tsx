"use client";

import { PosRealtimeClock } from "@/components/pos/pos-realtime-clock";

/**
 * Canonical CpiPOS sales header used for standard packages and CUSTOM
 * modes (ordinary retail, optical and recycling).
 * Mode-specific cashier rules never change the surrounding UI structure.
 */
export type PosSalesMetaLabels = {
  seller: string;
  shift: string;
  branch: string;
  date: string;
  time: string;
  device: string;
};

export const THAI_POS_SALES_META_LABELS: PosSalesMetaLabels = {
  seller: "ชื่อผู้ขาย",
  shift: "กะ",
  branch: "สาขา",
  date: "วันที่",
  time: "เวลา",
  device: "รหัสเครื่องแคชเชียร์"
};

export function PosSalesMetaDetails({
  sellerName, shiftStatus, branchName, deviceCode, labels, language = "th", fixedDocumentTime
}: {
  sellerName: string;
  shiftStatus: string;
  branchName: string;
  deviceCode: string | null;
  labels: PosSalesMetaLabels;
  language?: "th" | "en";
  fixedDocumentTime?: string | null;
}) {
  return <div className="posui-sales-meta-columns" data-testid="shared-pos-sales-metadata">
    <dl className="posui-sales-meta-list posui-sales-meta-list--left">
      <div className="posui-sales-meta-row"><dt>{labels.seller}</dt><dd>{sellerName}</dd></div>
      <div className="posui-sales-meta-row"><dt>{labels.shift}</dt><dd>{shiftStatus}</dd></div>
      <div className="posui-sales-meta-row"><dt>{labels.branch}</dt><dd>{branchName}</dd></div>
    </dl>
    <dl className="posui-sales-meta-list posui-sales-meta-list--right">
      <PosRealtimeClock lang={language} dateLabel={labels.date} timeLabel={labels.time} fixedDocumentTime={fixedDocumentTime} />
      <div className="posui-sales-meta-row"><dt>{labels.device}</dt><dd>{deviceCode || "—"}</dd></div>
    </dl>
  </div>;
}
