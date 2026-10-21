import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const api = resolve(process.cwd(), "src/app/api");
const authPaths = [
  "auth/store-code/verify/route.ts",
  "auth/register-user/verify/route.ts",
  "auth/employee/verify-code/route.ts",
  "store/login-context/route.ts"
] as const;

describe("POS login distributed rate-limit fail-closed policy", () => {
  for (const relativePath of authPaths) {
    it(`${relativePath} never falls back to per-instance memory when Upstash is configured but unavailable`, () => {
      const code = readFileSync(resolve(api, relativePath), "utf8");
      expect(code).toContain("enforceRateLimit({");
      expect(code).toContain("failClosedOnBackendError: true");
    });
  }

  it("preserves the standalone memory backend until explicitly configured", () => {
    const rateLimit = readFileSync(resolve(process.cwd(), "src/lib/server/rate-limit.ts"), "utf8");
    expect(rateLimit).toContain('const DEFAULT_BACKEND: RateLimitBackend = "memory"');
    expect(rateLimit).toContain('if (process.env.NODE_ENV !== "production") return false;');
    expect(rateLimit).toContain('if (!input.failClosedOnBackendError) return false;');
    expect(rateLimit).toContain('return resolveBackend() !== "memory";');
  });
});
