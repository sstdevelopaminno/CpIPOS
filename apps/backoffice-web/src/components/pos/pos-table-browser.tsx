"use client";

import { memo } from "react";
import { FloorPlanCanvas } from "@/components/tables/floor-plan-canvas";
import { FloorPlanToolbar } from "@/components/tables/floor-plan-toolbar";
import { getTableStatusLabel } from "@/components/tables/table-i18n";
import { TableZoneTabs } from "@/components/tables/table-zone-tabs";
import type { DiningTableItem, TableZoneItem } from "@/components/tables/types";
import { tableStatusColorMap } from "@/lib/table-management";

type Lang = "th" | "en";
type TableViewMode = "list" | "floor";

type PosTableBrowserText = {
  tableSelectTitle: string;
  requestTimeout: string;
  tableLoading: string;
  tableEmpty: string;
  retryLoad: string;
  tableListMode: string;
  tableListModeSub: string;
  tableFloorMode: string;
  tableFloorModeSub: string;
  tableActionSelect: string;
  tableActionOpenBill: string;
};

type Props = {
  lang: Lang;
  text: PosTableBrowserText;
  tableLoadError: string | null;
  tableLoading: boolean;
  visibleTables: DiningTableItem[];
  tableViewMode: TableViewMode;
  setTableViewMode: (value: TableViewMode) => void;
  tableZones: TableZoneItem[];
  tableZoneFilter: string;
  setTableZoneFilter: (value: string) => void;
  selectedTableId: string | null;
  isBusy: boolean;
  tableSwitching: boolean;
  tableZoom: number;
  setTableZoom: (updater: (current: number) => number) => void;
  tablePan: { x: number; y: number };
  setTablePan: (value: { x: number; y: number }) => void;
  hideControls?: boolean;
  onRetryLoad: () => void;
  onTablePrefetch: (table: DiningTableItem) => void;
  onSelectTable: (table: DiningTableItem) => void;
};

function PosTableBrowserInner({
  lang,
  text,
  tableLoadError,
  tableLoading,
  visibleTables,
  tableViewMode,
  setTableViewMode,
  tableZones,
  tableZoneFilter,
  setTableZoneFilter,
  selectedTableId,
  isBusy,
  tableSwitching,
  tableZoom,
  setTableZoom,
  tablePan,
  setTablePan,
  hideControls = false,
  onRetryLoad,
  onTablePrefetch,
  onSelectTable
}: Props) {
  const tableEmptyMessage = tableLoadError?.includes("Request timeout") ? text.requestTimeout : tableLoadError;
  const showTableLoading = tableLoading && visibleTables.length === 0;
  const showTableLoadError = !showTableLoading && Boolean(tableEmptyMessage);

  const renderTableEmptyState = () => (
    <div className={`posui-table-empty-state ${showTableLoadError ? "is-error" : ""}`} role="listitem" aria-live="polite">
      <p>{showTableLoading ? text.tableLoading : showTableLoadError ? tableEmptyMessage : text.tableEmpty}</p>
      {!showTableLoading ? (
        <button type="button" className="posui-btn posui-btn--ghost" onClick={onRetryLoad}>
          {text.retryLoad}
        </button>
      ) : null}
    </div>
  );

  return (
    <section className="posui-table-browser" aria-label={text.tableSelectTitle}>
      {tableViewMode === "list" ? (
        <>
          {!hideControls ? (
            <div className="posui-table-browser__controls-card">
              <div className="posui-table-browser__controls-row">
                <div className="posui-table-browser__view-switch" role="tablist" aria-label={text.tableSelectTitle}>
                  <button
                    type="button"
                    role="tab"
                    className={`posui-chip posui-chip--dine-view ${lang === "th" ? "is-th" : ""} is-active`}
                    onClick={() => setTableViewMode("list")}
                  >
                    <span>{text.tableListMode}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={`posui-chip posui-chip--dine-view ${lang === "th" ? "is-th" : ""}`}
                    onClick={() => setTableViewMode("floor")}
                  >
                    <span>{text.tableFloorMode}</span>
                  </button>
                </div>
                <div className="posui-table-browser__zones-inline">
                  <TableZoneTabs zones={tableZones} activeZoneId={tableZoneFilter} onChange={setTableZoneFilter} lang={lang} />
                </div>
              </div>
            </div>
          ) : null}
          <div className="posui-table-strip" role="list">
            {visibleTables.length === 0 ? (
              renderTableEmptyState()
            ) : (
              visibleTables.map((table) => {
                const color = tableStatusColorMap[table.status] ?? "#94a3b8";
                const hasBill = Boolean(table.active_session_id);
                const selectable = table.status !== "disabled" && table.status !== "reserved";
                return (
                  <button
                    key={table.id}
                    type="button"
                    role="listitem"
                    className={`posui-table-chip ${selectedTableId === table.id ? "is-selected" : ""}`}
                    style={{ borderColor: color }}
                    disabled={isBusy || tableSwitching || !selectable}
                    onPointerEnter={() => onTablePrefetch(table)}
                    onClick={() => onSelectTable(table)}
                  >
                    <strong>{table.table_code}</strong>
                    <span>{getTableStatusLabel(lang, table.status)}</span>
                    <small>{hasBill ? text.tableActionSelect : text.tableActionOpenBill}</small>
                  </button>
                );
              })
            )}
          </div>
        </>
      ) : (
        <>
          {!hideControls ? (
            <div className="posui-table-browser__controls-card">
              <div className="posui-table-browser__controls-row">
                <div className="posui-table-browser__view-switch" role="tablist" aria-label={text.tableSelectTitle}>
                  <button
                    type="button"
                    role="tab"
                    className={`posui-chip posui-chip--dine-view ${lang === "th" ? "is-th" : ""}`}
                    onClick={() => setTableViewMode("list")}
                  >
                    <span>{text.tableListMode}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={`posui-chip posui-chip--dine-view ${lang === "th" ? "is-th" : ""} is-active`}
                    onClick={() => setTableViewMode("floor")}
                  >
                    <span>{text.tableFloorMode}</span>
                  </button>
                </div>
                <div className="posui-table-browser__zones-inline">
                  <TableZoneTabs zones={tableZones} activeZoneId={tableZoneFilter} onChange={setTableZoneFilter} lang={lang} />
                </div>
              </div>
            </div>
          ) : null}
          <div className="posui-table-floor-wrap">
            {visibleTables.length === 0 ? renderTableEmptyState() : null}
            <FloorPlanToolbar
              zoom={tableZoom}
              lang={lang}
              onZoomIn={() => setTableZoom((value) => Math.min(2.4, value + 0.1))}
              onZoomOut={() => setTableZoom((value) => Math.max(0.4, value - 0.1))}
              onResetViewport={() => {
                setTableZoom(() => 1);
                setTablePan({ x: 0, y: 0 });
              }}
            />
            <FloorPlanCanvas
              tables={visibleTables}
              zones={tableZones}
              lang={lang}
              selectedTableId={selectedTableId}
              editable={false}
              zoom={tableZoom}
              pan={tablePan}
              onPanChange={setTablePan}
              onTablePrefetch={onTablePrefetch}
              onSelect={onSelectTable}
            />
          </div>
        </>
      )}
    </section>
  );
}

export const PosTableBrowser = memo(PosTableBrowserInner);
