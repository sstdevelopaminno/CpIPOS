import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

it("keeps bundle popup production activation independent of initial route", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/components/pos-preview/stock-bundle-popup-enhancer.tsx"), "utf8");
  expect(source).toContain('if (typeof window === "undefined") return;');
  expect(source).not.toContain('!window.location.pathname.includes("/preview/pos/stock")');
});
