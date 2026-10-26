# Smoke tests (Playwright)

Run against every Vercel preview by `.github/workflows/preview-smoke.yml`, or locally:

```bash
pnpm --filter @ghostcart/e2e exec playwright install chromium   # once
BASE_URL=http://localhost:3000 pnpm --filter @ghostcart/e2e e2e
```

- **`pages.spec.ts`:** checks that every public page renders and hydrates with no console errors, on desktop and phone sizes; that the security headers are set; and that login only enables "Call me" for a valid number. It never clicks "Call me", because on a preview that would phone a real number.
- **`negotiation.spec.ts`:** runs negotiate, escalate and approve through `/api/v1`. It needs a ZZ test store on the target: set `E2E_SECRET_KEY` (its secret key) and `E2E_SKU` (a product). It's skipped otherwise.

**CI setup (lead):**
- Add the `VERCEL_AUTOMATION_BYPASS_SECRET` secret, from Vercel → Deployment Protection → Protection Bypass for Automation.
- Optionally add `E2E_SECRET_KEY` and the `E2E_SKU` variable.
- For a database per PR: add `NEON_PROJECT_ID` (variable) and `NEON_API_KEY` (secret). `neon-branch.yml` then creates and migrates `preview/pr-<n>` branches.
