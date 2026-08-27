import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const thisFile = resolve(process.cwd(), "tests/unit/text-encoding-mojibake-regression.test.ts");
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".kt",
  ".kts",
  ".java",
  ".sql",
  ".yml",
  ".yaml",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".sh",
  ".ps1",
  ".bat",
  ".cmd",
  ".properties",
  ".toml"
]);
const textFileNames = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".env.example",
  "Dockerfile"
]);
const ignoredDirectories = new Set([
  "node_modules",
  ".next",
  ".turbo",
  ".git",
  ".gradle",
  ".idea",
  ".vercel",
  "build",
  "dist",
  "coverage",
  "out",
  "target"
]);
const forbiddenMojibake = [
  "\uFFFD",
  "ï¿½",
  "â€”",
  "â€“",
  "â€™",
  "à¸",
  "à¹",
  "โ€”",
  "โ€“",
  "เน€",
  "เธฃเธ",
  "เธ",
  "เน",
  "ร—"
];
const forbiddenControlChars = /[\u0080-\u009F]/;

function isTextFile(path: string) {
  return textExtensions.has(extname(path).toLowerCase()) || textFileNames.has(basename(path));
}

function collectTextFiles(path: string): string[] {
  if (path === thisFile) return [];

  const stat = statSync(path);
  if (stat.isFile()) return isTextFile(path) ? [path] : [];

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
    return collectTextFiles(resolve(path, entry.name));
  });
}

describe("UTF-8 text integrity", () => {
  it("does not contain common mojibake or invalid C1 controls in repository text", () => {
    const failures: string[] = [];

    for (const file of collectTextFiles(repoRoot)) {
      const text = readFileSync(file, "utf8");
      const repoPath = relative(repoRoot, file).replaceAll("\\", "/");

      for (const marker of forbiddenMojibake) {
        if (text.includes(marker)) {
          failures.push(`${repoPath}: ${JSON.stringify(marker)}`);
        }
      }

      if (forbiddenControlChars.test(text)) {
        failures.push(`${repoPath}: C1 control character`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });
});
