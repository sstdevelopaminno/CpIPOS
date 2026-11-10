# CpiPOS — operator-run encrypted offline Supabase backup kit

**Status:** prepared and CI-tested on fake values, **no real customer database has been exported**.

## Why this exists
Vercel Pro is the current primary, Cloudflare Workers the future backup web/API runtime. Supabase organisation is still Free and has two active databases. Supabase Free does not provide automatic daily backups. A second web/API server **does not** protect against Supabase data loss.

Production project to back up first: `CpiPOS-001`, ref `deejlitaivfnsbwqdugy`. The `CpiPOS-Communications` project is separate and must have its own backup if its contents are mission-critical.

## Prerequisites (trusted Windows machine)
- Install the official Supabase CLI, Docker Desktop, the official `age` encryption utility and the system `tar.exe`. Confirm `supabase --version`, `age --version`, `tar --version` each works in PowerShell. Always consult `supabase db dump --help` for currently installed CLI flags.
- Prepare a private `age` key pair on **an owner-controlled computer** (e.g., `age-keygen -o <owner-only-location>`). Store the *private* key offline; do not upload it to GitHub, Vercel, Cloudflare, or this chat. Share only the `age1...` public **recipient** in the local session.
- Use a BitLocker-encrypted drive and an owner-only output directory **outside the Git checkout**. During the dump, SQL temporary files are plaintext in the machine's temp directory; automatic deletion after completion is not secure erasure on SSDs. Use a trusted encrypted workstation, not a shared runner.
- Supabase Database dashboard > **Connect**: copy the direct or session-pooler Postgres connection URI with the password and TLS enabled. Run in a private PowerShell terminal; the URI is temporarily passed as a CLI child-process argument and may be visible to administrators/process inspection. No password is to be pasted into ChatGPT or GitHub.
- Prefer an off-peak maintenance window, as consistent logical dumps can consume database CPU/IO. Do not rotate production password or change clients just to run a backup.

## How to run from the CpIPOS repository (PowerShell)
```powershell
# Check local tools; no database access:
node scripts/dr/backup-supabase-encrypted.mjs --check-only

# In a private terminal on an encrypted Windows computer:
$env:CPI_DR_SUPABASE_DB_URL = '<connection-uri-from-Supabase-Connect>'
$env:CPI_DR_AGE_RECIPIENT = '<age-public-recipient>'

# First inspect a schema-only encrypted snapshot (no tenant rows):
node scripts/dr/backup-supabase-encrypted.mjs --project-ref deejlitaivfnsbwqdugy --output-dir 'D:\\CpiPOS-Private-DR'

# Only when an authorised custodian is ready to handle sensitive customer records:
node scripts/dr/backup-supabase-encrypted.mjs --project-ref deejlitaivfnsbwqdugy --output-dir 'D:\\CpiPOS-Private-DR' --include-data

# Clear session secret after completion:
Remove-Item Env:\\CPI_DR_SUPABASE_DB_URL
```

The script refuses the wrong project reference, untrusted hostnames, a missing encryption recipient, and output paths within the Git checkout. It creates `*.tar.gz.age` plus a **non-sensitive** JSON SHA-256 manifest. It automatically removes plaintext temp SQL files after exit where possible. No scheduled cloud jobs, files in GitHub or paid branches are created.

### What is NOT backed up by these dumps
Supabase CLI `db dump` is a logical dump with Supabase-specific exclusions. It omits Supabase-managed `auth` and `storage` schemas by default, even with `--include-data`, and never includes uploaded Storage object bytes. It is **not** a complete disaster-recovery copy of customer accounts, media, Edge Functions, credentials or external payment systems. Supabase docs: https://supabase.com/docs/reference/cli/supabase-db-dump and https://supabase.com/docs/guides/platform/backups .

## Proof-of-integrity and recovery validation
1. Copy **only** the encrypted `*.age` file and JSON manifest to a second owner-controlled/offline location. Keep a second copy in a different failure domain.
2. On an **isolated trusted restore computer** with the private key, list archive contents without writing plaintext to disk: `age -d -i <private-key-file> <backup.tar.gz.age> | tar -tzf -`.
3. Compare the encrypted archive's SHA-256 with the manifest (`Get-FileHash -Algorithm SHA256 <path>` in PowerShell).
4. For a true DR test, restore schema and application data to an **isolated test database**, not an active customer project. Confirm tenancy/RLS, transaction integrity, and required functions. Do NOT restore directly into `CpiPOS-001`.
5. Restore test must separately cover Supabase Auth, Storage object bytes, custom database roles/privileges, Realtime, payment callbacks, and service credentials. A successful archive integrity check is **not** a restore test.
6. Record backup timestamp, archive SHA-256, copy location, independent restore results, RPO/RTO, and owner. Do not put personal data or private-key locations in GitHub Issues.

## Non-goals / limitations
No production schema changes, no remote mutation, no Cloudflare failover, no DNS switch, no Pro/Cloudflare/Supabase plan purchase. This kit is **manual** until encryption key custody, retention, remote destination and restore are reviewed. The known #455 migration drift blocks reconstruction from repository migrations alone.
