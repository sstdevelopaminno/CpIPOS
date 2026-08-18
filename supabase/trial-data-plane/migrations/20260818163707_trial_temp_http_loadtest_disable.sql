-- Ensure the temporary Trial-only HTTP extension used by the concurrency
-- harness is absent from steady-state environments.

drop extension if exists http;
