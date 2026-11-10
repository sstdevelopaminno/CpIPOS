// Local-only Cloudflare workerd smoke; no customer data or credentials.
// Requires: node scripts/cloudflare-standby-build.mjs, then wrangler dev --local.
const ADDRESS = "http://127.0.0.1:8787";
const MAX_STARTUP_MS = 120_000;

export function validateLogin(result) {
  if (result.status !== 200) return "login_http_" + result.status;
  if (!/CpIPOS|CpiPOS/i.test(result.body)) return "wrong_login_content";
  if (!/storeCode|รหัสร้านค้า/.test(result.body)) return "missing_store_login_form";
  if (/This deployment is temporarily paused/i.test(result.body)) return "paused_response";
  return null;
}

export function validateProtectedPreview(result) {
  if (![301,302,303,307,308].includes(result.status)) return "preview_access_without_login_" + result.status;
  const loc = result.location ?? "";
  if (!loc.startsWith("/login/store") && !/^http:\/\/127\.0\.0\.1:8787\/login\/store(?:\?|$)/.test(loc)) {
    return "wrong_preview_redirect";
  }
  return null;
}

async function fetchResult(path) {
  const response = await fetch(ADDRESS + path, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(4_000),
    headers: { "User-Agent": "CpIPOS-Cloudflare-local-only-smoke" }
  });
  return { status: response.status, location: response.headers.get("location"), body: await response.text() };
}

async function waitForServer() {
  const stopAt=Date.now()+MAX_STARTUP_MS;
  while(Date.now()<stopAt) {
    try {
      const result=await fetchResult("/login/store");
      // A response from workerd (including 5xx) means the runtime has started.
      return result;
    } catch {
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
  throw new Error("Local Cloudflare workerd never accepted requests.");
}

export async function run() {
  const login=await waitForServer();
  const loginError=validateLogin(login);
  console.log("Cloudflare-local: login HTML status="+login.status+" "+(loginError||"OK"));
  if(loginError) throw new Error(loginError);
  const preview=await fetchResult("/preview/pos");
  const previewError=validateProtectedPreview(preview);
  console.log("Cloudflare-local: protected preview status="+preview.status+" "+(previewError||"OK"));
  if(previewError) throw new Error(previewError);
  console.log("LOCAL_CLOUDFLARE_RUNTIME_SMOKE=PASS (anonymous entry/redirect only; transaction failover UNTESTED)");
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  await run();
}
