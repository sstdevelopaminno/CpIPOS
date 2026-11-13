import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const source=readFileSync(resolve(process.cwd(),"src/components/pos-preview/pos-subscription-lifecycle-guard.tsx"),"utf8");
describe("POS paid subscription grace wording",()=>{
  it("uses the authoritative grace expiry and displays the grace period",()=>{
    expect(source).toContain('runtime.lifecycle_status==="grace"');
    expect(source).toContain("ช่วงผ่อนผันการชำระเงิน");
    expect(source).toContain("สิ้นสุดระยะผ่อนผันการชำระเงิน");
  });
});
