import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Support chat stale conversation recovery", () => {
  const chat = src("src/components/pos-preview/pos-support-chat.tsx");
  const vercel = JSON.parse(src("vercel.json"));

  it("treats a deleted conversation as stale UI state instead of a service outage", () => {
    expect(chat).toContain("response.status === 404");
    expect(chat).toContain("clearGoneConversation(id)");
    expect(chat).toContain("clearGoneConversation(selectedId)");
    expect(chat).toContain('setError("")');
  });

  it("keeps Vercel Git deployment production-only", () => {
    expect(vercel.git?.deploymentEnabled?.["*"]).toBe(false);
    expect(vercel.git?.deploymentEnabled?.["agent-docs-preflight-schema-drift"]).toBe(true);
  });
});
