import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { readEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { loadPosSalesSummaryData } from "@/lib/services/pos-sales-summary-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type AiHistoryItem = {
  role: "user" | "assistant";
  text: string;
};

type AiRequestBody = {
  message?: string;
  history?: AiHistoryItem[];
};

type IngredientRow = {
  id: string;
  name: string | null;
  base_unit: string | null;
  quantity_on_hand: number | null;
  reorder_level: number | null;
};

type ProductRow = {
  id: string;
  name: string | null;
  category: string | null;
  price: number | null;
  stock_deduction_mode: string | null;
};

type RecipeRow = {
  product_id: string;
  quantity_per_item: number | null;
  ingredients?: { avg_unit_cost?: number | null } | Array<{ avg_unit_cost?: number | null }> | null;
};

const AI_MODEL = readEnv("CPIPOS_AI_MODEL") ?? "gpt-6-luna";
const MAX_OUTPUT_TOKENS_RAW = Number(readEnv("CPIPOS_AI_MAX_OUTPUT_TOKENS") ?? "900");
const MAX_OUTPUT_TOKENS = Number.isFinite(MAX_OUTPUT_TOKENS_RAW)
  ? Math.max(256, Math.min(1600, Math.trunc(MAX_OUTPUT_TOKENS_RAW)))
  : 900;

function canUseAi(branchRole: string | null, platformRole: string | null) {
  return platformRole === "it_admin" || branchRole === "owner" || branchRole === "manager";
}

function bangkokDate(offsetDays = 0) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
}

function asMoney(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function ingredientCost(row: RecipeRow) {
  const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
  const avgUnitCost = Number(ingredient?.avg_unit_cost ?? 0);
  const quantity = Number(row.quantity_per_item ?? 0);
  if (!Number.isFinite(avgUnitCost) || !Number.isFinite(quantity) || avgUnitCost <= 0 || quantity <= 0) {
    return { cost: 0, missing: true };
  }
  return { cost: quantity * avgUnitCost, missing: false };
}

async function loadCostSnapshot(tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  const productResult = await supabase
    .from("products")
    .select("id,name,category,price,stock_deduction_mode")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .limit(120);

  if (productResult.error) {
    return { lowMarginProducts: [], costDataAvailable: false };
  }

  const products = (productResult.data ?? []) as ProductRow[];
  const productIds = products.map((row) => row.id);
  if (!productIds.length) {
    return { lowMarginProducts: [], costDataAvailable: true };
  }

  const recipeResult = await supabase
    .from("recipes")
    .select("product_id,quantity_per_item,ingredients(avg_unit_cost)")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .in("product_id", productIds)
    .limit(1500);

  if (recipeResult.error) {
    return { lowMarginProducts: [], costDataAvailable: false };
  }

  const rollup = new Map<string, { cost: number; lines: number; missing: number }>();
  for (const row of (recipeResult.data ?? []) as RecipeRow[]) {
    const current = rollup.get(String(row.product_id)) ?? { cost: 0, lines: 0, missing: 0 };
    const line = ingredientCost(row);
    current.cost += line.cost;
    current.lines += 1;
    if (line.missing) current.missing += 1;
    rollup.set(String(row.product_id), current);
  }

  const lowMarginProducts = products
    .map((product) => {
      const summary = rollup.get(product.id) ?? { cost: 0, lines: 0, missing: 0 };
      const salePrice = asMoney(product.price);
      const estimatedCost = asMoney(summary.cost);
      const grossProfit = asMoney(salePrice - estimatedCost);
      const marginPct = salePrice > 0 ? Number(((grossProfit / salePrice) * 100).toFixed(2)) : 0;
      return {
        product_id: product.id,
        name: product.name ?? product.id,
        category: product.category ?? "-",
        sale_price: salePrice,
        estimated_cost: estimatedCost,
        gross_profit: grossProfit,
        margin_pct: marginPct,
        ingredient_lines: summary.lines,
        missing_cost_lines: summary.missing
      };
    })
    .filter((row) => row.ingredient_lines > 0 && row.missing_cost_lines === 0)
    .sort((a, b) => a.margin_pct - b.margin_pct || a.name.localeCompare(b.name))
    .slice(0, 8);

  return { lowMarginProducts, costDataAvailable: true };
}

async function loadLowStock(tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  const result = await supabase
    .from("ingredients")
    .select("id,name,base_unit,quantity_on_hand,reorder_level")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .limit(300);

  if (result.error) return [];

  return ((result.data ?? []) as IngredientRow[])
    .map((row) => ({
      id: row.id,
      name: row.name ?? row.id,
      unit: row.base_unit ?? "",
      quantity_on_hand: Number(row.quantity_on_hand ?? 0),
      reorder_level: Number(row.reorder_level ?? 0)
    }))
    .filter((row) => row.reorder_level > 0 && row.quantity_on_hand <= row.reorder_level)
    .sort((a, b) => (a.quantity_on_hand / Math.max(a.reorder_level, 1)) - (b.quantity_on_hand / Math.max(b.reorder_level, 1)))
    .slice(0, 8);
}

async function loadBusinessSnapshot(auth: Awaited<ReturnType<typeof getPosApiAuthContext>>) {
  const today = bangkokDate(0);
  const from30 = bangkokDate(-29);
  const scope = {
    userId: auth.userId,
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    branchRole: auth.branchRole,
    platformRole: auth.platformRole
  };

  const [todaySummary, monthSummary, lowStock, costSnapshot] = await Promise.all([
    loadPosSalesSummaryData(scope, {
      dateFrom: today,
      dateTo: today,
      branchId: auth.branchId,
      status: "all"
    }),
    loadPosSalesSummaryData(scope, {
      dateFrom: from30,
      dateTo: today,
      branchId: auth.branchId,
      status: "all"
    }),
    loadLowStock(auth.tenantId!, auth.branchId!),
    loadCostSnapshot(auth.tenantId!, auth.branchId!)
  ]);

  return {
    generated_at: new Date().toISOString(),
    period: {
      today,
      last_30_days_from: from30,
      last_30_days_to: today
    },
    today: {
      net_sales: todaySummary.summary.netSales,
      gross_sales: todaySummary.summary.grossSales,
      receipts: todaySummary.summary.receiptCount,
      average_receipt: todaySummary.summary.averageReceiptValue,
      cash: todaySummary.summary.cashTotal,
      transfer_qr: todaySummary.summary.qrTransferTotal,
      card: todaySummary.summary.cardTotal,
      discounts: todaySummary.summary.discountTotal,
      tax: todaySummary.summary.taxTotal,
      cancelled_count: todaySummary.summary.cancelledCount,
      top_products: todaySummary.bestSellingProducts.slice(0, 5).map((row) => ({
        product_id: row.productId,
        name: row.productName,
        category: row.category,
        units: row.quantitySold,
        revenue: row.netAmount
      }))
    },
    last_30_days: {
      net_sales: monthSummary.summary.netSales,
      receipts: monthSummary.summary.receiptCount,
      average_receipt: monthSummary.summary.averageReceiptValue,
      top_products: monthSummary.bestSellingProducts.slice(0, 10).map((row) => ({
        product_id: row.productId,
        name: row.productName,
        category: row.category,
        units: row.quantitySold,
        revenue: row.netAmount
      }))
    },
    stock: {
      low_stock_count: lowStock.length,
      low_stock: lowStock
    },
    cost: {
      available: costSnapshot.costDataAvailable,
      low_margin_products: costSnapshot.lowMarginProducts
    }
  };
}

function sanitizeHistory(input: unknown): AiHistoryItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-6)
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const role = row.role === "assistant" ? "assistant" : "user";
      const text = String(row.text ?? "").trim().slice(0, 700);
      return { role, text } as AiHistoryItem;
    })
    .filter((item) => item.text.length > 0);
}

function extractOutputText(payload: unknown): string {
  const body = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text.trim();
  const chunks: string[] = [];
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim()) chunks.push(content.text.trim());
    }
  }
  return chunks.join("\n").trim();
}

function formatHistory(history: AiHistoryItem[]) {
  if (!history.length) return "- ไม่มีประวัติสนทนาก่อนหน้า";
  return history.map((item) => `${item.role === "user" ? "ลูกค้า" : "CpiPOS AI"}: ${item.text}`).join("\n");
}

const AI_INSTRUCTIONS = [
  "คุณคือ CpiPOS AI ผู้ช่วยร้านค้าสำหรับเจ้าของหรือผู้จัดการร้าน",
  "ตอบภาษาไทยเป็นหลัก กระชับ ชัดเจน และใช้ภาษาธุรกิจที่เจ้าของร้านเข้าใจง่าย",
  "ใช้เฉพาะข้อมูลร้านที่ระบบส่งมาให้ ห้ามแต่งยอดขาย ต้นทุน สต๊อก หรือตัวเลขที่ไม่มีในข้อมูล",
  "ถ้าข้อมูลไม่พอ ให้บอกตรง ๆ ว่ายังวิเคราะห์ส่วนนั้นไม่ได้ และบอกว่าควรเพิ่มข้อมูลอะไร",
  "ข้อมูลต้นทุนเป็นต้นทุนประมาณจากสูตร/วัตถุดิบ จึงใช้คำว่า 'กำไรขั้นต้นโดยประมาณ' และห้ามเรียกว่า 'กำไรสุทธิ' เว้นแต่มีค่าใช้จ่ายครบ",
  "สำหรับคำถามการตลาด ให้เสนอไอเดียที่นำไปทดลองได้ เช่น โปรโมชัน กลุ่มสินค้า เวลา และข้อความโพสต์ โดยอ้างอิงยอดขาย/มาร์จิ้นเมื่อมีข้อมูล",
  "ระบบเวอร์ชันนี้เป็น read-only: คุณวิเคราะห์และเสนอได้ แต่ห้ามอ้างว่าคุณแก้ราคา ปรับสต๊อก ยกเลิกบิล หรือบันทึกบัญชีให้แล้ว",
  "ถ้าผู้ใช้ขอให้ทำรายการที่เปลี่ยนข้อมูล ให้ตอบว่าสามารถเตรียมข้อเสนอหรือขั้นตอนให้ได้ แต่ต้องให้ผู้ใช้ยืนยันในระบบก่อน",
  "เมื่อเหมาะสมให้สรุปเป็น 3-5 ประเด็นและระบุหน่วยเงินบาท (บาท)"
].join("\n");

async function callOpenAi(message: string, history: AiHistoryItem[], snapshot: Awaited<ReturnType<typeof loadBusinessSnapshot>>) {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for CpiPOS AI.");

  const input = [
    "ข้อมูลร้านปัจจุบัน (JSON):",
    JSON.stringify(snapshot),
    "",
    "ประวัติสนทนาล่าสุด:",
    formatHistory(history),
    "",
    `คำถามล่าสุดของผู้ใช้: ${message}`
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      instructions: AI_INSTRUCTIONS,
      input,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS
    })
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message ?? "AI request failed.")
        : "AI request failed.";
    throw new Error(detail);
  }

  const text = extractOutputText(payload);
  if (!text) throw new Error("CpiPOS AI returned an empty response.");
  return text;
}

export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true });
    if (!canUseAi(auth.branchRole, auth.platformRole)) {
      return fail("ai_assistant_forbidden", "CpiPOS AI is available to Owner and Manager roles.", 403);
    }
    const overview = await loadBusinessSnapshot(auth);
    return ok({ overview, model: AI_MODEL });
  } catch (error) {
    return fail("ai_assistant_overview_failed", error instanceof Error ? error.message : "Unable to load AI overview.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true });
    if (!canUseAi(auth.branchRole, auth.platformRole)) {
      return fail("ai_assistant_forbidden", "CpiPOS AI is available to Owner and Manager roles.", 403);
    }

    const body = (await request.json().catch(() => null)) as AiRequestBody | null;
    const message = String(body?.message ?? "").trim().slice(0, 1200);
    if (!message) return fail("ai_message_required", "Please enter a question for CpiPOS AI.", 422);

    const history = sanitizeHistory(body?.history);
    const overview = await loadBusinessSnapshot(auth);

    let answer: string;
    try {
      answer = await callOpenAi(message, history, overview);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "CpiPOS AI request failed.";
      const status = messageText.includes("OPENAI_API_KEY") ? 503 : 502;
      return fail(status === 503 ? "ai_not_configured" : "ai_provider_failed", messageText, status);
    }

    return ok({
      answer,
      overview,
      model: AI_MODEL,
      mode: "read_only"
    });
  } catch (error) {
    return fail("ai_assistant_failed", error instanceof Error ? error.message : "Unable to use CpiPOS AI.", 500);
  }
}
