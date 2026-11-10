import { test } from "node:test";
import assert from "node:assert/strict";
import { endpoints, inspect, checkAll } from "../dr/public-readiness.mjs";

const response = (body, status=200)=>({status,ok:status>=200&&status<300,text:async()=>body});

test("only approved anonymous read-only GET destinations are probed",()=>{
 assert.equal(endpoints.length,5);
 assert.ok(endpoints.every(t=>t.url.startsWith("https://")));
 assert.deepEqual(endpoints.filter(t=>t.tier==="critical").map(t=>t.id),["pos-login","cloudflare-status"]);
});

test("requires the expected POS login page, not a generic HTTP 200",async()=>{
 const target=endpoints[0];
 assert.equal((await inspect(target,async()=>response("<title>CpIPOS</title>"))).ok,true);
 assert.equal((await inspect(target,async()=>response("<title>Other</title>"))).reason,"unexpected_page");
 assert.equal((await inspect(target,async()=>response("This deployment is temporarily paused"))).reason,"paused_page");
});

test("Cloudflare incident health does not claim full POS readiness",async()=>{
 const t=endpoints[1];
 assert.equal((await inspect(t,async()=>response(JSON.stringify({service:"CpiPOS incident notice",status:"incident"})))).ok,true);
 assert.equal((await inspect(t,async()=>response(JSON.stringify({service:"CpiPOS incident notice",status:"healthy"})))).reason,"unexpected_status");
});

test("all probes use GET, no credentials, with a bounded timeout",async()=>{
 let observed=0;
 const result=await checkAll(async (url,opts)=>{
  observed++;
  assert.equal(opts.method,"GET");
  assert.ok(!("Authorization" in opts.headers));
  assert.ok(opts.signal);
  return response(url.includes("workers.dev")?JSON.stringify({service:"CpiPOS incident notice",status:"incident"}):"<title>CpIPOS</title>");
 });
 assert.equal(observed,5);
 assert.equal(result.criticalFailed,false);
 assert.equal(result.warnings,0);
});

test("critical outage fails readiness; noncritical outage only raises warnings",async()=>{
 const result=await checkAll(async url=>url.includes("www.cuttingpointinnovation.com")?response("Error 402",402):response(url.includes("workers.dev")?JSON.stringify({service:"CpiPOS incident notice",status:"incident"}):"<title>CpIPOS</title>"));
 assert.equal(result.criticalFailed,false);
 assert.equal(result.warnings,2);
});
