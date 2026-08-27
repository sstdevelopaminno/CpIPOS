# POS SD safe production release candidate — 2026-08-28

Deployed production baseline: `b9391a2f49ab97a98a5e56e9a01a6bb97eea37f0`.
Current production branch sync included: `a10d5e38eada4d17e115b763b204ec224fd51b56` (`fix(i18n): recover Thai mojibake system-wide`).

This release candidate ports SD / General Sale and its package feature gate onto the deployed POS production baseline, then synchronizes the single newer production-branch Thai rendering repair before final validation.

Safety boundaries:
- preserve all current production-branch commits;
- no database migration;
- no printer profile, endpoint, assignment or strict routing-policy mutation;
- no historical print-job requeue;
- no Kitchen/Dine-in/Buffet transaction change;
- SD reuses the existing Home/Takeaway checkout engine;
- package access is fail-closed through `barcode_scanner_mode`.

Final CI, Android and Vercel Preview validation must pass on the exact post-sync release head before production promotion.
