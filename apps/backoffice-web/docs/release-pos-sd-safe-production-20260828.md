# POS SD safe production release candidate — 2026-08-28

Base production commit: `b9391a2f49ab97a98a5e56e9a01a6bb97eea37f0`.

This release candidate ports SD / General Sale and its package feature gate onto the exact currently deployed POS production baseline.

Safety boundaries:
- preserve all current production commits;
- no database migration;
- no printer profile, endpoint, assignment or routing-policy mutation;
- no historical print-job requeue;
- no Kitchen/Dine-in/Buffet transaction change;
- SD reuses the existing Home/Takeaway checkout engine;
- package access is fail-closed through `barcode_scanner_mode`.

Validation must pass on the release branch before production promotion.
