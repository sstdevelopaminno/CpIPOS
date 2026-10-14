import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source=readFileSync(resolve(process.cwd(),"src/lib/pos-shift-entry-singleton.ts"),"utf8");
const gate=readFileSync(resolve(process.cwd(),"src/components/pos/pos-entry-gate.tsx"),"utf8");

describe("single shift-required gate across POS route transitions",()=>{
 it("has one browser-global owner list rather than per-session owners",()=>{
  expect(source).toContain("window as ShiftEntryWindow");
  expect(source).toContain("__cpiposShiftEntryStore");
  expect(source).toContain("owners: symbol[]");
  expect(source).toContain("sharedStore().owners[0] === token.current");
  expect(source).not.toContain("new Map<string, symbol[]>()");
 });
 it("releases the leader when a session becomes active or an old route unmounts",()=>{
  expect(source).toContain("return register(token.current)");
  expect(source).toContain("store.owners.splice(index, 1)");
  expect(source).toContain("notify(store)");
  expect(gate).toContain("!loading && session && !hasActiveShift ? session.session.id : null");
  expect(gate).toContain("if (!shiftEntryLeader) return null");
 });
 it("continues to require an active shift before mounting sales or any CUSTOM mode",()=>{
  expect(gate).toContain("if (hasActiveShift && canEnterSales) {");
  expect(gate).toContain("<PosInitialSalesModeController initialScope={initialScope} />");
  expect(gate).toContain('data-pos-open-shift-gate="1"');
 });
});
