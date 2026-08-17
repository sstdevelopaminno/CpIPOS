import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/components/pos/pos-shift-cycle-guard-core.tsx"), "utf8");

describe("shift cycle guard Android viewport contract", () => {
  it("centers both shift dialogs inside the visual viewport layer", () => {
    expect(source).toContain("window.visualViewport");
    expect(source).toContain("grid place-items-center overflow-y-auto");
    expect(source).toContain("style={visualViewportStyle}");
    expect(source).not.toContain('section className="fixed left-1/2 top-1/2');
  });

  it("tracks viewport resize, scroll and orientation changes", () => {
    expect(source).toContain('viewport?.addEventListener("resize", updateViewportFrame)');
    expect(source).toContain('viewport?.addEventListener("scroll", updateViewportFrame)');
    expect(source).toContain('window.addEventListener("orientationchange", updateViewportFrame)');
  });
});
