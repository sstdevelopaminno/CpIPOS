import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".kt", ".kts", ".sql", ".yml", ".yaml", ".css"]);
const forbiddenMojibake = ["\uFFFD", "ï¿½", "â€”", "â€“", "â€™", "à¸", "à¹", "โ€”"];

function collectTextFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return textExtensions.has(extname(path)) ? [path] : [];

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".next", ".turbo", ".git", "build", "dist"].includes(entry.name)) return [];
    return collectTextFiles(resolve(path, entry.name));
  });
}

describe("UTF-8 text integrity", () => {
  it("does not contain common mojibake markers in user-facing source and project documentation", () => {
    const roots = [
      resolve(repoRoot, "README.md"),
      resolve(repoRoot, "AGENTS.md"),
      resolve(repoRoot, "docs"),
      resolve(repoRoot, "apps/backoffice-web/src"),
      resolve(repoRoot, "apps/backoffice-web/docs"),
      resolve(repoRoot, "apps/pos-android/app/src/main")
    ];

    const failures: string[] = [];
    for (const file of roots.flatMap(collectTextFiles)) {
      const text = readFileSync(file, "utf8");
      for (const marker of forbiddenMojibake) {
        if (text.includes(marker)) {
          failures.push(`${file.replace(`${repoRoot}/`, "")}: ${JSON.stringify(marker)}`);
        }
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });
});
