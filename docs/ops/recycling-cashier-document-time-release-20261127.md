# Recycling cashier document time — targeted production migration
- PR #573, CI #3855 and isolated PostgreSQL UAT #283 passed. Candidate SQL at `docs/ops/recycling-cashier-document-time-candidate.sql`.
- On 2026-11-27, applied only the additive, service-role-only wrapper to CpiPOS-001 via migration `20261127040113 recycling_cashier_document_time` (with bounded lock/statement timeouts). No historical migrations replayed or migration history repaired.
- Compared the live canonical posting body with source `20261126054220_recycling_extra_count_units.sql` plus all five exact substitutions from `20261126055219_recycling_custom_price_units.sql`; matched after whitespace normalization. Live correction body also matched `20261126160000_recycling_direct_document_time.sql`.
- Catalog confirmed required tables/columns and service role grants; after installation wrapper is SECURITY INVOKER; anon/authenticated execute denied, service role execute allowed; per-branch opt-in guard present.
- No existing business transactions, stock, money, VAT or GL entries modified. Full migration history reconciliation remains separate.
- Default OFF per branch; authorized owners/managers may enable for actual historical transactions only. No future dates, locked periods, posted VAT/GL or alteration of actual posting or shift timestamps. Authenticated cashier and physical print UAT still required.
