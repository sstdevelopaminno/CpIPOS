import { renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const nextDir = resolve(process.cwd(), ".next");

try {
  rmSync(nextDir, { recursive: true, force: true });
  console.log("[dev] cleared .next cache");
} catch (error) {
  const staleDir = resolve(process.cwd(), `.next-stale-${Date.now()}`);
  try {
    renameSync(nextDir, staleDir);
    console.log(`[dev] moved locked .next cache to ${staleDir}`);
  } catch {
    console.warn("[dev] could not clear .next cache:", error instanceof Error ? error.message : error);
  }
}
