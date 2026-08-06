# Security Checklist

- [x] `.env.example` contains placeholder names only.
- [x] Service role client is server-only.
- [x] HttpOnly mobile session cookie scaffolded.
- [x] Zod request validation added.
- [x] Generic Thai auth errors added.
- [x] Basic rate limiter scaffolded.
- [x] PWA cache excludes login/auth/session/mobile APIs.
- [x] DB-backed login context integrated with `pos_login_contexts`.
- [x] Employee-code-only verification is server-side against branch membership and `pos_user_profiles`.
- [x] Cashier device selection is server-side against `branch_devices` before `pos_sessions` creation.
- [x] Dashboard and shift APIs scope open-shift checks by tenant, branch, and selected `device_code`.
- [x] Add server-side feature resolver for mobile menu/package metadata.
- [ ] Enforce package feature checks on every protected paid route/API before enabling new paid features.
