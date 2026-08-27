import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

const ROOT = process.cwd();
const SELF = path.resolve(ROOT, "scripts/repair-repository-mojibake.mjs");
const TEST_GUARD = path.resolve(ROOT, "apps/backoffice-web/tests/unit/text-encoding-mojibake-regression.test.ts");
const EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt",
  ".kt", ".kts", ".java", ".sql", ".yml", ".yaml", ".css", ".scss", ".html",
  ".xml", ".sh", ".ps1", ".bat", ".cmd", ".properties", ".toml"
]);
const FILE_NAMES = new Set([".editorconfig", ".gitattributes", ".gitignore", ".npmrc", ".nvmrc", ".env.example", "Dockerfile"]);
const IGNORED_DIRS = new Set(["node_modules", ".next", ".turbo", ".git", ".gradle", ".idea", ".vercel", "build", "dist", "coverage", "out", "target"]);

const WINDOWS_1252_BYTES = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f]
]);

const decoder = new TextDecoder("utf-8", { fatal: true });
const quotedTokenPattern = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

function legacyByte(codePoint) {
  if (codePoint <= 0x9f) return codePoint;
  if (codePoint === 0x00a0) return 0xa0;
  if (codePoint >= 0x0e01 && codePoint <= 0x0e5b) {
    const byte = codePoint - 0x0d60;
    return byte >= 0xa1 && byte <= 0xfb ? byte : null;
  }
  return WINDOWS_1252_BYTES.get(codePoint) ?? null;
}

function suspiciousScore(value) {
  let score = 0;
  for (const pattern of ["เธ", "เน€", "โ€", "ร—", "ยท", "â€", "à¸", "à¹"]) {
    let index = 0;
    while ((index = value.indexOf(pattern, index)) !== -1) {
      score += pattern === "เธ" ? 1 : 3;
      index += pattern.length;
    }
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? -1;
    if ((codePoint >= 0x80 && codePoint <= 0x9f) || codePoint === 0x00a0 || WINDOWS_1252_BYTES.has(codePoint)) score += 2;
  }
  return score;
}

function repairWhole(value) {
  const beforeScore = suspiciousScore(value);
  if (beforeScore === 0) return value;
  const bytes = [];
  for (const character of value) {
    const byte = legacyByte(character.codePointAt(0) ?? -1);
    if (byte === null) return value;
    bytes.push(byte);
  }
  let decoded;
  try {
    decoded = decoder.decode(Uint8Array.from(bytes));
  } catch {
    return value;
  }
  if (!decoded || decoded === value || decoded.includes("�")) return value;
  if (suspiciousScore(decoded) >= beforeScore) return value;
  return decoded;
}

function repairLine(line) {
  const whole = repairWhole(line);
  if (whole !== line) return whole;
  return line.replace(quotedTokenPattern, (token) => repairWhole(token));
}

function isTextFile(filePath) {
  return EXTENSIONS.has(path.extname(filePath).toLowerCase()) || FILE_NAMES.has(path.basename(filePath));
}

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, output);
    else if (entry.isFile() && isTextFile(fullPath) && fullPath !== SELF && fullPath !== TEST_GUARD) output.push(fullPath);
  }
  return output;
}

const LEGACY_FRONT = "\u0e40\u0e18\u0e0b\u0e40\u0e18\u0099\u0e40\u0e19\u0089\u0e40\u0e18\u0e12\u0e40\u0e18\u0082\u0e40\u0e18\u0e12\u0e40\u0e18\u0e02";
const LEGACY_HISTORY = "\u0e40\u0e19\u0083\u0e40\u0e18\u009a\u0e40\u0e19\u20ac\u0e40\u0e18\u0e0a\u0e40\u0e18\u0e03\u0e40\u0e19\u0087\u0e40\u0e18\u0088\u0e40\u0e18\u0e02\u0e40\u0e19\u0089\u0e40\u0e18\u0e0d\u0e40\u0e18\u0099\u0e40\u0e18\u0e0b\u0e40\u0e18\u0e05\u0e40\u0e18\u0e11\u0e40\u0e18\u0087";
const LEGACY_FRONT_SOURCE = "\\u0e40\\u0e18\\u0e0b\\u0e40\\u0e18\\u0099\\u0e40\\u0e19\\u0089\\u0e40\\u0e18\\u0e12\\u0e40\\u0e18\\u0082\\u0e40\\u0e18\\u0e12\\u0e40\\u0e18\\u0e02";
const LEGACY_HISTORY_SOURCE = "\\u0e40\\u0e19\\u0083\\u0e40\\u0e18\\u009a\\u0e40\\u0e19\\u20ac\\u0e40\\u0e18\\u0e0a\\u0e40\\u0e18\\u0e03\\u0e40\\u0e19\\u0087\\u0e40\\u0e18\\u0088\\u0e40\\u0e18\\u0e02\\u0e40\\u0e19\\u0089\\u0e40\\u0e18\\u0e0d\\u0e40\\u0e18\\u0099\\u0e40\\u0e18\\u0e0b\\u0e40\\u0e18\\u0e05\\u0e40\\u0e18\\u0e11\\u0e40\\u0e18\\u0087";

let changedFiles = 0;
let changedLines = 0;
for (const filePath of walk(ROOT)) {
  const original = fs.readFileSync(filePath, "utf8");
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const sourceLines = original.split(/\r?\n/);
  let fileChangedLines = 0;
  const repairedLines = sourceLines.map((line) => {
    let prepared = line;
    if (filePath.endsWith("receipt-html-template.ts") || filePath.endsWith("receipt-html-template.test.ts")) {
      prepared = prepared.replaceAll(LEGACY_FRONT, LEGACY_FRONT_SOURCE).replaceAll(LEGACY_HISTORY, LEGACY_HISTORY_SOURCE);
    }
    const repaired = repairLine(prepared);
    if (repaired !== line) fileChangedLines += 1;
    return repaired;
  });
  if (fileChangedLines === 0) continue;
  fs.writeFileSync(filePath, repairedLines.join(newline), "utf8");
  changedFiles += 1;
  changedLines += fileChangedLines;
  console.log(`${path.relative(ROOT, filePath)}: repaired ${fileChangedLines} line(s)`);
}

console.log(`Repository mojibake repair: ${changedFiles} file(s), ${changedLines} line(s) changed.`);
