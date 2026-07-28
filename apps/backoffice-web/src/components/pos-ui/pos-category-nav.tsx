"use client";

import { useRef } from "react";

type CategoryItem = {
  id: string;
  label: string;
};

type Props = {
  items: CategoryItem[];
  activeId: string;
  onSelect: (id: string) => void;
  ariaLabel?: string;
  trailingActionLabel?: string;
  onTrailingAction?: () => void;
};

export function PosCategoryNav({
  items,
  activeId,
  onSelect,
  ariaLabel = "Product categories",
  trailingActionLabel,
  onTrailingAction
}: Props) {
  const dragStateRef = useRef<{ pointerId: number; startX: number; scrollLeft: number } | null>(null);
  const didDragRef = useRef(false);

  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.currentTarget;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: target.scrollLeft
    };
    didDragRef.current = false;
    target.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    if (Math.abs(deltaX) > 4) {
      didDragRef.current = true;
      event.currentTarget.scrollLeft = dragState.scrollLeft - deltaX;
    }
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      window.setTimeout(() => {
        didDragRef.current = false;
      }, 0);
    }
  }

  return (
    <div className="posui-category-row">
      <nav
        className="posui-category-nav"
        aria-label={ariaLabel}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={(event) => {
              if (didDragRef.current) {
                event.preventDefault();
                return;
              }
              onSelect(item.id);
            }}
            className={`posui-chip posui-chip--category ${activeId === item.id ? "is-active" : ""}`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {trailingActionLabel ? (
        <button type="button" className="posui-chip posui-chip--manage" onClick={onTrailingAction}>
          {trailingActionLabel}
        </button>
      ) : null}
    </div>
  );
}
