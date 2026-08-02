#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const WEB_PREFIXES = [
  "apps/backoffice-web/",
  "packages/",
  "supabase/",
  "public/",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "next.config",
  "postcss.config",
  "tailwind.config",
  "tsconfig",
  "vercel.json",
  "scripts/vercel-ignore-build.mjs"
];

const NON_WEB_PREFIXES = [
  "apps/windows-runtime-native/",
  "tools/",
  "docs/",
  ".github/"
];

function log(message) {
  console.log(`[vercel-ignore-build] ${message}`);
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function getChangedFiles() {
  const head = process.env.VERCEL_GIT_COMMIT_SHA || "HEAD";
  let base = "HEAD^";

  try {
    runGit(["rev-parse", "--verify", base]);
  } catch {
    base = `${head}^`;
  }

  try {
    const output = runGit(["diff", "--name-only", base, head]);
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  } catch (error) {
    log(`Cannot read changed files safely: ${error instanceof Error ? error.message : String(error)}`);
    log("Continue Vercel build to avoid accidentally skipping a web deploy.");
    process.exit(1);
  }
}

function startsWithAny(file, prefixes) {
  return prefixes.some((prefix) => file === prefix || file.startsWith(prefix));
}

const files = getChangedFiles();

if (files.length === 0) {
  log("No changed files detected. Continue Vercel build.");
  process.exit(1);
}

log(`Changed files: ${files.join(", ")}`);

const touchesWeb = files.some((file) => startsWithAny(file, WEB_PREFIXES));
const onlyNonWeb = files.every((file) => startsWithAny(file, NON_WEB_PREFIXES));

if (!touchesWeb && onlyNonWeb) {
  log("Only non-web runtime/docs/tooling files changed. Skip Vercel web deploy.");
  process.exit(0);
}

log("Web-relevant files changed or unknown scope. Continue Vercel build.");
process.exit(1);
