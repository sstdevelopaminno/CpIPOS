import { appendAuditLog } from "@/lib/audit-log";
import { readEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { isTenantPosMenuEnabled } from "@/lib/server/pos-menu-policy-service";
import { assertAiQuotaAvailable } from "@/lib/services/ai-usage-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const IMAGE_MODEL = readEnv("CPIPOS_AI_IMAGE_MODEL") ?? "gpt-image-2.5-sunburst";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canUseAi(role: string | null) {
  return role === "owner" || role === "manager";
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true });
    if (!auth.tenantId || !auth.branchId || !canUseAi(auth.branchRole)) {
      return fail("ai_image_forbidden", "ใช้งานได้เฉพาะ Owner หรือ Manager", 403);
    }
    if (!(await isTenantPosMenuEnabled(auth.tenantId, "main.ai_assistant"))) {
      return fail("ai_assistant_disabled_by_it", "CpiPOS AI ถูกปิดสำหรับร้านนี้", 403);
    }

    await assertAiQuotaAvailable(auth.tenantId);

    const body = (await request.json().catch(() => null)) as {
      product_id?: unknown;
      prompt?: unknown;
    } | null;
    const productId = cleanText(body?.product_id, 80);
    const prompt = cleanText(body?.prompt, 1800);
    if (!UUID_RE.test(productId) || !prompt) {
      return fail("invalid_ai_image_request", "กรุณาระบุสินค้าและรายละเอียดภาพ", 422);
    }

    const db = getSupabaseServiceClient();
    const { data: product, error: productError } = await db
      .from("products")
      .select("id,name,category")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("id", productId)
      .eq("is_active", true)
      .maybeSingle<{ id: string; name: string; category: string | null }>();
    if (productError) throw productError;
    if (!product) return fail("product_not_found", "ไม่พบสินค้าในสาขานี้", 404);

    const apiKey = readEnv("OPENAI_API_KEY");
    if (!apiKey) return fail("ai_not_configured", "CpiPOS AI ยังไม่พร้อมสร้างรูปภาพ", 503);

    const finalPrompt = [
      "Create a clean commercial product photo for a POS catalog.",
      "Square composition, single product as the clear subject, professional studio lighting, realistic texture, uncluttered background, no watermark.",
      "Do not add prices or promotional text unless explicitly requested.",
      `Product: ${product.name}`,
      product.category ? `Category: ${product.category}` : "",
      `User brief: ${prompt}`
    ].filter(Boolean).join("\n");

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: finalPrompt,
        size: "1024x1024",
        quality: "medium",
        output_format: "webp",
        output_compression: 82,
        background: "opaque",
        n: 1
      })
    });
    const payload = await response.json().catch(() => null) as {
      data?: Array<{ b64_json?: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
      error?: { message?: string };
    } | null;
    if (!response.ok) {
      return fail("ai_image_provider_failed", payload?.error?.message || "สร้างรูปภาพไม่สำเร็จ", response.status >= 500 ? 503 : 422);
    }
    const base64 = payload?.data?.[0]?.b64_json;
    if (!base64) return fail("ai_image_empty", "ระบบไม่ได้รับรูปภาพจากบริการ AI", 502);

    try {
      const usage = payload?.usage ?? {};
      await db.from("pos_ai_usage_events").insert({
        tenant_id: auth.tenantId,
        branch_id: auth.branchId,
        user_id: auth.userId,
        model: IMAGE_MODEL,
        prompt_text: `[image] ${prompt}`.slice(0, 1200),
        input_tokens: Math.max(0, Number(usage.input_tokens ?? 0)),
        output_tokens: Math.max(0, Number(usage.output_tokens ?? 0)),
        total_tokens: Math.max(0, Number(usage.total_tokens ?? 0)),
        total_cost_usd: 0,
        pricing_source: "openai:image-generation",
        status: "completed",
        requested_at: new Date().toISOString()
      });
    } catch (meterError) {
      console.error("[cpipos-ai-image] metering failed", meterError);
    }

    await appendAuditLog({
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "ai_product_image_generated",
      targetTable: "products",
      targetId: product.id,
      module: "cpipos_ai",
      metadata: {
        model: IMAGE_MODEL,
        product_name: product.name,
        prompt: prompt.slice(0, 500)
      }
    });

    return ok({
      product: { id: product.id, name: product.name },
      image_data_url: `data:image/webp;base64,${base64}`,
      mime_type: "image/webp",
      width: 1024,
      height: 1024,
      model: IMAGE_MODEL
    });
  } catch (error) {
    console.error("[cpipos-ai-image] generation failed", error);
    return fail("ai_image_failed", error instanceof Error ? error.message : "สร้างรูปภาพไม่สำเร็จ", 500);
  }
}
