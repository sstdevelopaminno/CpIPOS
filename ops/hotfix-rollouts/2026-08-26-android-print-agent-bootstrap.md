# Android Print Agent bootstrap hotfix rollout

Production rollout marker for the idempotent Android Print Agent bootstrap fix.

Source fix commit: bf632f857d6153fc79dc3d672a3d858d6c8ee6ab
Incident: duplicate unique-key failures on /api/android-pos/print-agent/bootstrap.
Scope: bootstrap idempotency only; no payment, QR, kitchen, shift, or transaction logic changes.
