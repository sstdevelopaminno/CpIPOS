import { ok } from "@/lib/http";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { agentAuthFail, requirePrintAgent } from "@/lib/printing/print-agent-service";
import { claimPrintJobsStabilized, PRINT_AGENT_CLAIM_TIMEOUT_MS } from "@/lib/printing/print-agent-claim-stabilized";
import { BoundedTimeoutError, withAbortableTimeout } from "@/lib/server/bounded-timeout";

type ClaimPayload = {
  limit?: number | null;
  lease_seconds?: number | null;
  app_version?: string | null;
};

const MODERN_RICH_LAYOUT_MIN_VERSION = [1, 0, 19] as const;
// HtmlReceiptRasterizer adds three ESC/POS line feeds after the raster. A 22mm raster-safe
// spacer plus those feeds leaves roughly 35mm from the final visible content to the paper edge.
const MODERN_HTML_TAIL_MM = 22;

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

function ensureModernTearSafeTail(html: string) {
  // Table QR already owns a dedicated raster spacer. Normalize its existing height instead of
  // appending the generic spacer, otherwise the two tails would stack and waste paper.
  if (html.includes("data-cpipos-table-qr-tail")) {
    return html.replace(
      /(\.qr-tail\s*\{\s*height:)\s*\d+(?:\.\d+)?mm/i,
      `$1${MODERN_HTML_TAIL_MM}mm`
    );
  }

  // Existing generic marker means this payload has already been normalized upstream or during a
  // previous claim. Keep it idempotent, but also normalize an older 15mm marker to the new 22mm
  // standard so a re-claimed job cannot retain the shorter paper tail.
  if (html.includes("data-cpipos-tear-safe-tail")) {
    return html.replace(
      /(data-cpipos-tear-safe-tail="v1"[^>]*style="[^"]*height:)\s*\d+(?:\.\d+)?mm/i,
      `$1${MODERN_HTML_TAIL_MM}mm`
    );
  }

  // HtmlReceiptRasterizer crops white margins before ESC/POS conversion. #f7f7f7 survives crop
  // detection but remains above the final monochrome threshold, so this spacer is physically kept
  // without printing a visible rule. Combined with the renderer's three final feeds it yields
  // approximately 3.5cm of tear-safe clearance after the final visible text.
  const spacer = `<div data-cpipos-tear-safe-tail="v1" aria-hidden="true" style="height:${MODERN_HTML_TAIL_MM}mm;border-bottom:1px solid #f7f7f7"></div>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${spacer}</body>`);
  return `${html}${spacer}`;
}

export async function POST(req: Request) {
  try {
    return await withAbortableTimeout(async (signal) => {
      const agent = await requirePrintAgent(req, { signal });
      const body = (await req.json().catch(() => null)) as ClaimPayload | null;
      const modernRichLayout = isModernRichLayoutClient(body?.app_version);
      const jobs = await claimPrintJobsStabilized(agent, {
        limit: body?.limit,
        lease_seconds: body?.lease_seconds,
        app_version: body?.app_version ?? null,
        signal
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
                        // 1.0.19+ keeps low-latency queue wake-up but renders customer-facing
                        // documents from the established HTML templates used before native text mode.
                        payload_html: ensureModernTearSafeTail(htmlPayload),
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
    }, PRINT_AGENT_CLAIM_TIMEOUT_MS, "print_agent_claim_timeout");
  } catch (error) {
    const authError = agentAuthFail(error);
    if (authError) return authError;
    if (error instanceof BoundedTimeoutError) {
      return loggedPrintApiFail(
        "claim timed out",
        error,
        error.code,
        "Print agent claim timed out before completion. Please retry.",
        504,
        { timeout_ms: error.timeoutMs }
      );
    }
    return loggedPrintApiFail("claim failed", error, "print_agent_claim_failed", "Print agent could not claim jobs. Please retry.");
  }
}
