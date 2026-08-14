import { fail, ok } from "@/lib/http";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";
import { agentAuthFail, claimPrintJobs, requirePrintAgent } from "@/lib/printing/print-agent-service";

type ClaimPayload = {
  limit?: number | null;
  lease_seconds?: number | null;
  app_version?: string | null;
};

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

export async function POST(req: Request) {
  try {
    const agent = await requirePrintAgent(req);
    const body = (await req.json().catch(() => null)) as ClaimPayload | null;
    const jobs = await claimPrintJobs(agent, {
      limit: body?.limit,
      lease_seconds: body?.lease_seconds,
      app_version: body?.app_version ?? null
    });
    const jobsWithConfiguredPaperWidth = jobs.map((job) => {
      const paperWidthMm = configuredPaperWidthMm(job);
      if (!paperWidthMm) return job;
      const metadata = job.metadata ?? {};
      const hasHtmlPayload = typeof metadata.payload_html === "string" && metadata.payload_html.trim().length > 0;
      return {
        ...job,
        metadata: {
          ...metadata,
          paper_width_mm: paperWidthMm,
          ...(hasHtmlPayload
            ? {
                html_paper_width_mm: paperWidthMm,
                print_format: `html_${paperWidthMm}mm`
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
