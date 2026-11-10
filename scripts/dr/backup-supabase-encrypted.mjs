/**
 * CpIPOS encrypted offline Supabase application dump.
 * Runs ONLY on a trusted operator's machine. Does not upload anything.
 * Note: Supabase CLI db dump omits managed auth/storage schemas and actual Storage objects.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VALID_REF = /^[a-z0-9]{20}$/;
const AGE_KEY = /^age1[0-9a-z]{40,}$/;

export function parseArgs(argv) {
  const options = { includeData: false, checkOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--include-data") { options.includeData = true; continue; }
    if (key === "--check-only") { options.checkOnly = true; continue; }
    if (["--project-ref","--output-dir","--recipient"].includes(key)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("Missing value for " + key);
      const name = {"--project-ref":"projectRef","--output-dir":"outputDir","--recipient":"recipient"}[key];
      if (options[name] !== undefined) throw new Error("Duplicate option: " + key);
      options[name] = argv[++i];
      continue;
    }
    throw new Error("Unsupported option: " + key);
  }
  return options;
}

export function verifyProjectUrl(dbUrl, expectedRef) {
  if (!VALID_REF.test(expectedRef ?? "")) throw new Error("Expected 20-character Supabase project reference.");
  let url;
  try { url = new URL(dbUrl); } catch { throw new Error("CPI_DR_SUPABASE_DB_URL must be a database URI."); }
  if (!["postgres:","postgresql:"].includes(url.protocol)) throw new Error("Database URI must use PostgreSQL.");
  const host = url.hostname.toLowerCase();
  const user = decodeURIComponent(url.username);
  const directRef = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host)?.[1];
  const poolerRef = host.endsWith(".pooler.supabase.com") ? /^postgres\.([a-z0-9]{20})$/.exec(user)?.[1] : null;
  if ((directRef || poolerRef) !== expectedRef) {
    throw new Error("Refusing DB connection: direct host or session-pooler username does not match --project-ref.");
  }
  if (!url.password) throw new Error("Database URI must include a password (not printed).");
  if (url.searchParams.get("sslmode") !== "require" && url.searchParams.get("sslmode") !== "verify-full") {
    url.searchParams.set("sslmode","require");
  }
  return url.toString();
}

export function assertBackupDestination(destination, checkoutRoot = ROOT) {
  if (!destination || !isAbsolute(destination)) throw new Error("--output-dir must be an absolute directory outside the Git repository.");
  const normalized = resolve(destination);
  const diff = relative(resolve(checkoutRoot), normalized);
  if (!diff || (!diff.startsWith(".." + sep) && diff !== ".." && !isAbsolute(diff))) {
    throw new Error("Cannot put customer backups anywhere inside this Git checkout.");
  }
  return normalized;
}

async function command(bin, args) {
  return await new Promise((res, rej) => {
    const proc = spawn(bin, args, { stdio:"ignore", shell:false, windowsHide:true });
    proc.once("error", err => rej(new Error("Required tool unavailable: " + bin + " (" + (err.code || "spawn") + ")")));
    proc.once("close", code => code === 0 ? res() : rej(new Error(bin + " failed with exit code " + code + ". No connection string or SQL content is logged.")));
  });
}

async function waitClose(proc, program) {
  return await new Promise((res, rej) => {
    proc.once("error", err => rej(new Error(program + " failed to start (" + (err.code || "spawn") + ")")));
    proc.once("close", code => code === 0 ? res() : rej(new Error(program + " exited " + code)));
  });
}

async function encryptArchive(directory, names, encryptedPath, recipient) {
  // tar streams directly into age. No unencrypted tar file is ever stored.
  const tar = spawn("tar", ["-C", directory, "-czf", "-", ...names], {
    stdio:["ignore","pipe","ignore"], shell:false, windowsHide:true
  });
  const age = spawn("age", ["-r", recipient, "-o", encryptedPath], {
    stdio:["pipe","ignore","ignore"], shell:false, windowsHide:true
  });
  age.stdin.on("error", () => {}); // Handles EPIPE if age exits before tar.
  tar.stdout.pipe(age.stdin);
  await Promise.all([waitClose(tar,"tar"), waitClose(age,"age")]);
}

async function digest(filepath) {
  return await new Promise((res,rej) => {
    const hash=createHash("sha256");
    const reader=createReadStream(filepath);
    reader.on("error",rej);
    reader.on("data",chunk=>hash.update(chunk));
    reader.on("end",()=>res(hash.digest("hex")));
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.checkOnly) {
    await Promise.all([command("supabase",["--version"]),command("age",["--version"]),command("tar",["--version"])]);
    console.log("PREREQUISITES_OK. This preflight made no database connection or backup.");
    return;
  }
  if (!opts.projectRef || !opts.outputDir) throw new Error("Required: --project-ref and --output-dir");
  const recipient = opts.recipient || process.env.CPI_DR_AGE_RECIPIENT;
  if (!AGE_KEY.test(recipient ?? "")) throw new Error("Set CPI_DR_AGE_RECIPIENT or --recipient to an age public key.");
  const dbUri = verifyProjectUrl(process.env.CPI_DR_SUPABASE_DB_URL, opts.projectRef);
  const outputDir = assertBackupDestination(opts.outputDir);
  await Promise.all([command("supabase",["--version"]),command("age",["--version"]),command("tar",["--version"])]);
  await mkdir(outputDir,{recursive:true,mode:0o700});
  const actualOutput=await realpath(outputDir);
  assertBackupDestination(actualOutput);
  await chmod(actualOutput,0o700).catch(()=>{}); // Windows ACLs need owner-level controls separately.

  const date = new Date().toISOString().replace(/[-:]/g,"").replace(/\..*/,"Z");
  const base = "cpipos-" + opts.projectRef + "-" + date + (opts.includeData ? "-app-data" : "-schema-only");
  const target = join(actualOutput,base + ".tar.gz.age");
  const manifestFile = join(actualOutput,base + ".manifest.json");
  let scratch;
  let completed = false;
  try {
    scratch=await mkdtemp(join(tmpdir(),"cpipos-dr-"));
    await chmod(scratch,0o700).catch(()=>{});
    const files=[
      {name:"roles.sql",options:["--role-only"]},
      {name:"schema.sql",options:[]}
    ];
    if (opts.includeData) files.push({name:"data.sql",options:["--data-only","--use-copy"]});
    for (const file of files) {
      // The connection URI is passed to the CLI process only and NEVER written to logs or source.
      // Running on a trusted, encrypted workstation is essential: temporary .sql files are plaintext.
      await command("supabase",["db","dump","--db-url",dbUri,"-f",join(scratch,file.name),...file.options]);
      const details=await stat(join(scratch,file.name));
      if (details.size===0) throw new Error(file.name + " is empty; backup is incomplete.");
    }
    await encryptArchive(scratch,files.map(f=>f.name),target,recipient);
    const encrypted = await stat(target);
    if (encrypted.size < 64) throw new Error("Encrypted archive unexpectedly small.");
    const header=(await readFile(target)).subarray(0,25).toString("utf8");
    if (!header.startsWith("age-encryption.org/v1")) throw new Error("Encrypted output is not an age v1 file.");
    const manifest={
      projectRef:opts.projectRef,
      createdAt:new Date().toISOString(),
      type:opts.includeData?"application-schema-and-data":"application-schema-only",
      includes:files.map(f=>f.name),
      excludes:["Supabase-managed auth/storage schemas","Storage object bytes","external payment/provider credentials","separate projects"],
      archive:base + ".tar.gz.age",
      sizeBytes:encrypted.size,
      sha256:await digest(target),
      restoresTested:false
    };
    await writeFile(manifestFile,JSON.stringify(manifest,null,2)+"\n",{mode:0o600,flag:"wx"});
    completed=true;
    console.log("BACKUP_ENCRYPTED_CREATED: " + target);
    console.log("SHA256: " + manifest.sha256);
    console.log("MODE: " + manifest.type);
    console.log("RESTORE_VERIFIED: NO. Verify decryption and restore into an isolated test database.");
    console.log("Copy encrypted archive and manifest to an owner-controlled offline/offsite destination.");
  } finally {
    if (scratch) await rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:200});
    if (!completed) {
      await rm(target,{force:true}).catch(()=>{});
      await rm(manifestFile,{force:true}).catch(()=>{});
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error("BACKUP_FAILED: " + err.message); process.exitCode=1; });
}
