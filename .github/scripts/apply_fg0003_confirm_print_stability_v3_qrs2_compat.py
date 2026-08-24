from pathlib import Path


# Compatibility runner for branches where Restaurant QR QRS-2 already owns
# print enqueue idempotency and routed per-copy keys in source.
#
# Keep the still-needed legacy build patches for timeline/POS kitchen confirmation,
# then apply only the direct-print atomic claim from v3. Do not overwrite the newer
# QRS-2 enqueue/routing implementation with the older exact-text patch.
ORIGINAL = Path(".github/scripts/apply_fg0003_confirm_print_stability_v3.py")
source = ORIGINAL.read_text(encoding="utf-8-sig")
marker = "# 2) Print enqueue: DB unique key is authoritative. Concurrent duplicate inserts become idempotent reads."
if marker not in source:
    raise SystemExit("confirm print v3 compat: source marker missing")

prefix = source.split(marker, 1)[0]
exec(compile(prefix, str(ORIGINAL), "exec"), globals(), globals())

# QRS-2 already handles duplicate enqueue recovery via
# loadExistingPrintJobByIdempotencyKey() + Restaurant QR scoping.
# Preserve it and add only the direct/server atomic claim when still absent.
path = "apps/backoffice-web/src/lib/printing/print-service.ts"
s = read(path)

atomic_claim_marker = 'if (job.status === "printed" || job.status === "printing") return job;'
if atomic_claim_marker not in s:
    old_claim = '''export async function processPrintJob(jobId: string): Promise<PrintJobRow | null> {\n  const job = await getPrintJobWithPrinter(jobId);\n  if (!job) {\n    return null;\n  }\n\n  const printer = job.printer_profiles;\n'''
    new_claim = '''export async function processPrintJob(jobId: string): Promise<PrintJobRow | null> {\n  const job = await getPrintJobWithPrinter(jobId);\n  if (!job) {\n    return null;\n  }\n  if (job.status === "printed" || job.status === "printing") return job;\n\n  const supabase = getSupabaseServiceClient();\n  const { data: claimed, error: claimError } = await supabase\n    .from("print_jobs")\n    .update({ status: "printing", updated_at: nowIso() })\n    .eq("id", jobId)\n    .eq("tenant_id", job.tenant_id)\n    .eq("branch_id", job.branch_id)\n    .in("status", ["pending", "retrying"])\n    .select("id")\n    .maybeSingle();\n  if (claimError) throw new Error(claimError.message);\n  if (!claimed) {\n    const current = await getPrintJobWithPrinter(jobId);\n    return current as PrintJobRow | null;\n  }\n\n  const printer = job.printer_profiles;\n'''
    s = replace_once(s, old_claim, new_claim, "direct print atomic claim")
    write(path, s)

# routed-print-service.ts is intentionally not patched here. QRS-2 source already
# builds deterministic keys from printer/device/purpose/zone/copy, which supersedes
# the older v3 ':copy:N' transformation.
print("confirm print v3 QRS-2 compatibility patch applied")
