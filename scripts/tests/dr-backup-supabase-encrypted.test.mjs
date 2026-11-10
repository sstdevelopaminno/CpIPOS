import {test} from "node:test";
import assert from "node:assert/strict";
import {parseArgs, verifyProjectUrl, assertBackupDestination} from "../dr/backup-supabase-encrypted.mjs";

const ref="deejlitaivfnsbwqdugy";
test("parse explicit offline and include-data options",()=>{
 const p=parseArgs(["--project-ref",ref,"--output-dir","/backup","--include-data","--recipient","age1abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnop"]);
 assert.equal(p.includeData,true);
 assert.equal(p.projectRef,ref);
 assert.equal(p.outputDir,"/backup");
 assert.throws(()=>parseArgs(["--secret","oops"]),/Unsupported/);
 assert.throws(()=>parseArgs(["--output-dir"]),/Missing/);
});

test("validate only explicit Supabase project (including pooler username)",()=>{
 const direct="postgresql://postgres:secret@db."+ref+".supabase.co:5432/postgres";
 const pool="postgresql://postgres."+ref+":secret@aws-0-ap-south-1.pooler.supabase.com:5432/postgres";
 assert.match(verifyProjectUrl(direct,ref),/sslmode=require/);
 assert.match(verifyProjectUrl(pool,ref),/sslmode=require/);
 assert.throws(()=>verifyProjectUrl(direct,"wznixoeezgyhtwurcswb"),/Refusing/);
 assert.throws(()=>verifyProjectUrl("postgres://postgres:secret@localhost:5432/postgres",ref),/Refusing/);
 assert.throws(()=>verifyProjectUrl("https://db."+ref+".supabase.co",ref),/PostgreSQL/);
 assert.throws(()=>verifyProjectUrl("postgres://postgres@db."+ref+".supabase.co/postgres",ref),/password/);
});

test("refuse backups inside the Git repository",()=>{
 assert.throws(()=>assertBackupDestination("/work/CpIPOS/backups","/work/CpIPOS"),/inside/);
 assert.throws(()=>assertBackupDestination("/work/CpIPOS","/work/CpIPOS"),/inside/);
 assert.equal(assertBackupDestination("/secure/offsite","/work/CpIPOS"),"/secure/offsite");
 assert.throws(()=>assertBackupDestination("relative/path","/work/CpIPOS"),/absolute/);
});
