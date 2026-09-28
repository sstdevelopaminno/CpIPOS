import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const chat = readFileSync(resolve(process.cwd(),"src/components/pos-preview/pos-support-chat.tsx"),"utf8");

describe("POS support close synchronization",()=>{
  it("closes the composer immediately and resets to a new-chat state after IT closes",()=>{
    expect(chat).toContain('event: "conversation_closing"');
    expect(chat).toContain('event: "conversation_closed"');
    expect(chat).toContain('event: "conversation_close_cancelled"');
    expect(chat).toContain("setClosingByIT(true)");
    expect(chat).toContain("resetClosedConversation(selectedId)");
    expect(chat).toContain('next.status === "closed"');
  });

  it("recovers if a send races with a server-side close",()=>{
    expect(chat).toContain('response.status === 409 && json?.error?.code === "conversation_closed"');
    expect(chat).toContain("if (!selectedId || closingByIT");
  });
});
