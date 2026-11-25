import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Finance sidebar scrollbar", () => {
  it("hides the scrollbar without disabling sidebar scrolling or changing the main pane", () => {
    const shell = readFileSync(resolve(process.cwd(), "src/app/finance/finance-accountant-shell.tsx"), "utf8");
    expect(shell).toContain('className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"');
    expect(shell).toContain('<main className="min-w-0 flex-1 overflow-y-auto');
    expect(shell).toContain("<FinanceLogout collapsed={collapsed} />");
  });
});
