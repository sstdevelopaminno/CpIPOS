import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("CpiPOS AI workspace and document vault", () => {
  const ui = src("src/components/pos-preview/cpipos-ai-assistant.tsx");
  const aiApi = src("src/app/api/pos/ai/assistant/route.ts");
  const documentService = src("src/lib/services/ai-document-vault-service.ts");
  const documentsApi = src("src/app/api/pos/ai/documents/route.ts");
  const documentsPage = src("src/app/preview/pos/ai-documents/page.tsx");
  const more = src("src/components/pos-preview/pos-more-workspace.tsx");
  const menuPolicy = src("src/lib/pos-menu-policy.ts");
  const migration = src("../../supabase/migrations/20260930143000_cpipos_ai_document_vault.sql");

  it("presents a provider-neutral seamless AI workspace", () => {
    expect(ui).toContain("CpiPOS AI");
    expect(ui).toContain("/brand/cpipos-symbol-transparent.png");
    expect(ui).toContain("วันนี้อยากให้ CpiPOS AI ช่วยอะไร");
    expect(ui).toContain("radial-gradient");
    expect(ui).toContain("visibleMessages");
    expect(ui).not.toContain("OpenAI");
    expect(ui).not.toContain("OpenAI Conversations");
    expect(ui).not.toContain("ผู้ช่วยอัจฉริยะสำหรับยอดขาย ต้นทุน สต๊อก และการตลาด");
  });

  it("keeps chat efficient while supporting tables, help and image input", () => {
    expect(ui).toContain("<table");
    expect(ui).toContain("แนบรูปเพื่อวิเคราะห์");
    expect(ui).toContain("image/jpeg");
    expect(aiApi).toContain("compactSnapshotForMessage");
    expect(aiApi).toContain("loadBusinessSnapshotForMessage");
    expect(aiApi).toContain("loaded_sections");
    expect(aiApi).toContain("includeCatalog: false");
    expect(aiApi).toContain("responseTokenBudget");
    expect(aiApi).toContain("CPIPOS_HELP_GUIDE");
    expect(aiApi).toContain('type: "input_image"');
    expect(aiApi).toContain('detail: "high"');
    expect(aiApi).toContain("8 * 1024 * 1024");
    expect(aiApi).toContain("ห้ามแต่งยอดขาย");
  });

  it("stores document bodies in private object storage and metadata only in Postgres", () => {
    expect(migration).toContain("'cpipos-ai-documents'");
    expect(migration).toContain("false,");
    expect(migration).toContain("create table if not exists public.pos_ai_documents");
    expect(migration).toContain("object_path text not null unique");
    expect(migration).not.toContain("content text");
    expect(documentService).toContain('.storage.from(BUCKET).upload');
    expect(documentService).toContain("MAX_SOURCE_BYTES");
    expect(documentService).toContain("storage_limit_mb");
    expect(documentService).toContain("max_files");
    expect(documentService).toContain('rpc("pos_ai_document_tenant_usage"');
    expect(documentsApi).toContain("saveAiDocument");
  });

  it("adds package-gated document storage under More and supports customer deletion/export", () => {
    expect(menuPolicy).toContain('"more.ai_documents"');
    expect(menuPolicy).toContain('route: "/preview/pos/ai-documents"');
    expect(more).toContain("เก็บไฟล์เอกสาร");
    expect(documentsPage).toContain('"cpipos_ai"');
    expect(ui).toContain("บันทึกเป็นเอกสาร");
    expect(aiApi).toContain("propose_document");
    expect(ui).toContain("สร้างไฟล์เอกสาร");
    expect(ui).toContain("saveDocumentProposal");
    expect(ui).toContain('fetch("/api/pos/ai/documents"');
    const vaultUi = src("src/components/pos-preview/pos-ai-document-vault.tsx");
    expect(vaultUi).toContain("พิมพ์ / PDF");
    expect(vaultUi).toContain("ดาวน์โหลดต้นฉบับ");
    expect(vaultUi).toContain('method: "DELETE"');
  });

  it("applies package document retention and bounded opportunistic pruning", () => {
    expect(migration).toContain("when p.code = 'growth' then 180");
    expect(migration).toContain("when p.code = 'business' then 365");
    expect(migration).toContain("when p.code = 'business' then 1024");
    expect(migration).toContain("when p.code = 'business' then 500");
    expect(documentService).toContain("pruneExpiredAiDocuments(input.tenantId, 20)");
    expect(documentService).toContain(".limit(Math.max(1, Math.min(100, limit)))");
  });
});
