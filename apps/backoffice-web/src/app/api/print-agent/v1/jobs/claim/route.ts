import { ok } from "@/lib/http";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { agentAuthFail, requirePrintAgent } from "@/lib/printing/print-agent-service";
import { claimPrintJobsStabilized } from "@/lib/printing/print-agent-claim-stabilized";

type ClaimPayload = {
  limit?: number | null;
  lease_seconds?: number | null;
  app_version?: string | null;
};

const MODERN_RICH_LAYOUT_MIN_VERSION = [1, 0, 19] as const;
const MODERN_HTML_TAIL_MM = 15;

function configuredPaperWidthMm(job: {
  metadata?: Record<string, unknown> | null;
  printer_profiles?: unknown;
}): 58 | 80 | null {
  const relation = job.printer_profiles;
  const printer = Array.isArray(relation) ? relation[0] : relation;
  if (printer && typeof printer === "object") {
    const width = Number((printer as { paper_width_mm?: unknown }).paper_width_mm);
    if (width === 80) return 80;
    if (width === 58) return 58;
  }

  const metadataWidth = Number(job.metadata?.paper_width_mm);
  if (metadataWidth === 80) return 80;
  if (metadataWidth === 58) return 58;
  return null;
}

function isModernRichLayoutClient(appVersion: string | null | undefined) {
  const match = appVersion?.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const current = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] > MODERN_RICH_LAYOUT_MIN_VERSION[index]) return true;
    if (current[index] < MODERN_RICH_LAYOUT_MIN_VERSION[index]) return false;
  }
  return true;
}

function appendCompactTearSafeTail(html: string) {
  if (html.includes("data-cpipos-tear-safe-tail")) return html;
  // HtmlReceiptRasterizer crops near-white margins before ESC/POS conversion. #f7f7f7 is just
  // dark enough to preserve this compact spacer during crop detection, while remaining above the
  // final monochrome raster threshold so no visible rule is printed. The rasterizer then keeps its
  // existing three line-feeds, producing roughly 2.5-3 cm total clearance instead of ~10 cm.
  const spacer = `<div data-cpipos-tear-safe-tail="v1" aria-hidden="true" style="height:${MODERN_HTML_TAIL_MM}mm;border-bottom:1px solid #f7f7f7"></div>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${spacer}</body>`);
  return `${html}${spacer}`;
}

export async function POST(req: Request) {
  try {
    const agent = await requirePrintAgent(req);
    const body = (await req.json().catch(() => null)) as ClaimPayload | null;
    const modernRichLayout = isModernRichLayoutClient(body?.app_version);
    const jobs = await claimPrintJobsStabilized(agent, {
      limit: body?.limit,
      lease_seconds: body?.lease_seconds,
      app_version: body?.app_version ?? null
    });
    const jobsWithConfiguredPaperWidth = jobs.map((job) => {
      const paperWidthMm = configuredPaperWidthMm(job);
      if (!paperWidthMm) return job;
      const metadata = job.metadata ?? {};
      const htmlPayload = typeof metadata.payload_html === "string" ? metadata.payload_html.trim() : "";
      const hasHtmlPayload = htmlPayload.length > 0;
      return {
        ...job,
        metadata: {
          ...metadata,
          paper_width_mm: paperWidthMm,
          ...(hasHtmlPayload
            ? {
                html_paper_width_mm: paperWidthMm,
                print_format: `html_${paperWidthMm}mm`,
                ...(modernRichLayout
                  ? {
                      // 1.0.19+ keeps low-latency queue wake-up but must render customer-facing
                      // documents from the established HTML templates used before native text mode.
                      payload_html: appendCompactTearSafeTail(htmlPayload),
                      force_rich_html_raster: true,
                      render_policy: "legacy_rich_html_v1",
                      tear_safe_tail_mm: MODERN_HTML_TAIL_MM
                    }
                  : {})
              }
            : {})
        }
      };
    });
    return ok({
      agent_id: agent.id,
      tenant_id: agent.tenant_id,
      branch_id: agent.branch_id,
      device_code: agent.device_code,
      jobs: jobsWithConfiguredPaperWidth
    });
  } catch (error) {
    const authError = agentAuthFail(error);
    if (authError) return authError;
    return loggedPrintApiFail("claim failed", error, "print_agent_claim_failed", "Print agent could not claim jobs. Please retry.");
  }
}
