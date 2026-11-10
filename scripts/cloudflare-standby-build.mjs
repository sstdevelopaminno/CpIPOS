// Build-only compatibility bridge for OpenNext on Next.js 16.
// Keep the committed Vercel Node proxy untouched; temporarily use the
// equivalent Edge middleware convention only inside the Cloudflare build.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = join(root, "apps", "backoffice-web", "src");
const proxyFile = join(appSrc, "proxy.ts");
const edgeFile = join(appSrc, "middleware.ts");

export function proxyToEdgeMiddleware(code) {
  const anchor = "export async function proxy(request: NextRequest)";
  if (typeof code !== "string" || code.split(anchor).length !== 2) {
    throw new Error("Proxy function does not match the reviewed entry point; refuse an unsafe Cloudflare build.");
  }
  if (!code.includes("export const config =") || !code.includes("POS_BACKOFFICE_AUTH_COMPAT_PATHS")) {
    throw new Error("Reviewed POS auth proxy/matcher missing; refuse Cloudflare build.");
  }
  return code.replace(anchor, "export async function middleware(request: NextRequest)");
}

async function main() {
  if (existsSync(edgeFile)) throw new Error("middleware.ts already exists: refusing to overwrite it");
  const source = await readFile(proxyFile, "utf8");
  const edge = proxyToEdgeMiddleware(source);
  // Local workspace mutation lasts only during this build, never a Git commit.
  // Both files must not exist simultaneously, or Next.js rejects the build.
  await writeFile(edgeFile, edge, { flag: "wx" });
  try {
    await unlink(proxyFile);
    try {
      const executable = process.platform === "win32" ? "corepack.cmd" : "corepack";
      const result = spawnSync(executable, ["pnpm", "--filter", "backoffice-web", "cf:build"], {
        cwd: root,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        stdio: "inherit"
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Cloudflare OpenNext build failed: ${result.signal || result.status}`);
    } finally {
      await writeFile(proxyFile, source);
    }
  } finally {
    await unlink(edgeFile);
  }
  console.log("Cloudflare build generated; original Vercel proxy.ts restored. No deployment performed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
