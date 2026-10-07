import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
describe("internal subscription slip scanner",()=>{
  const route=src("src/app/api/internal/subscription-slip-scan/route.ts");
  it("requires signed bridge and strict checks",()=>{
    expect(route).toContain("cpipos:internal-subscription-slip-scan:v1|");
    expect(route).toContain("timingSafeEqual");
    expect(route).toContain("amount_match");
    expect(route).toContain("payee_match");
    expect(route).toContain("reference_present");
    expect(route).toContain('status:checks.passed?"verified"');
  });
  it("scopes storage to tenant/request",()=>{
    expect(route).toContain('storagePath.startsWith(tenantId+"/"+requestId+"/")');
    expect(route).toContain('from(BUCKET).download(storagePath)');
  });
});
