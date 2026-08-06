# Vercel Environment Checklist

Set these variables in Vercel Project Settings > Environment Variables for Production. Use the same Supabase project/database as `SSTiPOS`.

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MOBILE_SESSION_SECRET`
- `MOBILE_SESSION_COOKIE_NAME=sstipos_mobile_session`
- `MOBILE_SESSION_TTL_HOURS=12`
- `MOBILE_LOGIN_CONTEXT_TTL_MINUTES=10`
- `AUTH_API_TIMEOUT_MS=8000`
- `RATE_LIMIT_BACKEND=memory`

Optional for production rate limiting:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Do not commit real values. After saving env vars in Vercel, redeploy Production.

Smoke test after redeploy:

1. Open `https://sstiposmobile.vercel.app/login/store`.
2. Enter store code `NDL-TH-001`.
3. Select branch `NDL-ONNUT-01` if branch selection appears.
4. Login with employee code `sst182536`.
5. Select a cashier device.
6. Confirm the open-shift gate appears if no shift is open for that device.
7. Open shift and confirm the `ขาย` menu loads for the selected branch/device.
## Security Note

Do not paste Vercel tokens or secret values into repository files, chat logs, screenshots, or generated documentation.

For this project, env values must be entered manually in Vercel Dashboard by an authorized project owner because these values include `SUPABASE_SERVICE_ROLE_KEY` and `MOBILE_SESSION_SECRET`.

Recommended safe path:

1. Open Vercel Dashboard > `sstiposmobile` > Settings > Environment Variables.
2. Add each required variable above for Production.
3. Confirm values are copied from the same SSTiPOS Supabase project used by the main POS/backoffice app.
4. Redeploy Production after saving env vars.
5. Run the smoke test listed above.

