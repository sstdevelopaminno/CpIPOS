import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const client=readFileSync(resolve(process.cwd(),"src/lib/pos/device-heartbeat-client.ts"),"utf8");
const sender=readFileSync(resolve(process.cwd(),"src/components/pos/pos-device-heartbeat-sender.tsx"),"utf8");

describe("remote printer discovery heartbeat",()=>{
 it("refreshes Android diagnostics for remote printer discovery",()=>{
  expect(client).toContain('executeAndroidSafeCommand("collect_diagnostics")');
  expect(client).toContain('"request_diagnostics"');
 });
 it("sends one immediate follow-up snapshot without reducing the normal heartbeat interval",()=>{
  expect(sender).toContain('reason !== "command"');
  expect(sender).toContain('action.command_type === "request_diagnostics"');
  expect(sender).toContain('window.setTimeout(() => void send("command"), 750)');
  expect(sender).toContain("HEARTBEAT_INTERVAL_MS = 5 * 60_000");
 });
});
