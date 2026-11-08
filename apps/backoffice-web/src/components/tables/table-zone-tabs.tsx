"use client";

import { useRef, type PointerEvent } from "react";
import type { TableZoneItem } from "@/components/tables/types";
import type { Language } from "@/lib/i18n";
import { getTableUiText } from "@/components/tables/table-i18n";

type Props = {
  zones: TableZoneItem[];
  activeZoneId: string;
  onChange: (zoneId: string) => void;
  includeAll?: boolean;
  lang?: Language;
};

export function TableZoneTabs({ zones, activeZoneId, onChange, includeAll = true, lang = "en" }: Props) {
  const text = getTableUiText(lang);
  const dragStateRef = useRef<{ pointerId: number; startX: number; scrollLeft: number } | null>(null);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    // The scroll container used to capture every pointer-down, including
    // touches on its child <button>s. WebView2/Android then retargeted the
    // synthesized click to the container, so zone tabs never changed.
    // Touch/pen scrolling already works natively via overflow-x and pan-x.
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    if (Math.abs(deltaX) > 4) {
      event.currentTarget.scrollLeft = dragState.scrollLeft - deltaX;
    }
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      className="table-zone-tabs"
      role="tablist"
      aria-label={`${text.zone} tabs`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
     >
      {includeAll ? (
        <button
          type="button"
          role="tab"
          className={activeZoneId === "all" ? "is-active" : ""}
          aria-selected={activeZoneId === "all"}
          onClick={() => onChange("all")}
        >
          {text.all}
        </button>
      ) : null}
      {zones.map((zone) => (
        <button
          key={zone.id}
          type="button"
          role="tab"
          className={activeZoneId === zone.id ? "is-active" : ""}
          aria-selected={activeZoneId === zone.id}
          onClick={() => onChange(zone.id)}
          style={{
            borderColor: zone.color
          }}
        >
          {zone.zone_name}
        </button>
      ))}
    </div>
  );
}
