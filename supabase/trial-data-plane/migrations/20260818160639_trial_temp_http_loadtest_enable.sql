-- Historical migration marker for the 2026-08-18 Trial-only concurrency test.
-- The live Trial database temporarily enabled the `http` extension so PostgreSQL
-- could invoke an isolated Edge load runner. Test infrastructure was removed in
-- migration 20260818163707. Fresh environments intentionally do not enable it.

select 1;
