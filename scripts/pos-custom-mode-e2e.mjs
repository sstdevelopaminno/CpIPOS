// Real-browser POS smoke test. No writes or IT toggles.
// Provide an authenticated QA Playwright storageState file yourself.
// Example (from repo root):
// POS_E2E_CASES_FILE=.qa/pos-custom-modes.json node scripts/pos-custom-mode-e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const casesFile = process.env.POS_E2E_CASES_FILE;
if (!casesFile) {
  throw new Error("POS_E2E_CASES_FILE is required. Never commit session storageState or employee credentials.");
}
const cases = JSON.parse(await fs.readFile(casesFile, "utf8"));
if (!Array.isArray(cases) || !cases.length) throw new Error("Expected nonempty QA cases array.");
const origin = process.env.POS_E2E_ORIGIN || "https://cp-ipos-web.vercel.app";
const timeoutMs = Math.max(15000, Number(process.env.POS_E2E_TIMEOUT_MS || 55000));
const evidenceDir = path.resolve(process.env.POS_E2E_OUTPUT_DIR || ".qa/pos-custom-evidence");
await fs.mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: process.env.POS_E2E_HEADLESS !== "0" });
const results = [];
let failures = 0;
try {
  for (const testCase of cases) {
    if (!testCase.name || !testCase.storageState || !testCase.expectedMode) {
      throw new Error("Each case needs name, storageState and expectedMode.");
    }
    if (!["optical_retail","general_sale","home","dine_in","buffet_table","delivery","none","shift_required"].includes(testCase.expectedMode)) {
      throw new Error("Unexpected mode " + testCase.expectedMode);
    }
    const context = await browser.newContext({ storageState: testCase.storageState, baseURL: origin });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text().slice(0,300)); });
    const result = { name:testCase.name, expectedMode:testCase.expectedMode, passed:false, errors:[] };
    const safeName = testCase.name.replace(/[^a-z0-9_-]/gi, "_");
    try {
      const response = await page.goto("/preview/pos", { waitUntil:"domcontentloaded", timeout:timeoutMs });
      if (!response || response.status() >= 400) throw new Error("POS page HTTP " + (response?.status() ?? "none"));
      if (testCase.expectedMode === "shift_required") {
        await page.locator("[data-pos-open-shift-gate='1']").waitFor({ timeout:timeoutMs });
      } else if (testCase.expectedMode === "none") {
        await page.locator("[data-testid='pos-startup-failure-code']").filter({hasText:"POS-START-GRANTS"}).waitFor({ timeout:timeoutMs });
      } else {
        const topbar = page.locator('.posui-sales-topbar[data-pos-react-sales-mode="' + testCase.expectedMode + '"]');
        await topbar.waitFor({ timeout:timeoutMs });
        await page.locator('[data-testid="pos-startup-mode-gate"]').waitFor({state:"hidden",timeout:timeoutMs});
        if (testCase.expectedMode === "optical_retail") {
          await page.locator('[data-testid="pos-active-optical-mode"]').waitFor({ timeout:timeoutMs });
          if (await page.locator('.posui-sales-topbar[data-pos-react-sales-mode="home"]').count()) {
            throw new Error("Home rendering visible despite authorized Optical-only mode.");
          }
        }
        // Reload to catch the old hydration / repeated-request handshake defect.
        await page.reload({ waitUntil:"domcontentloaded", timeout:timeoutMs });
        await topbar.waitFor({ timeout:timeoutMs });
        await page.locator('[data-testid="pos-startup-mode-gate"]').waitFor({state:"hidden",timeout:timeoutMs});
        for (const forbidden of testCase.forbiddenVisibleSelectors || []) {
          if (await page.locator(forbidden).isVisible()) throw new Error("Forbidden UI visible: " + forbidden);
        }
      }
      result.passed = true;
    } catch (e) {
      failures += 1;
      result.errors.push(e instanceof Error ? e.message : String(e));
      try { await page.screenshot({path:path.join(evidenceDir,safeName+".png"),fullPage:true}); } catch {}
    } finally {
      result.errors.push(...errors.slice(0,12));
      results.push(result);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
const report = { checkedAt:new Date().toISOString(), origin, results, failures };
await fs.writeFile(path.join(evidenceDir,"report.json"),JSON.stringify(report,null,2));
for (const entry of results) console.log(entry.name+": "+(entry.passed?"PASS":"FAIL")+(entry.errors.length?" ("+entry.errors.join("; ").slice(0,400)+")":""));
if (failures) process.exitCode=1;
