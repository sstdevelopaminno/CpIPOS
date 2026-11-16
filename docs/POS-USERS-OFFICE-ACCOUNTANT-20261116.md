# POS user form — Office Accountant (2026-11-16)

This patch follows POS Finance PR #477 and the linked IT PR #211.

## New form behavior
- Select **บัญชี / Accountant** in ผู้ใช้งาน POS. The branch field becomes
  **all active store branches (automatic)** rather than a selection.
- The device scope shows **office-only / not bound to POS terminal**.
  No select-device input appears. The role cannot enter POS sales or open a shift.
- Employee code must be explicitly numeric, unique within the tenant. Set 4–8 digit
  employee PIN and use authorized owner/manager approval PIN when creating.
- Existing role changes into/out of office Accountant must use a separate user
  account: no silent conversion of cashiers/managers/owners.
- Editing an existing accountant re-grants the role across all *currently active*
  branches; removing Accountant from POS removes all branch assignments in this tenant.

## Backend contract
- Only the authenticated owner can create or edit POS users.
- All active branch IDs are loaded from the authoritative server-side tenant ID,
  not from the client's branch/device fields. A single bulk role upsert gives the
  accountant the same role for each active branch.
- No `pos_user_device_scopes` rows are added for office accountants.
  A backend check explicitly rejects `set_device_scope` for that role.
- Separate Finance session must recheck all branch grants on each sensitive use.
  This is **not** an all-device cashier permission.
- A later-created branch requires a re-sync by editing Accountant or a separate
  approved automatic provisioning workflow. Until then all-branch finance login
  fails closed rather than showing incomplete records.
- No production database data was changed by preparing this PR.

## Main Finance menu finding
- CpiPOS-001 live tenant `NDL-TH-001` currently has an active Business contract
  and unlocked subscription runtime; `main.finance` has no explicit IT denial.
- At inspection, Vercel production `cp-ipos-web` pointed to Git commit
  `a8f121c0db3a1226fe684e3359c490014b122fa2` (`main`). It does
  **not** contain PR #477's Finance menu.
- Once tested/merged/deployed, Finance appears for verified owner with
  Business/CUSTOM entitlement. No need to change package price or access.
- Until release, user-facing live POS will not show it; keep the current draft
  separate from production for security UAT.
