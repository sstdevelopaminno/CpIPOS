# FG0004 Trial Rehearsal Report

Date: 2026-08-24
Branch: `prep/fg0004-restaurant-qr-provisioning`
Trial project: `CpiPOS-002` / `kawenyvpentwgugtzqec`
Primary project: `CpiPOS-001` / `deejlitaivfnsbwqdugy` read-only

## Result

FG0004 was provisioned in Trial only as inactive/provisioning:

- Tenant scope: 1
- Branch scope: 1
- Tables: 20, all disabled/inactive
- Printer slots: 2, all disabled
- Runtime Restaurant QR scope: false
- Disposable test residue: 0 print jobs, 0 QR orders

The second provisioning run failed closed without duplicate or partial writes.

## Trial Evidence

- Applied Trial-only migrations:
  - `trial_fg0003_qr_pos_review_lifecycle`
  - `trial_fg0003_cancelled_order_print_claim_guard`
- Disabled/provisioning registry blocks runtime QR enablement.
- QR accept/reject/partial lifecycle passed.
- Cancelled-order print claim guard kept the cancelled job pending.
- Burst 5/10/25/50 logical QR submissions produced matching accepted rows and logical print rows; duplicate QR and print inserts were 0.
- Parallel print claim with five agents and 300-second leases claimed 10 distinct jobs with 10 attempts and 0 duplicate-attempt jobs.
- Expired lease timeout moved a stale print attempt to `expired`, job to `retrying`, and set retry backoff without immediate reclaim.

## Primary Safety

Primary was queried read-only only:

- `app.restaurant_qr_store_registry`: absent
- FG0004 tenant count: 0
- FG0004 branch count: 0
- Recent active print jobs: 0
- FG0004 test print jobs: 0
- Primary migration list does not include the Trial-only rehearsal migrations.