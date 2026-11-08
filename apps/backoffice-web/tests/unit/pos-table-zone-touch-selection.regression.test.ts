import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldCaptureTableZoneBackgroundDrag } from "../../src/lib/table-zone-pointer";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("table zone touch/click safety across POS Web, Windows WebView2 and Android WebView", () => {
  it.each([
    ["touch", 0, false],
    ["touch", 0, true],
    ["pen", 0, false],
    ["pen", 0, true],
    ["mouse", 0, false],
    ["mouse", 0, true],
    ["mouse", 2, true]
  ] as const)("captures only mouse left-button drags on blank background: %s %i %s", (pointerType, button, targetIsContainer) => {
    const expected = pointerType === "mouse" && button === 0 && targetIsContainer;
    expect(shouldCaptureTableZoneBackgroundDrag({ pointerType, button, targetIsContainer })).toBe(expected);
  });

  it("allows every zone tab to receive a normal click, with selection reflected for accessibility", () => {
    const tabs = source("src/components/tables/table-zone-tabs.tsx");
    const css = source("src/app/globals.css");
    expect(tabs).toContain("shouldCaptureTableZoneBackgroundDrag({");
    expect(tabs).toContain("targetIsContainer: event.target === event.currentTarget");
    expect(tabs).toContain('onClick={() => onChange("all")}');
    expect(tabs).toContain("onClick={() => onChange(zone.id)}");
    expect(tabs).toContain("aria-selected={activeZoneId === zone.id}");
    expect(tabs).not.toContain("didDragRef");
    expect(css).toContain("touch-action: pan-x");
    expect(css).toContain("overflow-x: auto");
  });

  it("keeps table list and floor-plan selectors wired to the same current sales session", () => {
    const tableBrowser = source("src/components/pos/pos-table-browser.tsx");
    const floor = source("src/components/tables/floor-plan-canvas.tsx");
    const page = source("src/components/pos/pos-sales-module.tsx");
    expect(tableBrowser).toContain("const selectRef = useRef(onSelectTable)");
    expect(tableBrowser).toContain("selectRef.current = onSelectTable");
    expect(tableBrowser).toContain("const selectCurrentTable = useCallback");
    expect(tableBrowser).toContain("selectRef.current(table)");
    expect(tableBrowser).toContain("onSelect={selectCurrentTable}");
    expect(tableBrowser).toContain("onTablePrefetch={prefetchCurrentTable}");
    expect(floor).toContain("<DraggableTableNode");
    expect(floor).toContain("onSelect={onSelect}");
    expect(page).toContain("void selectTableFromBrowser(table)");
    expect(page).toContain("await openBillForTable(table)");
  });

  it("does not allow tapping a blank floor canvas to steal an actual table button pointer", () => {
    const floor = source("src/components/tables/floor-plan-canvas.tsx");
    const node = source("src/components/tables/draggable-table-node.tsx");
    expect(floor).toContain('closest(".floor-node, .floor-object-node")');
    expect(node).toContain("if (!editable) return;");
    expect(node).toContain("onClick={() => onSelect?.(table)}");
    expect(node).toContain("onPointerDown={startDrag}");
  });
});
