import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const src=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
describe("CUSTOM has no fixed package tier cap: respect live IT store quota",()=>{
 it("reads live contract, not unapproved draft or catalog max",()=>{
  const gate=src("lib/feature-gate.ts");
  expect(gate).toContain('const maxBranches = parseLimit(contract?.max_branches)');
  expect(gate).toContain('const maxDevices = parseLimit(contract?.max_devices)');
  expect(gate).toContain('const maxUsers = parseLimit(contract?.max_users)');
  expect(gate).toContain('const isCustom = String(packageResult.data?.code ?? "").toLowerCase() === "custom"');
  expect(gate).toContain('branchId && !isCustom');
  expect(gate).toContain("let deviceUsage = limits.usage.devices");
  expect(gate).toContain('resourceType === "branches"');
  expect(gate).toContain('resourceType === "users"');
 });
 it("all three POS provisioning entry points enforce the same negotiated quota",()=>{
  const users=src("app/api/pos/users/route.ts");
  const settings=src("lib/services/pos-settings-service.ts");
  expect(users).toContain('await enforceQuota(auth.tenantId!, "users")');
  expect(settings).toContain('await enforceQuota(auth.tenantId, "branches")');
  expect(settings).toContain('await enforceQuota(auth.tenantId, "devices", branchId)');
 });
});