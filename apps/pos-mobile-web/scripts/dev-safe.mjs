import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const nextBin = resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const nextDir = resolve(process.cwd(), ".next");
const restartPatterns = [
  /segment-explorer-node/i,
  /SegmentViewNode/i,
  /React Client Manifest/i,
  /__webpack_modules__\s*\[moduleId\]\s*is not a function/i,
  /Cannot read properties of undefined \(reading '\/_app'\)/i,
  /Cannot find module '\.\/\d+\.js'/i,
  /fallback-build-manifest\.json/i,
  /ENOENT.*\.next/i,
  /MODULE_NOT_FOUND/i,
];

let child;
let restartTimer;
let restartCount = 0;
let stopping = false;

function clearNextCache(reason) {
  try {
    rmSync(nextDir, { recursive: true, force: true });
    console.log(`[dev-safe] cleared .next cache${reason ? ` after ${reason}` : ""}`);
  } catch (error) {
    console.warn("[dev-safe] could not clear .next cache:", error instanceof Error ? error.message : error);
  }
}

function shouldRestart(chunk) {
  return restartPatterns.some((pattern) => pattern.test(chunk));
}

function scheduleRestart(reason) {
  if (stopping || restartTimer) return;
  restartCount += 1;
  console.warn(`[dev-safe] detected unstable Next dev cache (${reason}); restarting dev server...`);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    if (child && !child.killed) child.kill("SIGTERM");
    clearNextCache(reason);
    start();
  }, 600);
}

function start() {
  child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout.on("data", (data) => {
    const text = data.toString();
    process.stdout.write(text);
    if (shouldRestart(text)) scheduleRestart("stdout manifest error");
  });

  child.stderr.on("data", (data) => {
    const text = data.toString();
    process.stderr.write(text);
    if (shouldRestart(text)) scheduleRestart("stderr manifest error");
  });

  child.on("exit", (code, signal) => {
    if (stopping || restartTimer) return;
    if (code && restartCount < 3) {
      scheduleRestart(`exit ${code}${signal ? `/${signal}` : ""}`);
    }
  });
}

process.on("SIGINT", () => {
  stopping = true;
  if (child && !child.killed) child.kill("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopping = true;
  if (child && !child.killed) child.kill("SIGTERM");
  process.exit(0);
});

clearNextCache();
start();
