# CpIPOS IT Admin deployment contract

- Vercel project: `cp-ipos-it-admin-web`
- Root Directory: `apps/it-admin-web`
- Production Branch: `it-admin/main`
- IT login route: `/it-admin-login`
- Legacy `/login/store` redirects to `/it-admin-login` inside the IT app.
- This app is isolated from POS runtime routes and must be deployed independently of `cp-ipos-web`.
