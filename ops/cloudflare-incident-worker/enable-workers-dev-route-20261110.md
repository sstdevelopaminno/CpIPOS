# Enable cpi-incident-status workers.dev URL (single purpose)
The operator confirmed the Worker's Production deployment exists but the workers.dev route displays Disabled and No URLs enabled in Cloudflare.
This marker triggers a one-time scoped API action on merge to main. It only enables the public workers.dev URL of cpi-incident-status; no POS login/transaction code, custom domain, DNS, Supabase, Vercel billing, preview URL or unrelated Worker is changed.

Deployment and README previously confirmed that this Worker is a static incident notice with no input fields or customer data. The route only shows outage information and does not restore point-of-sale services.
