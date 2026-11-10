# One-time Pro restoration and Cloudflare DR public route check

Run the `CpiPOS Vercel Pro / Cloudflare DR read-only verification` workflow after merge.
This performs anonymous GET requests only; it never runs any login, production sale, customer data queries, DNS switch, plan purchase, or Cloudflare Worker deploy.

Current expected critical endpoints:
- Vercel Pro POS `/login/store` should return a CpiPOS login page.
- Cloudflare incident `/health` should explicitly say `status:incident`.

Company downloads, homepage and HR availability are reported as warnings until independently verified. A passing probe is not full POS disaster recovery acceptance.
