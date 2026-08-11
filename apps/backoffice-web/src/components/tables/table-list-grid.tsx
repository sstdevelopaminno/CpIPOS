"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TableBulkCreateButton } from "@/components/tables/table-bulk-create-button";
import type { DiningTableItem, TableZoneItem } from "@/components/tables/types";
import type { Language } from "@/lib/i18n";
import { getTableStatusLabel, getTableUiText } from "@/components/tables/table-i18n";
import { naturalCompareTableCode } from "@/lib/table-management";

type Props = {
  tables: DiningTableItem[];
  zones: TableZoneItem[];
  selectedTableId?: string | null;
  onSelect?: (table: DiningTableItem) => void;
  onEdit?: (table: DiningTableItem) => void;
  onDelete?: (table: DiningTableItem) => void;
  readOnly?: boolean;
  sortMode?: "natural" | "capacity_desc" | "status";
  lang?: Language;
};

const PAGE_SIZE = 10;

export function TableListGrid({
  tables,
  zones,
  selectedTableId,
  onSelect,
  onEdit,
  onDelete,
  readOnly = false,
  sortMode = "natural",
  lang = "en"
}: Props) {
  const text = getTableUiText(lang);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const sortedRows = useMemo(() => {
    const rows = [...tables];
    rows.sort((a, b) => {
      if (sortMode === "capacity_desc") {
        return b.capacity - a.capacity || naturalCompareTableCode(a.table_code, b.table_code);
      }
      if (sortMode === "status") {
        return a.status.localeCompare(b.status) || naturalCompareTableCode(a.table_code, b.table_code);
      }
      return naturalCompareTableCode(a.table_code, b.table_code);
    });
    return rows;
  }, [sortMode, tables]);

  const zoneMap = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);
  const branchIds = useMemo(
    () => Array.from(new Set(tables.map((table) => String(table.branch_id ?? "").trim()).filter(Boolean))),
    [tables]
  );
  const defaultBranchId = branchIds.length === 1 ? branchIds[0] : null;

  const totalItems = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage(1);
    bodyRef.current?.scrollTo({ top: 0 });
  }, [sortMode, tables]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [currentPage, sortedRows]);

  const rangeStart = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = totalItems === 0 ? 0 : Math.min(currentPage * PAGE_SIZE, totalItems);
  const previousLabel = lang === "th" ? "ก่อนหน้า" : "Previous";
  const nextLabel = lang === "th" ? "ถัดไป" : "Next";
  const pageLabel = lang === "th" ? "หน้า" : "Page";
  const tableCountLabel = lang === "th" ? "โต๊ะ" : "tables";

  function goToPage(nextPage: number) {
    const clamped = Math.min(totalPages, Math.max(1, nextPage));
    setCurrentPage(clamped);
    window.requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  }

  return (
    <>
      <style>{`
        .table-mgmt-page.surface {
          border: 0 !important;
          border-radius: 0 !important;
          padding: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
        }
        .table-mgmt-layout.is-list-view .table-mgmt-center {
          border: 1px solid #dbe3ef !important;
          border-radius: 12px !important;
          padding: 0 !important;
          overflow: hidden !important;
          box-shadow: none !important;
          background: #ffffff !important;
        }
        .table-mgmt-layout.is-list-view .table-mgmt-list-controls {
          margin: 0 !important;
          padding: 10px !important;
          border: 0 !important;
          border-bottom: 1px solid #e2e8f0 !important;
          border-radius: 0 !important;
          background: #ffffff !important;
        }
        .table-mgmt-layout.is-list-view .table-list-sheet {
          margin: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          background: #ffffff !important;
          overflow: hidden !important;
        }
      `}</style>

      <div className="table-list-sheet">
        {!readOnly ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderBottom: "1px solid #e2e8f0",
              background: "#f8fafc"
            }}
          >
            <TableBulkCreateButton lang={lang} defaultBranchId={defaultBranchId} />
          </div>
        ) : null}

        <header className="table-list-sheet__head">
          <span>{text.tableCode}</span>
          <span>{text.tableName}</span>
          <span>{text.status}</span>
          <span>{text.seats}</span>
          <span>{text.zone}</span>
          <span>Actions</span>
        </header>
        <div
          ref={bodyRef}
          className="table-list-sheet__body"
          style={{ maxHeight: "min(48vh, 520px)", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}
        >
          {paginatedRows.map((table) => {
            const zoneName = table.zone_id ? zoneMap.get(table.zone_id)?.zone_name ?? text.unassigned : text.unassigned;
            return (
              <article key={table.id} className={`table-list-row ${selectedTableId === table.id ? "is-selected" : ""}`}>
                <button type="button" className="table-list-row__cell table-list-row__cell--code" onClick={() => onSelect?.(table)}>
                  <i aria-hidden>{table.shape === "circle" ? "O" : table.shape === "square" ? "S" : "R"}</i>
                  <strong>{table.table_code}</strong>
                </button>
                <button type="button" className="table-list-row__cell" onClick={() => onSelect?.(table)}>
                  {table.table_name?.trim() || "-"}
                </button>
                <span className={`table-list-status status-${table.status}`}>{getTableStatusLabel(lang, table.status)}</span>
                <span className="table-list-row__cell">{table.capacity}</span>
                <span className="table-list-row__cell">{zoneName}</span>
                <div className="table-list-row__actions">
                  {readOnly ? (
                    <button type="button" onClick={() => onSelect?.(table)}>
                      {text.selectTable}
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => onEdit?.(table)}>
                        {text.edit}
                      </button>
                      <button type="button" className="is-danger" onClick={() => onDelete?.(table)}>
                        {text.delete}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <footer className="table-list-sheet__foot" style={{ gap: 10, flexWrap: "wrap" }}>
          <span>{`${rangeStart} - ${rangeEnd} / ${totalItems} ${tableCountLabel}`}</span>
          <div className="table-list-sheet__pagination" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
              {previousLabel}
            </button>
            <strong style={{ minWidth: 72, textAlign: "center", fontSize: 12, color: "#475569" }}>
              {`${pageLabel} ${currentPage} / ${totalPages}`}
            </strong>
            <button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>
              {nextLabel}
            </button>
          </div>
        </footer>
      </div>
    </>
  );
}
