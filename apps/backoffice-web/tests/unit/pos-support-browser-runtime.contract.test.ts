import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const browserClient = source("../../src/lib/supabase-browser.ts");
const supportChat = source("../../src/components/pos-preview/pos-support-chat.tsx");

describe("POS Support browser runtime", () => {
  it("uses static NEXT_PUBLIC env references so Next.js can inline them", () => {
    expect(browserClient).toContain("process.env.NEXT_PUBLIC_SUPABASE_URL");
    expect(browserClient).toContain("process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(browserClient).not.toContain('readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"');
  });

  it("does not crash the whole Support page when Realtime cannot initialize", () => {
    expect(supportChat).toContain("try {");
    expect(supportChat).toContain("getSupabaseBrowserClient()");
    expect(supportChat).toContain("โหมดเรียลไทม์ยังไม่พร้อม");
    expect(supportChat).toContain("typingChannelRef.current = null");
  });
});
