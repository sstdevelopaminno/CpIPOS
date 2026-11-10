// Public, read-only disaster-recovery checks. Never submits store codes, credentials or payments.
export const endpoints = Object.freeze([
  { id: "pos-login", url: "https://pos.cuttingpointinnovation.com/login/store", tier: "critical", kind: "html", expect: /CpIPOS|CpiPOS/i },
  { id: "cloudflare-status", url: "https://cpi-incident-status.sstdevelopaminno.workers.dev/health", tier: "critical", kind: "json", expectStatus: "incident" },
  { id: "company", url: "https://www.cuttingpointinnovation.com/", tier: "warning", kind: "html" },
  { id: "downloads", url: "https://www.cuttingpointinnovation.com/downloads", tier: "warning", kind: "html" },
  { id: "hr-web", url: "https://cpi-attendance-hr.vercel.app/", tier: "warning", kind: "html" }
]);

const PAUSED = /this deployment is temporarily paused|exceeded (?:the )?fair.use|account (?:is )?suspended/i;

export async function inspect(target, fetcher = fetch) {
  const started = Date.now();
  try {
    const response = await fetcher(target.url, {
      method: "GET",
      headers: { "User-Agent": "CpiPOS-DR-readonly-check/1.0", Accept: "text/html,application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(9000)
    });
    if (!response.ok) {
      return { id: target.id, tier: target.tier, ok: false, status: response.status, elapsedMs: Date.now()-started, reason: "http_error" };
    }
    const body = await response.text();
    if (PAUSED.test(body)) return { id: target.id, tier: target.tier, ok: false, status: response.status, elapsedMs: Date.now()-started, reason: "paused_page" };
    if (target.kind === "json") {
      let parsed;
      try { parsed = JSON.parse(body); } catch { return { id: target.id, tier: target.tier, ok: false, status: response.status, elapsedMs: Date.now()-started, reason: "invalid_json" }; }
      if (parsed.status !== target.expectStatus || parsed.service !== "CpiPOS incident notice") {
        return { id: target.id, tier: target.tier, ok: false, status: response.status, elapsedMs: Date.now()-started, reason: "unexpected_status" };
      }
    } else if (target.expect && !target.expect.test(body)) {
      return { id: target.id, tier: target.tier, ok: false, status: response.status, elapsedMs: Date.now()-started, reason: "unexpected_page" };
    }
    return { id: target.id, tier: target.tier, ok: true, status: response.status, elapsedMs: Date.now()-started, reason: "public_endpoint_responding" };
  } catch (error) {
    // Do not serialize network errors (may leak tokens in URLs for other future checks).
    const reason = error?.name === "TimeoutError" ? "timeout" : "network_error";
    return { id: target.id, tier: target.tier, ok: false, status: null, elapsedMs: Date.now()-started, reason };
  }
}

export async function checkAll(fetcher = fetch) {
  const results = await Promise.all(endpoints.map(t => inspect(t, fetcher)));
  return { results, criticalFailed: results.some(r=>r.tier==="critical" && !r.ok), warnings: results.filter(r=>r.tier==="warning"&&!r.ok).length };
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const {results,criticalFailed,warnings} = await checkAll();
  console.log("CpiPOS DR public endpoints — NO authenticated sales tests and NO automatic failover.");
  for(const r of results) console.log(`${r.ok?"OK":"FAIL"} ${r.tier.padEnd(8)} ${r.id.padEnd(18)} HTTP:${String(r.status??"-").padEnd(3)} ${r.elapsedMs}ms (${r.reason})`);
  console.log(`WARNINGS=${warnings}; CRITICAL_FAILED=${criticalFailed}`);
  console.log("CRITICAL POS login HTTP 200 does not certify kitchen, sales, payments, tenant isolation, database backups or MDM.");
  if (criticalFailed) process.exitCode = 1;
}
