import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("POS user news and contract branch quota", () => {
  it("has private, server-only publishing and per-user read tables", () => {
    const sql = source("../../supabase/migrations/20261108003500_platform_news_posts_user_reads_storage.sql");
    expect(sql).toContain("platform_news_posts");
    expect(sql).toContain("platform_news_reads");
    expect(sql).toContain("PRIMARY KEY(news_id,tenant_id,user_id)");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL");
  });

  it("lists only published, targeted news and joins reads for this POS session user", () => {
    const list = source("src/app/api/pos/news/route.ts");
    const item = source("src/app/api/pos/news/[newsId]/route.ts");
    expect(list).toContain("requirePosSession()");
    expect(list).toContain('.eq("status", "published")');
    expect(list).toContain('"target_tenant_id.is.null,target_tenant_id.eq." + session.tenant_id');
    expect(list).toContain('.eq("user_id", session.user_id)');
    expect(item).toContain(".eq(\"user_id\", session.user_id)");
    expect(item).toContain('ignoreDuplicates: true');
    expect(item).toContain("scopedNews(newsId, session.tenant_id)");
    expect(item).not.toContain('user_id: body.');
  });

  it("places the news bell in the main menu and AI inside More, not in main", () => {
    const staff = source("src/components/pos-preview/pos-staff-menu.tsx");
    const more = source("src/components/pos-preview/pos-more-workspace.tsx");
    expect(staff).toContain('href="/preview/pos/news"');
    expect(staff).toContain('"cpi-news-read"');
    expect(staff).toContain("unreadNewsCount");
    expect(staff).not.toContain('href="/preview/pos/ai-assistant"');
    expect(more).toContain('href: "/preview/pos/ai-assistant"');
  });

  it("renders latest amber, unread green and read grey with click-to-read details", () => {
    const ui = source("src/components/pos-preview/pos-news-workspace.tsx");
    expect(ui).toContain("tone={item.is_read ? \"read\" : item.is_latest ? \"latest\" : \"unread\"}");
    expect(ui).toContain("text-amber-500");
    expect(ui).toContain("text-emerald-600");
    expect(ui).toContain("text-slate-400");
    expect(ui).toContain('method: "POST"');
  });

  it("keeps the server's contract quota authoritative and disables the add button on the client", () => {
    const service = source("src/lib/services/pos-settings-service.ts");
    const ui = source("src/components/pos-preview/pos-settings-workspace.tsx");
    const gate = source("src/lib/feature-gate.ts");
    expect(service).toContain('await enforceQuota(auth.tenantId, "branches")');
    expect(service).toContain("branch_quota:");
    expect(ui).toContain('quotaLoading || quotaFull');
    expect(ui).toContain('disabled={!canManage || isBusy || quotaLoading || quotaFull}');
    expect(gate).toContain('quota_blocked');
    expect(gate).toContain('resourceType === "branches" && !limits.contractId');
  });
});
