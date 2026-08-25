import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const source = resolve(appRoot, "../backoffice-web/public/brand/cpipos-symbol-transparent.png");
const target = resolve(appRoot, "public/brand/cpipos-symbol.png");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log("[it-admin] synced CpIPOS brand PNG");
