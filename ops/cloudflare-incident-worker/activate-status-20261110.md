# One-time Cloudflare Status deployment activation — 2026-11-10

Approved by the account operator in the urgent CpiPOS outage recovery chat.

Deploy ONLY the independent incident status Worker `cpi-incident-status` to a `*.workers.dev` hostname via GitHub Actions once this marker lands on main.

The workflow uses repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` that the operator stated were replaced/added.

No POS runtime deployment, production database access, DNS change, domain reassignment, paid hosting plan or live customer traffic is authorized by this marker.

After deployment, check actual job logs and workers.dev HTTP status; do not claim that POS has been recovered based on status page success.
